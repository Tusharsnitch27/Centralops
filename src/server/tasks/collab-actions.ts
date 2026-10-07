"use server";
// Task collaboration + follow-up server actions (comments, links, tags, dependencies, saved views, snooze, bulk nudges).
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { requireUser, canEdit, type User } from "../auth";
import { logActivity, link } from "../core/activity";
import { notify } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { requestUpdate, TaskError } from "./core";
import { searchTasksLite } from "./detail";
import { followupQueue, snoozeUntil } from "./followups";
import type { TaskParams } from "./views";

const refresh = (id?: string) => {
  if (id) revalidatePath(`/tasks/${id}`);
  revalidatePath("/tasks");
  revalidatePath("/followups");
  revalidatePath("/", "layout");
};

async function editor(): Promise<User> {
  const u = await requireUser();
  if (!canEdit(u)) throw new Error("Read-only access");
  return u;
}
async function taskTitle(id: string) {
  const t = await one<{ title: string; owner_id: string | null; requester_id: string | null; created_by: string | null }>(
    `select title, owner_id, requester_id, created_by from tasks where id = $1`, [id]);
  if (!t) throw new TaskError("Task not found");
  return t;
}

/* ---------- comments ---------- */
export async function addTaskComment(taskId: string, body: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const text = body.trim();
    if (!text) throw new Error("Write a comment");
    const t = await taskTitle(taskId);
    await tx(async (x) => {
      await x.q(`insert into comments (entity_type, entity_id, author_id, body) values ('task',$1,$2,$3)`, [taskId, u.id, text]);
      await x.q(`insert into task_history (task_id, actor_id, event, note) values ($1,$2,'commented',$3)`, [taskId, u.id, text]);
      await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "commented", to: text, summary: t.title }, x);
      for (const uid of new Set([t.owner_id, t.requester_id, t.created_by].filter(Boolean) as string[]))
        await notify({ userId: uid, kind: "comment", title: `${u.name.split(" ")[0]} commented on ${t.title}`, body: text.slice(0, 140), entityType: "task", entityId: taskId, href: `/tasks/${taskId}`, actorId: u.id }, x);
    });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}

/* ---------- attachments (links) ---------- */
export async function addTaskLink(taskId: string, name: string, url: string): Promise<ActionResult> {
  try {
    const u = await editor();
    let href = url.trim();
    if (!href) throw new Error("Paste a link");
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    try { new URL(href); } catch { throw new Error("That doesn't look like a valid link"); }
    const label = name.trim() || new URL(href).hostname.replace(/^www\./, "");
    const t = await taskTitle(taskId);
    await q(`insert into attachments (entity_type, entity_id, name, url, uploaded_by) values ('task',$1,$2,$3,$4)`, [taskId, label, href, u.id]);
    await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "attachment_added", to: label, summary: t.title });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}
export async function removeTaskLink(taskId: string, attachmentId: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const a = await one<{ name: string }>(`delete from attachments where id = $1 and entity_type = 'task' and entity_id = $2 returning name`, [attachmentId, taskId]);
    if (a) await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "attachment_removed", from: a.name });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}

/* ---------- requester / program (not covered by TaskPatch) ---------- */
export async function setTaskRequester(taskId: string, userId: string | null): Promise<ActionResult> {
  try {
    const u = await editor();
    await tx(async (x) => {
      const cur = await x.one<{ title: string; requester_id: string | null }>(`select title, requester_id from tasks where id = $1 for update`, [taskId]);
      if (!cur) throw new TaskError("Task not found");
      if (cur.requester_id === userId) return;
      await x.q(`update tasks set requester_id = $2, updated_at = now() where id = $1`, [taskId, userId]);
      await x.q(`insert into task_history (task_id, actor_id, event, from_value, to_value, note) values ($1,$2,'updated',$3,$4,'Requester')`, [taskId, u.id, cur.requester_id, userId]);
      await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "updated", field: "requester", from: cur.requester_id, to: userId, summary: cur.title }, x);
    });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}
