import "server-only";
import { q, one } from "../db";
import { addMonths, monthStart, today } from "@/lib/dates";
import { listTasks } from "../tasks/queries";
import type { User } from "../auth";

export interface HomeStats { meetingsToday: number; openTasks: number; overdue: number; decisionsPending: number; followupsDue: number; momPending: number }

export async function homeStats(u: User): Promise<HomeStats> {
  const t = today();
  const r = await one<HomeStats>(
    `select
      (select count(distinct m.id)::int from meetings m join meeting_attendees a on a.meeting_id = m.id and a.user_id = $1
         where not m.cancelled and (m.starts_at at time zone 'Asia/Kolkata')::date = $2::date) as "meetingsToday",
      (select count(*)::int from tasks where owner_id = $1 and status in ('not_started','in_progress','waiting','blocked')) as "openTasks",
      (select count(*)::int from tasks where owner_id = $1 and status in ('not_started','in_progress','waiting','blocked') and due_date < $2) as overdue,
      (select count(*)::int from decisions where status in ('pending','proposed')) as "decisionsPending",
      (select count(*)::int from tasks t where (t.requester_id = $1 or t.created_by = $1) and t.owner_id is distinct from $1
         and t.status in ('not_started','in_progress','waiting','blocked')
         and (coalesce(t.last_update_at, t.created_at) < now() - interval '5 days' or t.due_date < $2)) as "followupsDue",
      (select count(*)::int from meetings m where not m.cancelled and m.ends_at < now() and m.mom_status in ('pending','draft','submitted')
         and m.starts_at::date >= (select joined_at from users where id = $1)) as "momPending"`,
    [u.id, t]);
  return r!;
}

export interface ScheduleItem { id: string; title: string; starts_at: string; ends_at: string | null; mom_status: string; mom_owner: string | null; review: string | null; project: string | null; attendees: { name: string; color: string | null }[]; prep_notes: string | null }

export async function todaySchedule(u: User): Promise<ScheduleItem[]> {
  return q<ScheduleItem>(
    `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, mo.name as mom_owner, r.name as review, p.name as project, m.prep_notes,
            coalesce((select json_agg(json_build_object('name', coalesce(uu.name, aa.name, aa.email), 'color', uu.avatar_color)) from meeting_attendees aa left join users uu on uu.id = aa.user_id where aa.meeting_id = m.id), '[]') as attendees
     from meetings m left join users mo on mo.id = m.mom_owner_id left join reviews r on r.id = m.review_id left join projects p on p.id = m.project_id
     where not m.cancelled and (m.starts_at at time zone 'Asia/Kolkata')::date = $2::date
       and exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $1)
     order by m.starts_at`, [u.id, today()]);
}

export const dueToday = (u: User) => listTasks({ ownerId: u.id, open: true, dueTo: today(), order: "priority", limit: 8 });

export interface AopOutcome {
  cycleName: string; labels: { plan: string; forecast: string; actual: string }; kind: string;
  lastClosed: string; ytdPlan: number; ytdActual: number; variance: number; variancePct: number;
  fyPlan: number; projection: number; runRateDelta: number; status: "on_track" | "at_risk" | "delayed";
  trend: { period: string; plan: number; actual: number | null; forecast: number | null }[];
}

/** Outcome → Variance → Trend for the active AOP cycle (compares only months that have actuals, so missing inputs don't look like savings). */
export async function aopOutcome(): Promise<AopOutcome | null> {
  const c = await one<{ id: string; name: string; labels: AopOutcome["labels"]; kind: string; fy_start: string }>(`select id, name, labels, kind, fy_start from aop_cycles where status = 'active' order by created_at limit 1`);
  if (!c) return null;
  const lastClosed = addMonths(monthStart(today()), -1);
  const trend = await q<{ period: string; plan: number; actual: number | null; forecast: number | null }>(
    `select v.period, coalesce(sum(v.plan),0) as plan, sum(v.actual) as actual, sum(v.forecast) as forecast
     from aop_period_values v join aop_items i on i.id = v.item_id where i.cycle_id = $1 group by v.period order by v.period`, [c.id]);
  const cmp = await one<{ plan: number; actual: number }>(
    `select coalesce(sum(v.plan),0) as plan, coalesce(sum(v.actual),0) as actual from aop_period_values v join aop_items i on i.id = v.item_id
     where i.cycle_id = $1 and v.period <= $2 and v.actual is not null and v.plan is not null`, [c.id, lastClosed]);
  const fy = await one<{ plan: number; projection: number }>(
    `select coalesce(sum(v.plan),0) as plan,
            coalesce(sum(case when v.period <= $2 and v.actual is not null then v.actual else coalesce(v.forecast, v.plan) end),0) as projection
     from aop_period_values v join aop_items i on i.id = v.item_id where i.cycle_id = $1`, [c.id, lastClosed]);
  const variance = (cmp?.actual ?? 0) - (cmp?.plan ?? 0);
  const variancePct = cmp?.plan ? variance / cmp.plan : 0;
  const cost = c.kind === "cost";
  const bad = cost ? variancePct : -variancePct;
  return {
    cycleName: c.name, labels: c.labels, kind: c.kind, lastClosed, ytdPlan: cmp?.plan ?? 0, ytdActual: cmp?.actual ?? 0, variance, variancePct,
    fyPlan: fy?.plan ?? 0, projection: fy?.projection ?? 0, runRateDelta: fy?.plan ? (fy.projection - fy.plan) / fy.plan : 0,
    status: bad > 0.05 ? "delayed" : bad > 0.01 ? "at_risk" : "on_track", trend,
  };
}

export async function projectsWatch() {
  return q<{ id: string; name: string; code: string | null; health: string; target_date: string | null; owner: string | null; overdue: number; next_ms: string | null; next_ms_due: string | null; progress: number }>(
    `select p.id, p.name, p.code, p.health, p.target_date, o.name as owner,
       (select count(*)::int from tasks t where t.project_id = p.id and t.status not in ('completed','cancelled') and t.due_date < $1) as overdue,
       (select title from milestones ms where ms.project_id = p.id and ms.status <> 'done' order by ms.due_date limit 1) as next_ms,
       (select due_date from milestones ms where ms.project_id = p.id and ms.status <> 'done' order by ms.due_date limit 1) as next_ms_due,
       coalesce((select avg(case when ms.status = 'done' then 1.0 else 0 end) from milestones ms where ms.project_id = p.id), 0)::float as progress
     from projects p left join users o on o.id = p.owner_id
     where p.status = 'active' order by array_position(array['delayed','at_risk','on_track'], p.health), p.target_date nulls last limit 6`, [today()]);
}

export async function followupPreview(u: User) {
  return listTasks({ delegatedBy: u.id, open: true, staleDays: 4, order: "updated", limit: 5 });
}
