import "server-only";
import { q, one } from "../db";
import { addMonths, dateOf, diffDays, monthStart, today } from "@/lib/dates";
import { listTasks, type TaskListItem } from "../tasks/queries";
import { listDecisions, type DecisionItem } from "../decisions/queries";
import { listRisks, type RiskItem } from "../risks/queries";
import { listProjects, type ProjectListItem } from "../projects/queries";

export const CADENCES = ["daily", "weekly", "fortnightly", "monthly", "quarterly", "adhoc"] as const;
export const REVIEW_MODULES = ["aop", "sop", "project", "program", "general"] as const;

export interface ReviewItem {
  id: string;
  name: string;
  cadence: string;
  description: string | null;
  module: string | null;
  active: boolean;
  calendar_match: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  mom_owner_id: string | null;
  mom_owner_name: string | null;
  mom_owner_color: string | null;
  program_id: string | null;
  program_name: string | null;
  program_code: string | null;
  project_id: string | null;
  project_name: string | null;
  next_id: string | null;
  next_at: string | null;
  last_id: string | null;
  last_at: string | null;
  last_mom_status: string | null;
  last_mom_owner_name: string | null;
  meetings: number;
  open_actions: number;
  overdue_actions: number;
}

export async function listReviews(ids?: string[]): Promise<ReviewItem[]> {
  return q<ReviewItem>(
    `select r.id, r.name, r.cadence, r.description, r.module, r.active, r.calendar_match,
            r.owner_id, ou.name as owner_name, ou.avatar_color as owner_color,
            r.mom_owner_id, mu.name as mom_owner_name, mu.avatar_color as mom_owner_color,
            r.program_id, g.name as program_name, g.code as program_code, r.project_id, p.name as project_name,
            nx.id as next_id, nx.starts_at as next_at, ls.id as last_id, ls.starts_at as last_at, ls.mom_status as last_mom_status, ls.mom_owner_name as last_mom_owner_name,
            (select count(*)::int from meetings m where m.review_id = r.id and not m.cancelled) as meetings,
            coalesce(ac.open, 0) as open_actions, coalesce(ac.overdue, 0) as overdue_actions
     from reviews r
     left join users ou on ou.id = r.owner_id
     left join users mu on mu.id = r.mom_owner_id
     left join programs g on g.id = r.program_id
     left join projects p on p.id = r.project_id
     left join lateral (select m.id, m.starts_at from meetings m where m.review_id = r.id and not m.cancelled and m.starts_at >= now() order by m.starts_at limit 1) nx on true
     left join lateral (select m.id, m.starts_at, m.mom_status, u.name as mom_owner_name from meetings m left join users u on u.id = m.mom_owner_id
                        where m.review_id = r.id and not m.cancelled and m.starts_at < now() order by m.starts_at desc limit 1) ls on true
     left join lateral (select count(*) filter (where t.status not in ('completed','cancelled'))::int as open,
                               count(*) filter (where t.status not in ('completed','cancelled') and t.due_date < $1::date)::int as overdue
                        from tasks t join meetings m on m.id = t.meeting_id where m.review_id = r.id) ac on true
     ${ids ? "where r.id = any($2::uuid[])" : ""}
     order by r.active desc, array_position(array['daily','weekly','fortnightly','monthly','quarterly','adhoc'], r.cadence), r.name`,
    ids ? [today(), ids] : [today()],
  );
}

export interface ReviewMeeting { id: string; title: string; starts_at: string; mom_status: string; mom_owner_name: string | null }

export interface AopKpi { name: string; plan: number; actual: number; plan_all: number; lines: number; missing: number }
export interface AopDeviation { item: string; section: string; plan: number; actual: number; variance: number }
export interface Submission { name: string; owner_name: string | null; status: string; due_date: string | null; submitted_at: string | null; period: string }
export interface SopAccuracy { stream: string; projection: number; actual: number }

