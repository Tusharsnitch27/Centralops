"use server";
import { revalidatePath } from "next/cache";
import { canEdit, requireUser } from "../auth";
import { one, q, tx } from "../db";
import { notify } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { canSeeTask } from "../org/queries";
import { updateTask } from "./core";

async function editor(taskId: string) {
  const u = await requireUser();
  if (!canEdit(u)) throw new Error("Read-only access");
  if (!(await canSeeTask(u, taskId))) throw new Error("Task not found");
  const t = await one<{ title: string; status: string; owner_id: string | null }>(`select title, status, owner_id from tasks where id = $1`, [taskId]);
  if (!t) throw new Error("Task not found");
  return { u, t };
}
const refresh = (id: string) => { revalidatePath(`/tasks/${id}`); revalidatePath("/tasks"); };
const hist = (taskId: string, actor: string, event: string, to: string | null, note: string | null) =>
  q(`insert into task_history (task_id, actor_id, event, to_value, note) values ($1,$2,$3,$4,$5)`, [taskId, actor, event, to, note]);

export async function addAssignees(taskId: string, userIds: string[]): Promise<ActionResult> {
  try {
    const { u, t } = await editor(taskId);
    let n = 0;
    for (const id of new Set(userIds)) {
      if (!id || id === t.owner_id) continue;
      const r = await q(`insert into task_assignees (task_id, user_id, added_by) values ($1,$2,$3) on conflict do nothing returning user_id`, [taskId, id, u.id]);
      if (!r.length) continue;
      n++;
      const who = await one<{ name: string }>(`select name from users where id = $1`, [id]);
      await hist(taskId, u.id, "updated", who?.name ?? null, "Added to the task");
      await notify({ userId: id, kind: "task_assigned", title: `Added to: ${t.title}`, entityType: "task", entityId: taskId, href: `/tasks/${taskId}`, actorId: u.id });
    }
    refresh(taskId);
    return ok(undefined, n ? `Added ${n}` : "Already on the task");
  } catch (e) { return fail(e); }
}

export async function removeAssignee(taskId: string, userId: string): Promise<ActionResult> {
  try {
    const { u } = await editor(taskId);
    const who = await one<{ name: string }>(`select name from users where id = $1`, [userId]);
    await q(`delete from task_assignees where task_id = $1 and user_id = $2`, [taskId, userId]);
    await hist(taskId, u.id, "updated", who?.name ?? null, "Removed from the task");
    refresh(taskId);
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}

/** Raise a blocker on the person who has to clear it; the task moves to Blocked. */
export async function raiseBlocker(taskId: string, body: string, onUserId: string | null, onLabel?: string | null): Promise<ActionResult> {
  try {
    const { u, t } = await editor(taskId);
    if (!body.trim()) throw new Error("Say what's blocking");
    await tx(async (x) => {
      await x.q(`insert into task_blockers (task_id, body, on_user_id, on_label, raised_by) values ($1,$2,$3,$4,$5)`, [taskId, body.trim(), onUserId, onUserId ? null : onLabel?.trim() || null, u.id]);
      if (onUserId) await notify({ userId: onUserId, kind: "blocker", title: `You’re blocking: ${t.title}`, body: body.trim(), entityType: "task", entityId: taskId, href: `/tasks/${taskId}`, actorId: u.id }, x);
    });
    if (t.status !== "blocked") await updateTask(u.id, taskId, { status: "blocked", blocker: body.trim(), note: body.trim() });
    else await q(`update tasks set blocker = $2, updated_at = now() where id = $1`, [taskId, body.trim()]);
    refresh(taskId);
    return ok(undefined, "Blocker raised");
  } catch (e) { return fail(e); }
}

/** Clear one blocker (or all with id = null). When none are left the task goes back to In progress. */
export async function clearBlocker(taskId: string, blockerId: string | null): Promise<ActionResult> {
  try {
    const { u, t } = await editor(taskId);
    await q(`update task_blockers set status = 'cleared', cleared_by = $3, cleared_at = now() where task_id = $1 and status = 'open' and ($2::uuid is null or id = $2::uuid)`, [taskId, blockerId, u.id]);
    const left = await one<{ n: number; body: string | null }>(`select count(*)::int as n, max(body) as body from task_blockers where task_id = $1 and status = 'open'`, [taskId]);
    if (!left?.n && t.status === "blocked") await updateTask(u.id, taskId, { status: "in_progress", blocker: null, note: "Blockers cleared" });
    else await q(`update tasks set blocker = $2 where id = $1`, [taskId, left?.body ?? null]);
    refresh(taskId);
    return ok(undefined, blockerId ? "Blocker cleared" : "All blockers cleared");
  } catch (e) { return fail(e); }
}
