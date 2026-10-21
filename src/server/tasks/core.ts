import "server-only";
import { tx, type Tx } from "../db";
import { logActivity, link } from "../core/activity";
import { notify, resolveInbox } from "../core/notify";
import { today } from "@/lib/dates";
import { TASK_STATUS, type Priority, type TaskStatus, type Health } from "@/lib/meta";

/**
 * The one place tasks are created/changed. Every change writes task_history (the journey),
 * activity_log (audit) and notifications. Modules (meetings, AOP, S&OP, follow-ups) call these.
 */
export interface NewTask {
  title: string;
  description?: string | null;
  ownerId?: string | null;
  ownerTeamId?: string | null;
  requesterId?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: string | null;
  startDate?: string | null;
  projectId?: string | null;
  programId?: string | null;
  milestoneId?: string | null;
  meetingId?: string | null;
  aopItemId?: string | null;
  parentId?: string | null;
  waitingOnId?: string | null;
  source?: "manual" | "meeting" | "aop" | "sop" | "project" | "ai" | "followup" | "integration" | "onboarding";
  nextStep?: string | null;
  pocName?: string | null;
  tags?: string[];
  dependsOn?: string[];
}

export class TaskError extends Error {}

/** Due dates may not be in the past (no back-filling history). */
export function assertFutureDate(d: string | null | undefined, label = "Due date") {
  if (d && d < today()) throw new TaskError(`${label} can't be in the past`);
}

export async function createTask(actorId: string | null, t: NewTask, opts: { allowPast?: boolean; tx?: Tx } = {}) {
  if (!t.title?.trim()) throw new TaskError("Title is required");
  if (!opts.allowPast) assertFutureDate(t.dueDate);
  const run = async (x: Tx) => {
    const row = await x.one<{ id: string; number: number }>(
      `insert into tasks (title, description, owner_id, owner_team_id, requester_id, priority, status, due_date, original_due_date, start_date,
         project_id, program_id, milestone_id, meeting_id, aop_item_id, parent_id, waiting_on_id, source, next_step, created_by, last_update_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       returning id, number`,
      [
        t.title.trim(), t.description ?? null, t.ownerId ?? null, t.ownerTeamId ?? null, t.requesterId ?? actorId, t.priority ?? "medium",
        t.status ?? "not_started", t.dueDate ?? null, t.startDate ?? null, t.projectId ?? null, t.programId ?? null, t.milestoneId ?? null,
        t.meetingId ?? null, t.aopItemId ?? null, t.parentId ?? null, t.waitingOnId ?? null, t.source ?? "manual", t.nextStep ?? null, actorId,
      ],
    );
    const id = row!.id;
    if (t.pocName?.trim()) await x.q(`update tasks set poc_name = $2 where id = $1`, [id, t.pocName.trim()]);
    // program follows project when not given
    if (!t.programId && t.projectId) await x.q(`update tasks set program_id = (select program_id from projects where id = $2) where id = $1`, [id, t.projectId]);
    await x.q(`insert into task_history (task_id, actor_id, event, to_value, note) values ($1,$2,'created',$3,$4)`, [id, actorId, t.source ?? "manual", t.meetingId ? "From meeting" : null]);
    if (t.ownerId || t.ownerTeamId) await x.q(`insert into task_history (task_id, actor_id, event, to_value) values ($1,$2,'assigned',$3)`, [id, actorId, t.ownerId ?? t.ownerTeamId]);
    for (const tag of t.tags ?? []) await x.q(`insert into task_tags (task_id, tag) values ($1,$2) on conflict do nothing`, [id, tag.trim().toLowerCase()]);
    for (const dep of t.dependsOn ?? []) await x.q(`insert into task_dependencies (task_id, depends_on_id) values ($1,$2) on conflict do nothing`, [id, dep]);
    await logActivity({ actorId, entityType: "task", entityId: id, action: "created", summary: t.title }, x);
    if (t.meetingId) await link("meeting", t.meetingId, "task", id, "action", actorId, x);
    if (t.aopItemId) await link("aop_item", t.aopItemId, "task", id, "action", actorId, x);
    if (t.ownerId && t.ownerId !== actorId)
      await notify({ userId: t.ownerId, kind: "task_assigned", title: `New task: ${t.title}`, body: t.dueDate ? `Due ${t.dueDate}` : null, entityType: "task", entityId: id, href: `/tasks/${id}`, actorId }, x);
    if (t.ownerTeamId && !t.ownerId) {
      const lead = await x.one<{ lead_id: string | null }>(`select lead_id from teams where id = $1`, [t.ownerTeamId]);
      await notify({ userId: lead?.lead_id, kind: "task_assigned", title: `New team task: ${t.title}`, entityType: "task", entityId: id, href: `/tasks/${id}`, actorId }, x);
    }
    return row!;
  };
  return opts.tx ? run(opts.tx) : tx(run);
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  health?: Health;
  priority?: Priority;
  ownerId?: string | null;
  ownerTeamId?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
  blocker?: string | null;
  nextStep?: string | null;
  waitingOnId?: string | null;
  note?: string | null; // reason / comment attached to the change
}