export interface ReviewPack {
  review: ReviewItem;
  meetings: ReviewMeeting[];
  lastMeeting: ReviewMeeting | null;
  nextMeeting: ReviewMeeting | null;
  actions: { open: TaskListItem[]; overdue: TaskListItem[]; closed: TaskListItem[] };
  decisions: DecisionItem[];
  risks: RiskItem[];
  projects: ProjectListItem[];
  projectUpdates: { project: ProjectListItem; days: number | null }[];
  aop: { period: string; kpis: AopKpi[]; deviations: AopDeviation[]; submissions: Submission[] } | null;
  sop: { period: string; accuracyPeriod: string; submissions: Submission[]; accuracy: SopAccuracy[] } | null;
}

export async function getReviewPack(id: string): Promise<ReviewPack | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [review] = await listReviews([id]);
  if (!review) return null;
  const td = today();
  const meetings = await q<ReviewMeeting>(
    `select m.id, m.title, m.starts_at, m.mom_status, u.name as mom_owner_name from meetings m left join users u on u.id = m.mom_owner_id
     where m.review_id = $1 and not m.cancelled order by m.starts_at desc limit 20`, [id]);
  const now = Date.now();
  const past = meetings.filter((m) => new Date(m.starts_at).getTime() < now);
  const future = meetings.filter((m) => new Date(m.starts_at).getTime() >= now);
  const meetingIds = meetings.map((m) => m.id);

  // scope: the review's project, else its program's projects
  const scopeProjects = review.project_id
    ? await listProjects({ ids: [review.project_id] })
    : review.program_id ? (await listProjects({ programId: review.program_id })).filter((p) => p.status === "active" || p.status === "on_hold") : [];

  const [actionTasks, decisions, risks] = await Promise.all([
    meetingIds.length ? q<{ id: string }>(`select id from tasks where meeting_id = any($1::uuid[])`, [meetingIds]).then((r) => r.length ? listTasks({ ids: r.map((x) => x.id) }) : []) : Promise.resolve([] as TaskListItem[]),
    (async () => {
      const [a, b] = await Promise.all([
        meetingIds.length ? listDecisions({ meetingIds, status: "pending" }) : Promise.resolve([] as DecisionItem[]),
        review.project_id ? listDecisions({ projectId: review.project_id, status: "pending" }) : review.program_id ? listDecisions({ programId: review.program_id, status: "pending" }) : Promise.resolve([] as DecisionItem[]),
      ]);
      const seen = new Set<string>();
      return [...a, ...b].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
    })(),
    review.project_id ? listRisks({ projectId: review.project_id }) : review.program_id ? listRisks({ programId: review.program_id }) : Promise.resolve([] as RiskItem[]),
  ]);
  const since = past[1] ? past[1].starts_at : null; // closed since the previous meeting
  const open = actionTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const actions = {
    overdue: open.filter((t) => t.due_date && t.due_date < td),
    open: open.filter((t) => !(t.due_date && t.due_date < td)),
    closed: actionTasks.filter((t) => t.status === "completed" && (!since || (t.completed_at && new Date(t.completed_at) >= new Date(since)))),
  };

  const projectUpdates = scopeProjects.map((p) => ({ project: p, days: p.last_update_at ? diffDays(td, dateOf(p.last_update_at)) : null }));

  let aop: ReviewPack["aop"] = null;
  let sop: ReviewPack["sop"] = null;
  if (review.module === "aop") aop = await aopKpis(review.name);
  if (review.module === "sop") sop = await sopKpis();

  return {
    review, meetings, lastMeeting: past[0] ?? null, nextMeeting: future[future.length - 1] ?? null, actions, decisions, risks: risks.slice(0, 8),
    projects: scopeProjects, projectUpdates, aop, sop,
  };
}

