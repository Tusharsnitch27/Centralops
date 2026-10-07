import "server-only";
import { one, q } from "../db";
import { canManage, type User } from "../auth";
import { addDays, today, weekStart } from "@/lib/dates";
import type { Priority, TaskStatus } from "@/lib/meta";
import { listTasks, type TaskFilter, type TaskListItem } from "./queries";

/* ------------------------------------------------------------------ */
/* View definitions                                                    */
/* ------------------------------------------------------------------ */

export type TaskViewKey = "mine" | "delegated" | "waiting" | "overdue" | "today" | "week" | "noupdate" | "done" | "all";

export const STALE_DAYS = 5;
export const DONE_WINDOW_DAYS = 14;

export const TASK_VIEWS: { key: TaskViewKey; label: string; hint: string }[] = [
  { key: "mine", label: "My Tasks", hint: "Open tasks you own" },
  { key: "delegated", label: "Assigned by Me", hint: "Open tasks you delegated to people or teams" },
  { key: "waiting", label: "Waiting on Others", hint: "Your tasks parked on someone else" },
  { key: "overdue", label: "Overdue", hint: "Past their due date and still open" },
  { key: "today", label: "Due Today", hint: "Due today" },
  { key: "week", label: "This Week", hint: "Due between today and Sunday" },
  { key: "noupdate", label: "No Update", hint: `Delegated tasks with no update in ${STALE_DAYS}+ days` },
  { key: "done", label: "Recently Completed", hint: `Completed in the last ${DONE_WINDOW_DAYS} days` },
  { key: "all", label: "All", hint: "Every task in scope" },
];

export const isViewKey = (v: unknown): v is TaskViewKey => TASK_VIEWS.some((x) => x.key === v);

export type GroupBy = "none" | "status" | "project" | "owner" | "due";
export const GROUP_BY: { key: GroupBy; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "status", label: "Status" },
  { key: "project", label: "Project" },
  { key: "owner", label: "Owner" },
  { key: "due", label: "Due date" },
];

/** URL params understood by /tasks (also what a saved view stores). */
export interface TaskParams {
  view: TaskViewKey;
  owner?: string;      // user id | "me" | "team:<id>"
  team?: string;
  project?: string;
  priority?: Priority[];
  status?: TaskStatus[];
  tag?: string;
  search?: string;
  group: GroupBy;
}

const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low"];
const STATUSES: TaskStatus[] = ["not_started", "in_progress", "waiting", "blocked", "completed", "cancelled"];
const list = <T extends string>(v: string | undefined, allowed: T[]) => (v ? v.split(",").filter((x): x is T => (allowed as string[]).includes(x)) : undefined);
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export function parseTaskParams(sp: Record<string, string | string[] | undefined>): TaskParams {
  const view = str(sp.view);
  const group = str(sp.group) as GroupBy | undefined;
  const priority = list(str(sp.priority), PRIORITIES);
  const status = list(str(sp.status), STATUSES);
  return {
    view: isViewKey(view) ? view : "mine",
    owner: str(sp.owner),
    team: str(sp.team),
    project: str(sp.project),
    priority: priority?.length ? priority : undefined,
    status: status?.length ? status : undefined,
    tag: str(sp.tag),
    search: str(sp.search),
    group: GROUP_BY.some((g) => g.key === group) ? group! : "none",
  };
}