export async function setTaskProgram(taskId: string, programId: string | null): Promise<ActionResult> {
  try {
    const u = await editor();
    await tx(async (x) => {
      const cur = await x.one<{ title: string; program_id: string | null; project_id: string | null }>(`select title, program_id, project_id from tasks where id = $1 for update`, [taskId]);
      if (!cur) throw new TaskError("Task not found");
      if (cur.project_id) throw new Error("Program follows the task's project — change the project instead");
      if (cur.program_id === programId) return;
      await x.q(`update tasks set program_id = $2, updated_at = now() where id = $1`, [taskId, programId]);
      await x.q(`insert into task_history (task_id, actor_id, event, from_value, to_value, note) values ($1,$2,'linked',$3,$4,'Program')`, [taskId, u.id, cur.program_id, programId]);
      await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "updated", field: "program", from: cur.program_id, to: programId, summary: cur.title }, x);
      if (programId) await link("program", programId, "task", taskId, "related", u.id, x);
    });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}

/* ---------- tags ---------- */
export async function addTaskTag(taskId: string, tag: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const clean = tag.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
    if (!clean) throw new Error("Tag can't be empty");
    await taskTitle(taskId);
    await q(`insert into task_tags (task_id, tag) values ($1,$2) on conflict do nothing`, [taskId, clean]);
    await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "tag_added", to: clean });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}
export async function removeTaskTag(taskId: string, tag: string): Promise<ActionResult> {
  try {
    const u = await editor();
    await q(`delete from task_tags where task_id = $1 and tag = $2`, [taskId, tag]);
    await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "tag_removed", from: tag });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}