/** Budget vs actual for the last closed month, straight from aop_period_values (like-for-like on lines with actuals). */
async function aopKpis(reviewName: string): Promise<NonNullable<ReviewPack["aop"]>> {
  const period = addMonths(monthStart(today()), -1);
  const functions = await q<{ name: string }>(`select s.name from aop_sections s join aop_cycles c on c.id = s.cycle_id where c.status = 'active' and s.parent_id is null`);
  // a function-specific review (e.g. "Logistics Cost & Disputes Review") narrows to that function and shows its groups
  const focus = functions.find((f) => reviewName.toLowerCase().includes(f.name.toLowerCase().split(/[\s&]/)[0]))?.name ?? null;
  const kpis = await q<AopKpi>(
    `select ${focus ? "s.name" : "coalesce(f.name, s.name)"} as name,
            coalesce(sum(v.plan) filter (where v.actual is not null), 0) as plan, coalesce(sum(v.actual), 0) as actual,
            coalesce(sum(v.plan), 0) as plan_all, count(*) filter (where v.plan > 0)::int as lines,
            count(*) filter (where coalesce(v.plan, 0) > 0 and v.actual is null)::int as missing
     from aop_period_values v
     join aop_items i on i.id = v.item_id and i.active
     join aop_sections s on s.id = i.section_id
     join aop_cycles c on c.id = s.cycle_id and c.status = 'active'
     left join aop_sections f on f.id = s.parent_id
     where v.period = $1 ${focus ? "and coalesce(f.name, s.name) = $2" : ""}
     group by 1 having coalesce(sum(v.plan), 0) > 0 or coalesce(sum(v.actual), 0) > 0
     order by coalesce(sum(v.actual), 0) - coalesce(sum(v.plan) filter (where v.actual is not null), 0) desc`,
    focus ? [period, focus] : [period]);
  const deviations = await q<AopDeviation>(
    `select i.name as item, coalesce(f.name || ' · ', '') || s.name as section, v.plan, v.actual, (v.actual - v.plan) as variance
     from aop_period_values v join aop_items i on i.id = v.item_id and i.active join aop_sections s on s.id = i.section_id
     join aop_cycles c on c.id = s.cycle_id and c.status = 'active' left join aop_sections f on f.id = s.parent_id
     where v.period = $1 and v.plan > 0 and v.actual > v.plan * 1.05 ${focus ? "and coalesce(f.name, s.name) = $2" : ""}
     order by (v.actual - v.plan) desc limit 8`, focus ? [period, focus] : [period]);
  const submissions = await q<Submission>(
    `select s.name, u.name as owner_name, sb.status, sb.due_date, sb.submitted_at, sb.period
     from aop_submissions sb join aop_sections s on s.id = sb.section_id left join users u on u.id = sb.owner_id
     where sb.kind = 'actuals' and sb.period = $1 ${focus ? "and s.name = $2" : ""} order by (sb.status = 'pending') desc, s.sort`, focus ? [period, focus] : [period]);
  return { period, kpis, deviations, submissions };
}

/** S&OP: projection submissions for the next month, and projection accuracy for the last closed month. */
async function sopKpis(): Promise<NonNullable<ReviewPack["sop"]>> {
  const period = addMonths(monthStart(today()), 1);
  const accuracyPeriod = addMonths(monthStart(today()), -1);
  const [submissions, accuracy] = await Promise.all([
    q<Submission>(
      `select st.name, coalesce(u.name, st.poc_label) as owner_name, sb.status, sb.due_date, sb.submitted_at, sb.period
       from sop_submissions sb join sop_streams st on st.id = sb.stream_id left join users u on u.id = st.poc_id
       where sb.period = $1 order by (sb.status in ('pending','late')) desc, st.sort`, [period]),
    q<SopAccuracy>(
      `select st.name as stream, coalesce(sum(coalesce(v.revised_projection, v.projection)), 0) as projection, coalesce(sum(v.actual), 0) as actual
       from sop_values v join sop_lines l on l.id = v.line_id join sop_streams st on st.id = l.stream_id
       where v.period = $1 and v.period_label = '' and v.dimension = '' and v.actual is not null
       group by st.name, st.sort order by st.sort`, [accuracyPeriod]),
  ]);
  return { period, accuracyPeriod, submissions, accuracy };
}

export async function reviewBasics(id: string) {
  return one<{ id: string; name: string; mom_owner_id: string | null }>(`select id, name, mom_owner_id from reviews where id = $1`, [id]);
}