/** Serialise params back to a query string (used by tabs, saved views and pills). */
export function taskQuery(p: Partial<TaskParams>, overrides: Partial<TaskParams> = {}) {
  const m = { ...p, ...overrides };
  const s = new URLSearchParams();
  if (m.view && m.view !== "mine") s.set("view", m.view);
  if (m.owner) s.set("owner", m.owner);
  if (m.team) s.set("team", m.team);
  if (m.project) s.set("project", m.project);
  if (m.priority?.length) s.set("priority", m.priority.join(","));
  if (m.status?.length) s.set("status", m.status.join(","));
  if (m.tag) s.set("tag", m.tag);
  if (m.search) s.set("search", m.search);
  if (m.group && m.group !== "none") s.set("group", m.group);
  const qs = s.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

export const weekEnd = (d = today()) => addDays(weekStart(d), 6);

/** The base filter for a view, scoped to the user. */
export function viewFilter(view: TaskViewKey, u: Pick<User, "id" | "role">): TaskFilter {
  const td = today();
  const scope: TaskFilter = canManage(u) ? {} : { involving: u.id };
  switch (view) {
    case "mine": return { ownerId: u.id, open: true };
    case "delegated": return { delegatedBy: u.id, open: true };
    case "waiting": return { waitingOnOthersFor: u.id, open: true };
    case "overdue": return { ...scope, overdue: true, order: "due" };
    case "today": return { ...scope, open: true, dueOn: td };
    case "week": return { ...scope, open: true, dueFrom: td, dueTo: weekEnd(td) };
    case "noupdate": return { delegatedBy: u.id, open: true, staleDays: STALE_DAYS, order: "updated" };
    case "done": return { ...scope, completedSince: addDays(td, -DONE_WINDOW_DAYS), order: "updated" };
    case "all": return { ...scope, limit: 400 };
  }
}

/** View + URL filters → TaskFilter. Owner/team filters are applied after the query when needed. */
export async function listTasksForParams(p: TaskParams, u: Pick<User, "id" | "role">): Promise<TaskListItem[]> {
  const f: TaskFilter = { ...viewFilter(p.view, u) };
  let ownerTeam: string | undefined;
  if (p.owner === "me") f.ownerId = u.id;
  else if (p.owner?.startsWith("team:")) ownerTeam = p.owner.slice(5);
  else if (p.owner) f.ownerId = p.owner;
  if (p.team) f.teamId = p.team;
  if (p.project) f.projectId = p.project;
  if (p.priority) f.priority = p.priority;
  if (p.status) f.status = p.status;
  if (p.tag) f.tag = p.tag;
  if (p.search) f.search = p.search;
  // "My tasks" + an explicit team-owner filter: the explicit filter wins
  if (ownerTeam) delete f.ownerId;
  const rows = await listTasks(f);
  return ownerTeam ? rows.filter((t) => t.owner_team_id === ownerTeam && !t.owner_id) : rows;
}

/* ------------------------------------------------------------------ */
/* Counts + insights                                                   */
/* ------------------------------------------------------------------ */

export type ViewCounts = Record<TaskViewKey, number> & { blocked: number; staleOverdue: number; unacknowledged: number };

/** All tab counts in one round trip. Mirrors viewFilter(). */
export async function taskViewCounts(u: Pick<User, "id" | "role">): Promise<ViewCounts> {
  const td = today();
  const scope = canManage(u) ? "true" : `(t.owner_id = $1 or t.requester_id = $1 or t.waiting_on_id = $1 or t.created_by = $1)`;
  const open = `t.status not in ('completed','cancelled')`;
  const delegated = `(t.requester_id = $1 or t.created_by = $1) and t.owner_id is distinct from t.requester_id and coalesce(t.owner_id::text, '') <> $1::text`;
  const stale = `coalesce(t.last_update_at, t.created_at) < now() - make_interval(days => ${STALE_DAYS})`;
  const r = await one<Record<string, number>>(
    `select
       count(*) filter (where t.owner_id = $1 and ${open})::int as mine,
       count(*) filter (where ${delegated} and ${open})::int as delegated,
       count(*) filter (where t.owner_id = $1 and (t.status = 'waiting' or t.waiting_on_id is not null) and ${open})::int as waiting,
       count(*) filter (where ${scope} and ${open} and t.due_date < $2::date)::int as overdue,
       count(*) filter (where ${scope} and ${open} and t.due_date = $2::date)::int as today,
       count(*) filter (where ${scope} and ${open} and t.due_date between $2::date and $3::date)::int as week,
       count(*) filter (where ${delegated} and ${open} and ${stale})::int as noupdate,
       count(*) filter (where ${scope} and t.status = 'completed' and t.completed_at >= $4::date)::int as done,
       count(*) filter (where ${scope} and ${open})::int as "all",
       count(*) filter (where ${scope} and t.status = 'blocked')::int as blocked,
       count(*) filter (where ${scope} and ${open} and t.due_date < $2::date and ${stale})::int as "staleOverdue",
       count(*) filter (where ${delegated} and t.status = 'not_started' and t.acknowledged_at is null and t.created_at < now() - interval '2 days')::int as unacknowledged
     from tasks t`,
    [u.id, td, weekEnd(td), addDays(td, -DONE_WINDOW_DAYS)],
  );
  return r as unknown as ViewCounts;
}

export interface TaskInsight { key: string; tone: "red" | "amber" | "info"; text: string; cta: string; href: string }

/** Exception-first sentences for the top of /tasks. */
export function taskInsights(c: ViewCounts): TaskInsight[] {
  const out: TaskInsight[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (c.overdue) out.push({ key: "overdue", tone: "red", text: `${n(c.overdue, "task is", "tasks are")} past due${c.staleOverdue ? ` — ${c.staleOverdue} with no update in ${STALE_DAYS}+ days` : ""}`, cta: "Review", href: "/tasks?view=overdue" });
  if (c.blocked) out.push({ key: "blocked", tone: "red", text: `${n(c.blocked, "task is blocked and needs", "tasks are blocked and need")} a decision to move`, cta: "Unblock", href: "/tasks?view=all&status=blocked" });
  if (c.noupdate) out.push({ key: "noupdate", tone: "amber", text: `${n(c.noupdate, "delegated task has", "delegated tasks have")} not received an update in the last ${STALE_DAYS} days`, cta: "Follow up", href: "/followups" });
  if (c.unacknowledged) out.push({ key: "unack", tone: "amber", text: `${n(c.unacknowledged, "assignment hasn't", "assignments haven't")} been acknowledged after 2 days`, cta: "Review", href: "/tasks?view=delegated&status=not_started" });
  if (c.today) out.push({ key: "today", tone: "info", text: `${n(c.today, "task is", "tasks are")} due today`, cta: "Open", href: "/tasks?view=today" });
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Saved views                                                         */
/* ------------------------------------------------------------------ */

export interface SavedView { id: string; name: string; filters: Partial<TaskParams>; builtin?: boolean }

export const BUILTIN_VIEWS: SavedView[] = [
  { id: "builtin:open", name: "My Open Tasks", filters: { view: "mine" }, builtin: true },
  { id: "builtin:waiting", name: "Waiting on Others", filters: { view: "waiting" }, builtin: true },
  { id: "builtin:critical", name: "Critical This Week", filters: { view: "week", priority: ["urgent", "high"] }, builtin: true },
];

export async function listSavedViews(userId: string): Promise<SavedView[]> {
  const rows = await q<{ id: string; name: string; filters: Partial<TaskParams> }>(
    `select id, name, filters from saved_views where user_id = $1 and module = 'tasks' order by pinned desc, sort, created_at`, [userId]);
  return [...BUILTIN_VIEWS, ...rows];
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

export interface TaskGroup { key: string; label: string; tasks: TaskListItem[]; tone?: "red" | "amber" | "neutral" }

const STATUS_ORDER: TaskStatus[] = ["blocked", "waiting", "in_progress", "not_started", "completed", "cancelled"];
const STATUS_LABEL: Record<TaskStatus, string> = { blocked: "Blocked", waiting: "Waiting", in_progress: "In progress", not_started: "Not started", completed: "Completed", cancelled: "Cancelled" };

export function groupTasks(tasks: TaskListItem[], by: GroupBy): TaskGroup[] {
  if (by === "none") return [{ key: "all", label: "", tasks }];
  const td = today();
  const we = weekEnd(td);
  const map = new Map<string, TaskGroup>();
  const put = (key: string, label: string, t: TaskListItem, tone?: TaskGroup["tone"]) => {
    if (!map.has(key)) map.set(key, { key, label, tasks: [], tone });
    map.get(key)!.tasks.push(t);
  };
  const dueOrder = ["overdue", "today", "week", "next", "later", "none", "closed"];
  for (const t of tasks) {
    if (by === "status") put(t.status, STATUS_LABEL[t.status], t, t.status === "blocked" ? "red" : t.status === "waiting" ? "amber" : undefined);
    else if (by === "project") put(t.project_id ?? "~", t.project_name ?? "No project", t);
    else if (by === "owner") put(t.owner_id ?? (t.owner_team_id ? `team:${t.owner_team_id}` : "~"), t.owner_name ?? (t.owner_team_name ? `${t.owner_team_name} (team)` : "Unassigned"), t);
    else {
      const open = t.status !== "completed" && t.status !== "cancelled";
      if (!open) put("closed", "Closed", t);
      else if (!t.due_date) put("none", "No due date", t);
      else if (t.due_date < td) put("overdue", "Overdue", t, "red");
      else if (t.due_date === td) put("today", "Today", t, "amber");
      else if (t.due_date <= we) put("week", "Later this week", t);
      else if (t.due_date <= addDays(we, 7)) put("next", "Next week", t);
      else put("later", "Later", t);
    }
  }
  const groups = [...map.values()];
  if (by === "status") groups.sort((a, b) => STATUS_ORDER.indexOf(a.key as TaskStatus) - STATUS_ORDER.indexOf(b.key as TaskStatus));
  else if (by === "due") groups.sort((a, b) => dueOrder.indexOf(a.key) - dueOrder.indexOf(b.key));
  else groups.sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : b.tasks.length - a.tasks.length || a.label.localeCompare(b.label)));
  return groups;
}

/** All tags in use (for the filter picker). */
export const listTags = () => q<{ tag: string; n: number }>(`select tag, count(*)::int as n from task_tags group by tag order by n desc, tag`);
