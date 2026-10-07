import "server-only";
import { one, q } from "../db";
import { addDays, diffDays, today } from "@/lib/dates";
import { listTasks, type TaskListItem } from "./queries";
import { STALE_DAYS } from "./views";

/**
 * The follow-up system: what I delegated, who owes me an update, and what I should chase next.
 * followupQueue() is also consumed by the Command Centre — keep its signature stable.
 */
export interface FollowupItem {
  task: TaskListItem;
  reason: string;
  severity: "high" | "medium" | "low";
  daysSinceUpdate: number;
}

/* ---------- snoozes (user_preferences.prefs.followupSnoozes = { taskId: 'YYYY-MM-DD' }) ---------- */

export async function getSnoozes(userId: string): Promise<Record<string, string>> {
  const r = await one<{ s: Record<string, string> | null }>(`select prefs->'followupSnoozes' as s from user_preferences where user_id = $1`, [userId]);
  const td = today();
  return Object.fromEntries(Object.entries(r?.s ?? {}).filter(([, until]) => until > td));
}

/* ---------- ranking ---------- */

const firstName = (n: string | null) => (n ? n.split(/\s+/)[0]! : null);
/** "Iqbal" or "the Logistics team" — who we'd be chasing. */
export const ownerLabel = (t: TaskListItem) => firstName(t.owner_name) ?? (t.owner_team_name ? `the ${t.owner_team_name} team` : "Nobody");
const dayWord = (n: number) => (n === 1 ? "1 day" : `${n} days`);
const quote = (s: string) => `‘${s.length > 70 ? `${s.slice(0, 68).trimEnd()}…` : s}’`;

/** Score one delegated task. null = no follow-up needed right now. */
export function assessTask(t: TaskListItem, td = today(), lastNudgeAt?: string | Date | null): Omit<FollowupItem, "task"> & { score: number } | null {
  const who = ownerLabel(t);
  const d = t.days_since_update;
  const nudgedRecently = lastNudgeAt != null && Date.now() - new Date(lastNudgeAt).getTime() < 86400000;
  const overdueBy = t.due_date && t.due_date < td ? diffDays(td, t.due_date) : 0;
  const dueIn = t.due_date && t.due_date >= td ? diffDays(t.due_date, td) : null;
  const staleTail = d >= 2 ? ` — last update ${dayWord(d)} ago` : "";
  let r: { reason: string; severity: FollowupItem["severity"]; score: number } | null = null;
  if (overdueBy > 0)
    r = { reason: `${who}'s ${quote(t.title)} is ${dayWord(overdueBy)} overdue${staleTail}`, severity: "high", score: 300 + overdueBy * 10 + d };
  else if (t.status === "blocked")
    r = { reason: `${who} is blocked on ${quote(t.title)}${t.blocker ? `: ${t.blocker}` : ""}`, severity: "high", score: 280 + d };
  else if (dueIn != null && dueIn <= 2 && d >= 2)
    r = { reason: `${quote(t.title)} is due ${dueIn === 0 ? "today" : dueIn === 1 ? "tomorrow" : "in 2 days"} and ${who} hasn't updated it in ${dayWord(d)}`, severity: dueIn === 0 ? "high" : "medium", score: 200 + (2 - dueIn) * 20 + d };
  else if (d >= STALE_DAYS)
    r = { reason: `${who} hasn't updated ${quote(t.title)} in ${dayWord(d)}`, severity: d >= STALE_DAYS * 2 ? "high" : "medium", score: 100 + d * 5 };
  else if (t.status === "not_started" && d >= 3)
    r = { reason: `${who} hasn't started ${quote(t.title)} — assigned ${dayWord(d)} ago`, severity: "low", score: 50 + d };
  if (!r) return null;
  // already nudged in the last 24h → it lives in "Waiting for response", not here
  if (nudgedRecently) return null;
  if (t.priority === "urgent") r.score += 40;
  else if (t.priority === "high") r.score += 20;
  return { ...r, daysSinceUpdate: d };
}

async function lastNudges(userId: string, taskIds: string[]) {
  if (!taskIds.length) return new Map<string, string>();
  const rows = await q<{ entity_id: string; at: string }>(
    `select entity_id, max(created_at) as at from followups where entity_type = 'task' and entity_id = any($1::uuid[]) and requested_by = $2 group by entity_id`,
    [taskIds, userId]);
  return new Map(rows.map((r) => [r.entity_id, r.at]));
}

