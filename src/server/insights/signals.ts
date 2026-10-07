import "server-only";
import { cache } from "react";
import { q, one } from "../db";
import { addMonths, monthStart, today } from "@/lib/dates";

/**
 * Cross-module signals (direct SQL against the schema). Shared by Exceptions, Insights, the morning brief,
 * reports and the assistant so every surface agrees on the numbers.
 * Scope: managers (admin/pm) see the organisation; everyone else sees work they own, requested or attend.
 */
export interface Scope { userId: string; manage: boolean; joinedAt: string; name: string; role: string }

/** Resolve the data scope for a user id (admin/pm → organisation). */
export const scopeFor = cache(async (userId: string): Promise<Scope> => {
  const u = await one<{ id: string; name: string; role: string; joined_at: string }>(`select id, name, role, joined_at from users where id = $1`, [userId]);
  if (!u) throw new Error("User not found");
  return { userId: u.id, name: u.name, role: u.role, manage: u.role === "admin" || u.role === "pm", joinedAt: u.joined_at };
});

/* ---------------- insight rules ---------------- */
export interface RuleRow { key: string; name: string; enabled: boolean; rule: Record<string, number | string>; severity: string }
export const getRules = cache(async () => {
  const rows = await q<RuleRow>(`select key, name, enabled, rule, severity from insight_rules`);
  return new Map(rows.map((r) => [r.key, r]));
});
export async function ruleNum(key: string, field: string, fallback: number) {
  const r = (await getRules()).get(key);
  const v = r?.rule?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
export async function ruleOn(key: string) {
  const r = (await getRules()).get(key);
  return r ? r.enabled : true;
}

/* ---------------- tasks ---------------- */
export interface TaskSig {
  id: string; number: number; title: string; status: string; priority: string; due_date: string | null;
  owner_id: string | null; owner_name: string | null; owner_team_name: string | null; requester_id: string | null; requester_name: string | null;
  project_id: string | null; project_code: string | null; project_name: string | null; days_since_update: number; blocker: string | null; last_update_note: string | null;
}
const TASK_COLS = `t.id, t.number, t.title, t.status, t.priority, t.due_date, t.owner_id, ou.name as owner_name, tm.name as owner_team_name,
  t.requester_id, ru.name as requester_name, t.project_id, pr.code as project_code, pr.name as project_name, t.blocker, t.last_update_note,
  extract(day from now() - coalesce(t.last_update_at, t.created_at))::int as days_since_update`;
const TASK_JOINS = `from tasks t left join users ou on ou.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
  left join users ru on ru.id = t.requester_id left join projects pr on pr.id = t.project_id`;
const OPEN = `t.status in ('not_started','in_progress','waiting','blocked')`;
const involving = (n: number) => `(t.owner_id = $${n} or t.requester_id = $${n} or t.created_by = $${n} or t.waiting_on_id = $${n})`;

export async function overdueTasks(s: Scope) {
  return q<TaskSig & { days_overdue: number }>(
    `select ${TASK_COLS}, ($1::date - t.due_date)::int as days_overdue ${TASK_JOINS}
     where ${OPEN} and t.due_date < $1::date and ($2 or ${involving(3)})
     order by t.due_date, array_position(array['urgent','high','medium','low'], t.priority)`, [today(), s.manage, s.userId]);
}
export async function staleDelegated(s: Scope, days?: number) {
  const d = days ?? await ruleNum("tasks.no_update", "threshold", 5);
  return q<TaskSig>(
    `select ${TASK_COLS} ${TASK_JOINS}
     where ${OPEN} and coalesce(t.owner_id::text, t.owner_team_id::text) is not null
       and coalesce(t.owner_id::text, '') <> coalesce(t.requester_id::text, t.created_by::text, '')
       and coalesce(t.last_update_at, t.created_at) < now() - make_interval(days => $1::int)
       and (($2 and t.requester_id is not null) or t.requester_id = $3 or t.created_by = $3)
     order by coalesce(t.last_update_at, t.created_at)`, [d, s.manage, s.userId]);
}
export async function blockedTasks(s: Scope) {
  return q<TaskSig>(`select ${TASK_COLS} ${TASK_JOINS} where t.status = 'blocked' and ($1 or ${involving(2)}) order by t.due_date nulls last`, [s.manage, s.userId]);
}

/* ---------------- projects, milestones, risks, decisions ---------------- */
export interface MilestoneSig {
  id: string; title: string; due_date: string; baseline_date: string | null; status: string; project_id: string; project_name: string; project_code: string | null;
  owner_id: string | null; owner_name: string | null; slip_days: number; overdue_days: number;
}
export async function milestoneSlips(s: Scope) {
  const thr = await ruleNum("projects.milestone_slip", "threshold", 3);
  return q<MilestoneSig>(
    `select m.id, m.title, m.due_date, m.baseline_date, m.status, p.id as project_id, p.name as project_name, p.code as project_code, p.owner_id, u.name as owner_name,
            coalesce(m.due_date - m.baseline_date, 0)::int as slip_days, greatest($1::date - m.due_date, 0)::int as overdue_days
     from milestones m join projects p on p.id = m.project_id left join users u on u.id = p.owner_id
     where m.status not in ('done') and p.status not in ('completed','cancelled') and m.due_date is not null
       and (m.due_date < $1::date or coalesce(m.due_date - m.baseline_date, 0) >= $2)
       and ($3 or p.owner_id = $4 or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = $4))
     order by greatest($1::date - m.due_date, 0) desc, coalesce(m.due_date - m.baseline_date, 0) desc`, [today(), thr, s.manage, s.userId]);
}

export interface ProjectSig {
  id: string; name: string; code: string | null; health: string; status: string; target_date: string | null; owner_id: string | null; owner_name: string | null;
  program_name: string | null; last_update_at: string | null; last_blockers: string | null; percent_complete: number | null; open_tasks: number; overdue_tasks: number;
}
export async function projectsAtRisk(s: Scope) {
  return q<ProjectSig>(
    `select p.id, p.name, p.code, p.health, p.status, p.target_date, p.owner_id, u.name as owner_name, pg.name as program_name,
            lu.created_at as last_update_at, lu.blockers as last_blockers, lu.percent_complete,
            (select count(*)::int from tasks t where t.project_id = p.id and ${OPEN}) as open_tasks,
            (select count(*)::int from tasks t where t.project_id = p.id and ${OPEN} and t.due_date < $1::date) as overdue_tasks
     from projects p left join users u on u.id = p.owner_id left join programs pg on pg.id = p.program_id
     left join lateral (select created_at, blockers, percent_complete from project_updates x where x.project_id = p.id order by created_at desc limit 1) lu on true
     where p.status in ('active','planned','on_hold') and p.health in ('at_risk','delayed')
       and ($2 or p.owner_id = $3 or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = $3))
     order by case p.health when 'delayed' then 0 else 1 end, p.target_date nulls last`, [today(), s.manage, s.userId]);
}

export interface RiskSig { id: string; title: string; score: number; status: string; owner_id: string | null; owner_name: string | null; project_id: string | null; project_name: string | null; mitigation: string | null; target_date: string | null; created_at: string }
export async function openRisks(s: Scope, minScore = 0) {
  return q<RiskSig>(
    `select r.id, r.title, r.score, r.status, r.owner_id, u.name as owner_name, r.project_id, p.name as project_name, r.mitigation, r.target_date, r.created_at
     from risks r left join users u on u.id = r.owner_id left join projects p on p.id = r.project_id
     where r.status <> 'closed' and r.score >= $1 and ($2 or r.owner_id = $3 or p.owner_id = $3)
     order by r.score desc, r.created_at desc`, [minScore, s.manage, s.userId]);
}

export interface DecisionSig { id: string; title: string; status: string; due_date: string | null; maker_id: string | null; maker_name: string | null; project_id: string | null; project_name: string | null; days_overdue: number }
export async function pendingDecisions(s: Scope) {
  return q<DecisionSig>(
    `select d.id, d.title, d.status, d.due_date, d.decision_maker_id as maker_id, u.name as maker_name, d.project_id, p.name as project_name,
            greatest($1::date - d.due_date, 0)::int as days_overdue
     from decisions d left join users u on u.id = d.decision_maker_id left join projects p on p.id = d.project_id
     where d.status in ('pending','proposed') and ($2 or d.decision_maker_id = $3 or d.created_by = $3)
     order by d.due_date nulls last`, [today(), s.manage, s.userId]);
}

/* ---------------- meetings ---------------- */
export interface MeetingSig { id: string; title: string; starts_at: string; ends_at: string | null; mom_status: string; mom_owner_id: string | null; mom_owner_name: string | null; mom_due_at: string | null; overdue: boolean; open_suggestions: number }
export async function meetingsWithoutMom(s: Scope) {
  return q<MeetingSig>(
    `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, coalesce(m.mom_owner_id, m.organizer_id) as mom_owner_id, u.name as mom_owner_name, m.mom_due_at,
            coalesce(m.mom_due_at < now(), false) as overdue, 0 as open_suggestions
     from meetings m left join users u on u.id = coalesce(m.mom_owner_id, m.organizer_id)
     where not m.cancelled and coalesce(m.ends_at, m.starts_at) < now() and m.mom_status in ('pending','draft')
       and (m.starts_at at time zone 'Asia/Kolkata')::date >= $1::date
       and ($2 or coalesce(m.mom_owner_id, m.organizer_id) = $3 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $3))
     order by m.starts_at desc`, [s.joinedAt, s.manage, s.userId]);
}
export async function momsToReview(s: Scope) {
  if (!s.manage) return [];
  return q<MeetingSig>(
    `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, coalesce(m.mom_owner_id, m.organizer_id) as mom_owner_id, u.name as mom_owner_name, m.mom_due_at, false as overdue,
            (select count(*)::int from meeting_suggestions x where x.meeting_id = m.id and x.status = 'pending') as open_suggestions
     from meetings m left join users u on u.id = coalesce(m.mom_owner_id, m.organizer_id)
     where not m.cancelled and m.mom_status = 'submitted' order by m.starts_at desc`);
}
export interface MeetingLite { id: string; title: string; starts_at: string; ends_at: string | null; mom_status: string; mom_owner_name: string | null; attendees: number; prep_notes: string | null; agenda: string | null }
export async function meetingsOn(s: Scope, date: string) {
  return q<MeetingLite>(
    `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, u.name as mom_owner_name, m.prep_notes, m.agenda,
            (select count(*)::int from meeting_attendees a where a.meeting_id = m.id) as attendees
     from meetings m left join users u on u.id = coalesce(m.mom_owner_id, m.organizer_id)
     where not m.cancelled and (m.starts_at at time zone 'Asia/Kolkata')::date = $1::date
       and ($2 or m.organizer_id = $3 or m.mom_owner_id = $3 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $3))
     order by m.starts_at`, [date, s.manage, s.userId]);
}

/* ---------------- AOP ---------------- */
export interface AopFunction { id: string; name: string; owner_id: string | null; owner_name: string | null; fy_plan: number; ytd_plan: number; ytd_plan_reported: number; ytd_actual: number; lines: number; lines_reported_last: number; lines_planned_last: number }
export interface AopLineDev { item_id: string; item: string; group_name: string; function_name: string; owner_id: string | null; owner_name: string | null; period: string; plan: number; actual: number; variance: number; variance_pct: number; direction: string }
export interface AopGroupStreak { section_id: string; group_name: string; function_name: string; owner_id: string | null; owner_name: string | null; months: { period: string; plan: number; actual: number; pct: number }[] }
export interface AopMissing { section_id: string; function_name: string; owner_id: string | null; owner_name: string | null; period: string; kind: string; due_date: string | null; days_late: number }
export interface AopState {
  cycle: { id: string; name: string; fy_start: string; labels: { plan: string; forecast: string; actual: string } } | null;
  lastClosed: string;
  functions: AopFunction[];
  totals: { fy_plan: number; ytd_plan: number; ytd_plan_reported: number; ytd_actual: number };
  overspends: AopLineDev[];
  savings: AopLineDev[];
  streaks: AopGroupStreak[];
  missing: AopMissing[];
}

export const aopState = cache(async (): Promise<AopState> => {
  const t = today();
  const lastClosed = addMonths(monthStart(t), -1);
  const cycle = await one<NonNullable<AopState["cycle"]>>(`select id, name, to_char(fy_start, 'YYYY-MM-DD') as fy_start, labels from aop_cycles where status = 'active' order by fy_start desc limit 1`);
  const empty: AopState = { cycle: null, lastClosed, functions: [], totals: { fy_plan: 0, ytd_plan: 0, ytd_plan_reported: 0, ytd_actual: 0 }, overspends: [], savings: [], streaks: [], missing: [] };
  if (!cycle) return empty;
  const thr = await ruleNum("aop.overspend", "threshold", 0.05);
  const tree = `with recursive tree as (
      select id, id as root, id as leaf_parent from aop_sections where cycle_id = $1 and parent_id is null
      union all select s.id, t.root, s.id from aop_sections s join tree t on s.parent_id = t.id)`;
  const [functions, lines, missing] = await Promise.all([
    q<AopFunction>(
      `${tree}
       select f.id, f.name, f.owner_id, u.name as owner_name,
              coalesce(sum(v.plan), 0) as fy_plan,
              coalesce(sum(v.plan) filter (where v.period <= $2::date), 0) as ytd_plan,
              coalesce(sum(v.plan) filter (where v.period <= $2::date and v.actual is not null), 0) as ytd_plan_reported,
              coalesce(sum(v.actual) filter (where v.period <= $2::date), 0) as ytd_actual,
              count(distinct i.id)::int as lines,
              count(distinct i.id) filter (where v.period = $2::date and v.actual is not null)::int as lines_reported_last,
              count(distinct i.id) filter (where v.period = $2::date and coalesce(v.plan, 0) <> 0)::int as lines_planned_last
       from aop_sections f left join users u on u.id = f.owner_id
       left join tree on tree.root = f.id
       left join aop_items i on i.section_id = tree.id and i.active
       left join aop_period_values v on v.item_id = i.id
       where f.cycle_id = $1 and f.parent_id is null
       group by f.id, f.name, f.owner_id, u.name, f.sort order by f.sort`, [cycle.id, lastClosed]),
    q<AopLineDev & { section_id: string; fn_id: string }>(
      `${tree}
       select i.id as item_id, i.name as item, g.id as section_id, g.name as group_name, f.id as fn_id, f.name as function_name, coalesce(i.owner_id, g.owner_id, f.owner_id) as owner_id,
              u.name as owner_name, to_char(v.period, 'YYYY-MM-DD') as period, coalesce(v.plan, 0) as plan, v.actual, i.direction,
              v.actual - coalesce(v.plan, 0) as variance, case when coalesce(v.plan, 0) = 0 then null else (v.actual - v.plan) / v.plan end as variance_pct
       from aop_items i join aop_sections g on g.id = i.section_id join tree on tree.id = g.id join aop_sections f on f.id = tree.root
       join aop_period_values v on v.item_id = i.id
       left join users u on u.id = coalesce(i.owner_id, g.owner_id, f.owner_id)
       where i.active and i.unit = 'inr' and v.actual is not null and v.period <= $2::date
       order by v.period`, [cycle.id, lastClosed]),
    q<AopMissing>(
      `select s.section_id, f.name as function_name, s.owner_id, u.name as owner_name, to_char(s.period, 'YYYY-MM-DD') as period, s.kind, s.due_date,
              greatest($2::date - s.due_date, 0)::int as days_late
       from aop_submissions s join aop_sections f on f.id = s.section_id left join users u on u.id = s.owner_id
       where s.cycle_id = $1 and s.status in ('pending','returned') and s.due_date <= $2::date + 3
       order by s.due_date, f.sort`, [cycle.id, t]),
  ]);
  const totals = functions.reduce((a, f) => ({ fy_plan: a.fy_plan + f.fy_plan, ytd_plan: a.ytd_plan + f.ytd_plan, ytd_plan_reported: a.ytd_plan_reported + f.ytd_plan_reported, ytd_actual: a.ytd_actual + f.ytd_actual }), empty.totals);

  // Latest reported month per line → overspend / saving (direction-aware, material only)
  const latest = new Map<string, AopLineDev>();
  for (const l of lines) latest.set(l.item_id, l);
  const bad = (l: AopLineDev) => (l.direction === "higher_better" ? -l.variance : l.variance);
  const material = (l: AopLineDev) => Math.abs(l.variance) >= 25_000 && l.plan > 0;
  const overspends = [...latest.values()].filter((l) => material(l) && bad(l) > 0 && Math.abs(l.variance_pct ?? 0) > thr).sort((a, b) => bad(b) - bad(a));
  const savings = [...latest.values()].filter((l) => material(l) && bad(l) < 0 && Math.abs(l.variance_pct ?? 0) > thr).sort((a, b) => bad(a) - bad(b));

  // Group-level streaks: consecutive complete months (≥80% of planned lines reported) over budget
  const periods = await ruleNum("aop.persistent", "periods", 2);
  const byGroup = new Map<string, { meta: AopLineDev & { section_id: string }; months: Map<string, { plan: number; actual: number; reported: number; planned: number }> }>();
  for (const l of lines) {
    const g = byGroup.get(l.section_id) ?? { meta: l, months: new Map() };
    const m = g.months.get(l.period) ?? { plan: 0, actual: 0, reported: 0, planned: 0 };
    m.plan += l.plan; m.actual += l.actual ?? 0; m.reported++; if (l.plan) m.planned++;
    g.months.set(l.period, m);
    byGroup.set(l.section_id, g);
  }
  const plannedCounts = await q<{ section_id: string; period: string; n: number }>(
    `select i.section_id, to_char(v.period, 'YYYY-MM-DD') as period, count(*)::int as n from aop_period_values v join aop_items i on i.id = v.item_id
     where i.cycle_id = $1 and i.active and coalesce(v.plan, 0) <> 0 and v.period <= $2::date group by 1, 2`, [cycle.id, lastClosed]);
  const plannedMap = new Map(plannedCounts.map((r) => [`${r.section_id}|${r.period}`, r.n]));
  const streaks: AopGroupStreak[] = [];
  for (const [sid, g] of byGroup) {
    const complete = [...g.months.entries()].filter(([p, m]) => m.plan > 0 && m.reported >= 0.8 * (plannedMap.get(`${sid}|${p}`) ?? m.planned)).sort(([a], [b]) => (a < b ? 1 : -1));
    const run: AopGroupStreak["months"] = [];
    for (const [p, m] of complete) {
      const over = g.meta.direction === "higher_better" ? m.actual < m.plan : m.actual > m.plan;
      if (!over || Math.abs(m.actual - m.plan) < 100_000) break;
      run.push({ period: p, plan: m.plan, actual: m.actual, pct: (m.actual - m.plan) / m.plan });
    }
    if (run.length >= periods)
      streaks.push({ section_id: sid, group_name: g.meta.group_name, function_name: g.meta.function_name, owner_id: g.meta.owner_id, owner_name: g.meta.owner_name, months: run.reverse() });
  }
  streaks.sort((a, b) => b.months.reduce((s, m) => s + m.actual - m.plan, 0) - a.months.reduce((s, m) => s + m.actual - m.plan, 0));
  return { cycle: { ...cycle, fy_start: cycle.fy_start }, lastClosed, functions, totals, overspends, savings, streaks, missing };
});

/* ---------------- S&OP ---------------- */
export interface SopLate { stream_id: string; stream: string; poc_id: string | null; poc_name: string | null; period: string; due_date: string | null; status: string; days_late: number; late_count: number }
export async function sopLateInputs(s: Scope) {
  return q<SopLate>(
    `select st.id as stream_id, st.name as stream, st.poc_id, u.name as poc_name, to_char(x.period, 'YYYY-MM-DD') as period, x.due_date, x.status,
            greatest($1::date - x.due_date, 0)::int as days_late,
            (select count(*)::int from sop_submissions y where y.stream_id = st.id and (y.status = 'late' or (y.status = 'pending' and y.due_date < $1::date))) as late_count
     from sop_submissions x join sop_streams st on st.id = x.stream_id left join users u on u.id = st.poc_id
     where st.active and (x.status = 'late' or (x.status = 'pending' and x.due_date < $1::date)) and ($2 or st.poc_id = $3)
     order by x.due_date`, [today(), s.manage, s.userId]);
}
export async function sopDueSoon(s: Scope, days = 14) {
  return q<SopLate>(
    `select st.id as stream_id, st.name as stream, st.poc_id, u.name as poc_name, to_char(x.period, 'YYYY-MM-DD') as period, x.due_date, x.status, 0 as days_late, 0 as late_count
     from sop_submissions x join sop_streams st on st.id = x.stream_id left join users u on u.id = st.poc_id
     where st.active and x.status = 'pending' and x.due_date between $1::date and $1::date + $4::int and ($2 or st.poc_id = $3)
     order by x.due_date, st.sort`, [today(), s.manage, s.userId, days]);
}
export interface CapacityBreach { period: string; warehouse: string; departments: number; worst_department: string; worst_gap: number; required: number; available: number }
export async function capacityBreaches() {
  const cur = monthStart(today());
  return q<CapacityBreach>(
    `select to_char(period, 'YYYY-MM-DD') as period, warehouse, count(*)::int as departments,
            (array_agg(department order by required - available desc))[1] as worst_department,
            max(required - available) as worst_gap, sum(required) as required, sum(available) as available
     from sop_capacity where period >= $1::date and required > available
     group by period, warehouse order by period, warehouse`, [cur]);
}

/* ---------------- follow-ups ---------------- */
export async function openFollowups(s: Scope) {
  return q<{ id: string; entity_type: string; entity_id: string; person_name: string | null; person_id: string | null; message: string | null; created_at: string; title: string | null; days_open: number }>(
    `select f.id, f.entity_type, f.entity_id, u.name as person_name, f.person_id, f.message, f.created_at,
            case when f.entity_type = 'task' then (select title from tasks where id = f.entity_id) end as title,
            extract(day from now() - f.created_at)::int as days_open
     from followups f left join users u on u.id = f.person_id
     where f.status = 'open' and (f.requested_by = $1 or f.person_id = $1 or $2)
     order by f.created_at`, [s.userId, s.manage]);
}