type TaskRow = {
  id: string; title: string; status: TaskStatus; health: Health; priority: Priority; owner_id: string | null; owner_team_id: string | null;
  due_date: string | null; project_id: string | null; blocker: string | null; requester_id: string | null; created_by: string | null;
};

/** Apply a patch and record each change in the task journey + audit trail. */
export async function updateTask(actorId: string, id: string, p: TaskPatch) {
  return tx(async (x) => {
    const cur = await x.one<TaskRow>(`select * from tasks where id = $1 for update`, [id]);
    if (!cur) throw new TaskError("Task not found");
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const hist = async (event: string, from: unknown, to: unknown, note?: string | null) => {
      await x.q(`insert into task_history (task_id, actor_id, event, from_value, to_value, note) values ($1,$2,$3,$4,$5,$6)`,
        [id, actorId, event, from == null ? null : String(from), to == null ? null : String(to), note ?? null]);
      await logActivity({ actorId, entityType: "task", entityId: id, action: event, field: event, from, to, summary: cur.title }, x);
    };
    const notifyPeople = async (title: string) => {
      for (const uid of new Set([cur.owner_id, cur.requester_id, cur.created_by].filter(Boolean) as string[]))
        await notify({ userId: uid, kind: "task_update", title, entityType: "task", entityId: id, href: `/tasks/${id}`, actorId }, x);
    };

    if (p.title !== undefined && p.title.trim() && p.title !== cur.title) { set("title", p.title.trim()); await hist("updated", cur.title, p.title, "Title"); }
    if (p.description !== undefined) set("description", p.description);
    if (p.nextStep !== undefined) set("next_step", p.nextStep);
    if (p.waitingOnId !== undefined) set("waiting_on_id", p.waitingOnId);
    if (p.projectId !== undefined && p.projectId !== cur.project_id) {
      set("project_id", p.projectId);
      set("program_id", p.projectId ? (await x.one<{ program_id: string | null }>(`select program_id from projects where id = $1`, [p.projectId]))?.program_id ?? null : null);
      await hist("linked", cur.project_id, p.projectId, "Project");
    }
    if (p.priority && p.priority !== cur.priority) { set("priority", p.priority); await hist("priority_changed", cur.priority, p.priority); }
    if (p.health && p.health !== cur.health) { set("health", p.health); await hist("updated", cur.health, p.health, "Health"); }
    if (p.dueDate !== undefined && p.dueDate !== cur.due_date) {
      if (p.dueDate) assertFutureDate(p.dueDate);
      set("due_date", p.dueDate);
      await hist("due_changed", cur.due_date, p.dueDate, p.note);
      await notifyPeople(`Due date changed: ${cur.title}`);
    }
    if ((p.ownerId !== undefined && p.ownerId !== cur.owner_id) || (p.ownerTeamId !== undefined && p.ownerTeamId !== cur.owner_team_id)) {
      if (p.ownerId !== undefined) set("owner_id", p.ownerId);
      if (p.ownerTeamId !== undefined) set("owner_team_id", p.ownerTeamId);
      set("acknowledged_at", null);
      await hist("assigned", cur.owner_id ?? cur.owner_team_id, p.ownerId ?? p.ownerTeamId ?? null, p.note);
      if (p.ownerId) await notify({ userId: p.ownerId, kind: "task_assigned", title: `Assigned to you: ${cur.title}`, entityType: "task", entityId: id, href: `/tasks/${id}`, actorId }, x);
    }
    if (p.blocker !== undefined) set("blocker", p.blocker);
    if (p.status && p.status !== cur.status) {
      set("status", p.status);
      const event = p.status === "completed" ? "completed" : p.status === "cancelled" ? "cancelled" : p.status === "blocked" ? "blocked"
        : cur.status === "completed" || cur.status === "cancelled" ? "reopened" : cur.status === "blocked" ? "unblocked" : "status_changed";
      if (p.status === "completed") set("completed_at", new Date().toISOString());
      else if (cur.status === "completed") set("completed_at", null);
      await hist(event, TASK_STATUS[cur.status].label, TASK_STATUS[p.status].label, p.note ?? (p.status === "blocked" ? p.blocker : null));
      if (actorId === cur.owner_id && cur.status === "not_started" && p.status !== "cancelled") set("acknowledged_at", new Date().toISOString());
      await notifyPeople(`${TASK_STATUS[p.status].label}: ${cur.title}`);
      // a closed task closes its open follow-ups and inbox items
      if (p.status === "completed" || p.status === "cancelled") {
        await x.q(`update followups set status = 'closed' where entity_type = 'task' and entity_id = $1 and status = 'open'`, [id]);
        await resolveInbox(`task:${id}:overdue`, undefined, x);
      }
    }
    if (!sets.length) return { changed: false };
    set("updated_at", new Date().toISOString());
    set("last_update_at", new Date().toISOString());
    vals.push(id);
    await x.q(`update tasks set ${sets.join(", ")} where id = $${vals.length}`, vals);
    return { changed: true };
  });
}