/* ---------- dependencies ---------- */
/** kind 'blocked_by': taskId depends on otherId · 'blocking': otherId depends on taskId. */
export async function addTaskDependency(taskId: string, otherId: string, kind: "blocked_by" | "blocking"): Promise<ActionResult> {
  try {
    const u = await editor();
    if (taskId === otherId) throw new Error("A task can't depend on itself");
    const [a, b] = kind === "blocked_by" ? [taskId, otherId] : [otherId, taskId];
    const cycle = await one(`with recursive up(id) as (select depends_on_id from task_dependencies where task_id = $1
                               union select d.depends_on_id from task_dependencies d join up on d.task_id = up.id)
                             select 1 from up where id = $2 limit 1`, [b, a]);
    if (cycle) throw new Error("That would create a circular dependency");
    const [ta, tb] = await Promise.all([taskTitle(a), taskTitle(b)]);
    await tx(async (x) => {
      await x.q(`insert into task_dependencies (task_id, depends_on_id) values ($1,$2) on conflict do nothing`, [a, b]);
      await x.q(`insert into task_history (task_id, actor_id, event, to_value, note) values ($1,$2,'linked',$3,'Blocked by')`, [a, u.id, tb.title]);
      await link("task", b, "task", a, "blocks", u.id, x);
      await logActivity({ actorId: u.id, entityType: "task", entityId: a, action: "dependency_added", to: tb.title, summary: ta.title }, x);
    });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}
export async function removeTaskDependency(taskId: string, otherId: string, kind: "blocked_by" | "blocking"): Promise<ActionResult> {
  try {
    const u = await editor();
    const [a, b] = kind === "blocked_by" ? [taskId, otherId] : [otherId, taskId];
    await q(`delete from task_dependencies where task_id = $1 and depends_on_id = $2`, [a, b]);
    await q(`delete from entity_links where from_type = 'task' and from_id = $1 and to_type = 'task' and to_id = $2 and relation = 'blocks'`, [b, a]);
    await logActivity({ actorId: u.id, entityType: "task", entityId: a, action: "dependency_removed", to: b });
    refresh(taskId);
    return ok();
  } catch (e) { return fail(e); }
}
export async function searchTasksForPicker(term: string, excludeId: string) {
  await requireUser();
  return term.trim().length < 2 ? [] : searchTasksLite(term.trim(), excludeId);
}

/* ---------- request update (with channel) ---------- */
export async function requestTaskUpdateVia(taskId: string, message: string | null, channel: "in_app" | "email" | "slack" | "whatsapp" = "in_app"): Promise<ActionResult> {
  try {
    const u = await editor();
    if (channel !== "in_app") throw new Error("Only in-app follow-ups are available right now");
    await requestUpdate(u.id, taskId, message, channel);
    refresh(taskId);
    return ok(undefined, "Update requested");
  } catch (e) { return fail(e); }
}

/* ---------- follow-ups ---------- */
export async function snoozeFollowup(taskId: string, days = 2): Promise<ActionResult> {
  try {
    const u = await editor();
    const until = snoozeUntil(days);
    await q(`insert into user_preferences (user_id, prefs) values ($1, jsonb_build_object('followupSnoozes', jsonb_build_object($2::text, $3::text)))
             on conflict (user_id) do update set prefs = jsonb_set(coalesce(user_preferences.prefs, '{}'), '{followupSnoozes}',
               coalesce(user_preferences.prefs->'followupSnoozes', '{}') || jsonb_build_object($2::text, $3::text)), updated_at = now()`,
      [u.id, taskId, until]);
    await logActivity({ actorId: u.id, entityType: "task", entityId: taskId, action: "followup_snoozed", to: until });
    refresh();
    return ok(undefined, `Snoozed until ${until}`);
  } catch (e) { return fail(e); }
}
export async function unsnoozeFollowup(taskId: string): Promise<ActionResult> {
  try {
    const u = await editor();
    await q(`update user_preferences set prefs = jsonb_set(prefs, '{followupSnoozes}', coalesce(prefs->'followupSnoozes', '{}') - $2::text), updated_at = now() where user_id = $1`, [u.id, taskId]);
    refresh();
    return ok();
  } catch (e) { return fail(e); }
}
/** Nudge every owner in the "needs follow-up" queue (or the given task ids). */
export async function bulkRequestUpdates(taskIds?: string[]): Promise<ActionResult<{ sent: number; skipped: number }>> {
  try {
    const u = await editor();
    const ids = taskIds?.length ? taskIds : (await followupQueue(u.id, 100)).map((i) => i.task.id);
    let sent = 0, skipped = 0;
    for (const id of ids) {
      try { await requestUpdate(u.id, id, null, "in_app"); sent++; } catch { skipped++; }
    }
    await logActivity({ actorId: u.id, entityType: "followup", entityId: null, action: "bulk_requested", to: sent, summary: `Requested ${sent} updates` });
    refresh();
    return ok({ sent, skipped }, `Requested ${sent} update${sent === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped (no owner)` : ""}`);
  } catch (e) { return fail(e); }
}
export async function closeFollowup(followupId: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const f = await one<{ entity_id: string }>(`update followups set status = 'closed' where id = $1 and requested_by = $2 and status = 'open' returning entity_id`, [followupId, u.id]);
    if (f) await logActivity({ actorId: u.id, entityType: "task", entityId: f.entity_id, action: "followup_closed" });
    refresh(f?.entity_id);
    return ok();
  } catch (e) { return fail(e); }
}

/* ---------- saved views ---------- */
export async function saveTaskView(name: string, filters: Partial<TaskParams>): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    const n = name.trim();
    if (!n) throw new Error("Give the view a name");
    const clean: Partial<TaskParams> = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));
    const r = await one<{ id: string }>(
      `insert into saved_views (user_id, module, name, filters, sort) values ($1,'tasks',$2,$3,
         coalesce((select max(sort) + 1 from saved_views where user_id = $1 and module = 'tasks'), 0)) returning id`,
      [u.id, n.slice(0, 60), JSON.stringify(clean)]);
    refresh();
    return ok(r!, "View saved");
  } catch (e) { return fail(e); }
}
export async function deleteTaskView(id: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`delete from saved_views where id = $1 and user_id = $2 and module = 'tasks'`, [id, u.id]);
    refresh();
    return ok(undefined, "View removed");
  } catch (e) { return fail(e); }
}