/** Ranked "you should follow up on these" list for tasks the user delegated (person- or team-owned). */
export async function followupQueue(userId: string, limit = 50): Promise<FollowupItem[]> {
  const [tasks, snoozes] = await Promise.all([listTasks({ delegatedBy: userId, open: true }), getSnoozes(userId)]);
  const live = tasks.filter((t) => !snoozes[t.id] && (t.owner_id || t.owner_team_id));
  const nudges = await lastNudges(userId, live.map((t) => t.id));
  const td = today();
  const items: (FollowupItem & { score: number })[] = [];
  for (const t of live) {
    const a = assessTask(t, td, nudges.get(t.id));
    if (a) items.push({ task: t, ...a });
  }
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

/* ---------- the /followups page ---------- */

export interface FollowupRow {
  id: string;
  task_id: string;
  task_number: number;
  task_title: string;
  task_status: string;
  task_due: string | null;
  person_id: string | null;
  person_name: string | null;
  person_color: string | null;
  requested_by_name: string | null;
  channel: "in_app" | "email" | "slack" | "whatsapp";
  message: string | null;
  status: "open" | "responded" | "closed" | "cancelled";
  response: string | null;
  responded_at: string | null;
  created_at: string;
  age_days: number;
}

const FU_SELECT = `
  select f.id, t.id as task_id, t.number as task_number, t.title as task_title, t.status as task_status, t.due_date as task_due,
         f.person_id, p.name as person_name, p.avatar_color as person_color, rb.name as requested_by_name,
         f.channel, f.message, f.status, f.response, f.responded_at, f.created_at,
         extract(day from now() - f.created_at)::int as age_days
  from followups f
  join tasks t on t.id = f.entity_id and f.entity_type = 'task'
  left join users p on p.id = f.person_id
  left join users rb on rb.id = f.requested_by`;

export interface FollowupsPageData {
  queue: FollowupItem[];
  awaiting: FollowupRow[];
  responded: (FollowupRow & { last_update_note: string | null })[];
  waitingOnSomeone: TaskListItem[];
  log: FollowupRow[];
  snoozed: { task: TaskListItem; until: string }[];
  stats: { delegatedOpen: number; needs: number; awaiting: number; oldestAwaitingDays: number; respondedRate: number | null; medianResponseHours: number | null };
}

export async function followupsPage(userId: string): Promise<FollowupsPageData> {
  const [queue, awaiting, responded, waitingOnSomeone, log, delegated, snoozes, rate] = await Promise.all([
    followupQueue(userId, 100),
    q<FollowupRow>(`${FU_SELECT} where f.requested_by = $1 and f.status = 'open' and t.status not in ('completed','cancelled') order by f.created_at asc`, [userId]),
    q<FollowupRow & { last_update_note: string | null }>(
      `${FU_SELECT.replace("f.created_at,", "f.created_at, t.last_update_note,")} where f.requested_by = $1 and f.status = 'responded' and coalesce(f.responded_at, f.created_at) > now() - interval '7 days'
       order by coalesce(f.responded_at, f.created_at) desc limit 12`, [userId]),
    listTasks({ waitingOnOthersFor: userId, open: true }),
    q<FollowupRow>(`${FU_SELECT} where f.requested_by = $1 order by f.created_at desc limit 60`, [userId]),
    listTasks({ delegatedBy: userId, open: true }),
    getSnoozes(userId),
    one<{ total: number; responded: number; median_h: number | null }>(
      `select count(*)::int as total, count(*) filter (where status = 'responded')::int as responded,
              percentile_cont(0.5) within group (order by extract(epoch from (responded_at - created_at)) / 3600) filter (where responded_at is not null) as median_h
       from followups where requested_by = $1 and created_at > now() - interval '30 days'`, [userId]),
  ]);
  const snoozed = delegated.filter((t) => snoozes[t.id]).map((t) => ({ task: t, until: snoozes[t.id]! }));
  return {
    queue, awaiting, responded, waitingOnSomeone, log, snoozed,
    stats: {
      delegatedOpen: delegated.length,
      needs: queue.length,
      awaiting: awaiting.length,
      oldestAwaitingDays: awaiting.reduce((m, f) => Math.max(m, f.age_days), 0),
      respondedRate: rate && rate.total ? rate.responded / rate.total : null,
      medianResponseHours: rate?.median_h != null ? Number(rate.median_h) : null,
    },
  };
}

/** Follow-up history for one task (detail page). */
export const taskFollowups = (taskId: string) =>
  q<FollowupRow>(`${FU_SELECT} where f.entity_id = $1 and f.entity_type = 'task' order by f.created_at desc`, [taskId]);

export const snoozeUntil = (days = 2) => addDays(today(), days);