/** Owner posts a progress update (counts as acknowledgement; answers open follow-ups). */
export async function addTaskUpdate(actorId: string, id: string, body: string, status?: TaskStatus) {
  if (!body.trim()) throw new TaskError("Write an update");
  if (status) await updateTask(actorId, id, { status, note: body });
  return tx(async (x) => {
    const cur = await x.one<{ title: string; owner_id: string | null; requester_id: string | null; created_by: string | null }>(`select title, owner_id, requester_id, created_by from tasks where id = $1`, [id]);
    if (!cur) throw new TaskError("Task not found");
    await x.q(`insert into task_updates (task_id, author_id, body, status) values ($1,$2,$3,$4)`, [id, actorId, body.trim(), status ?? null]);
    await x.q(`insert into task_history (task_id, actor_id, event, note) values ($1,$2,'updated',$3)`, [id, actorId, body.trim()]);
    await x.q(`update tasks set last_update_at = now(), last_update_note = $2, updated_at = now(),
               acknowledged_at = coalesce(acknowledged_at, case when owner_id = $3 then now() end) where id = $1`, [id, body.trim(), actorId]);
    await x.q(`update followups set status = 'responded', responded_at = now(), response = $2 where entity_type = 'task' and entity_id = $1 and status = 'open'`, [id, body.trim()]);
    await logActivity({ actorId, entityType: "task", entityId: id, action: "update_posted", to: body.trim(), summary: cur.title }, x);
    for (const uid of new Set([cur.requester_id, cur.created_by].filter(Boolean) as string[]))
      await notify({ userId: uid, kind: "task_update", title: `Update on ${cur.title}`, body: body.trim().slice(0, 140), entityType: "task", entityId: id, href: `/tasks/${id}`, actorId }, x);
  });
}

/** Ask the owner for an update. Logged as a follow-up (in-app now; WhatsApp/Slack/email later). */
export async function requestUpdate(actorId: string, taskId: string, message?: string | null, channel: "in_app" | "email" | "slack" | "whatsapp" = "in_app") {
  return tx(async (x) => {
    const t = await x.one<{ title: string; owner_id: string | null; owner_team_id: string | null }>(`select title, owner_id, owner_team_id from tasks where id = $1`, [taskId]);
    if (!t) throw new TaskError("Task not found");
    let person = t.owner_id;
    if (!person && t.owner_team_id) person = (await x.one<{ lead_id: string | null }>(`select lead_id from teams where id = $1`, [t.owner_team_id]))?.lead_id ?? null;
    if (!person) throw new TaskError("This task has no owner to follow up with");
    const msg = message?.trim() || `Could you share a quick update on “${t.title}”?`;
    const f = await x.one<{ id: string }>(
      `insert into followups (entity_type, entity_id, person_id, requested_by, channel, message) values ('task',$1,$2,$3,$4,$5) returning id`,
      [taskId, person, actorId, channel, msg]);
    await x.q(`insert into task_history (task_id, actor_id, event, to_value, note) values ($1,$2,'followed_up',$3,$4)`, [taskId, actorId, channel, msg]);
    await logActivity({ actorId, entityType: "task", entityId: taskId, action: "followed_up", to: person, summary: t.title }, x);
    await notify({ userId: person, kind: "followup", title: `Update requested: ${t.title}`, body: msg, entityType: "task", entityId: taskId, href: `/tasks/${taskId}`, actorId }, x);
    return f!;
  });
}
