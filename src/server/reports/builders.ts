import "server-only";
import { one, q } from "../db";
import { aiConfigured, aiText } from "../ai/provider";
import { addDays, dateOf, fmtDate, fmtMonth, fmtTime, today } from "@/lib/dates";
import { inr, pct, plural } from "@/lib/format";
import { MOM_STATUS, RISK_LEVEL, TASK_STATUS, type MomStatus, type TaskStatus } from "@/lib/meta";
import {
  aopState, blockedTasks, meetingsOn, milestoneSlips, openFollowups, openRisks, overdueTasks, pendingDecisions,
  projectsAtRisk, scopeFor, sopDueSoon, type Scope,
} from "../insights/signals";
import { morningBrief } from "./brief";
import { toText, type Block, type ListItem, type ReportDoc, type Section } from "./doc";
import { monthLong, withTimeout } from "./util";
import { getTemplates } from "../settings/queries";

export const REPORTS = [
  { kind: "daily", title: "Daily Brief", desc: "Morning brief: today's meetings, ranked priorities and what's slipping.", icon: "Sun" },
  { kind: "weekly", title: "Weekly Program Manager Review", desc: "Meetings, tasks created/closed, decisions, risks, wins, issues and next week's priorities.", icon: "CalendarRange" },
  { kind: "eod", title: "End-of-day Summary", desc: "What moved today, what's still open, and tomorrow's agenda.", icon: "Moon" },
  { kind: "project", title: "Project Status Report", desc: "Health, milestones, latest update, open work, risks and decisions for one project.", icon: "FolderKanban", pick: "project" },
  { kind: "risks", title: "Risk Report", desc: "Open risks by severity with owners, mitigations and target dates.", icon: "TriangleAlert" },
  { kind: "actions", title: "Action Closure Report", desc: "Meeting actions created vs closed, by meeting and review.", icon: "ListChecks" },
  { kind: "aop", title: "AOP Executive Summary", desc: "FY budget, YTD budget vs actuals, top overspends and savings, missing inputs.", icon: "Target" },
  { kind: "mom", title: "Meeting MoM", desc: "Formatted minutes for one meeting with decisions and actions.", icon: "NotebookPen", pick: "meeting" },
] as const;
export type ReportKind = (typeof REPORTS)[number]["kind"];

const ist = (col: string) => `(${col} at time zone 'Asia/Kolkata')::date`;
const list = (items: ListItem[], ordered = false): Block => ({ type: "list", items, ordered });
const p = (text: string): Block => ({ type: "p", text });
const sec = (heading: string, blocks: Block[], empty?: string): Section => ({ heading, blocks, empty });
const ownerOf = (r: { owner_name?: string | null; owner_team_name?: string | null }) => r.owner_name ?? r.owner_team_name ?? "Unassigned";
const now = () => new Date();
const stamp = () => `Generated ${fmtDate(today(), { dow: true })}, ${fmtTime(now())} IST · Central Ops`;

/* ---------------- Daily brief ---------------- */
async function daily(s: Scope): Promise<ReportDoc> {
  const t = today();
  const [b, meetings, overdue, fus] = await Promise.all([morningBrief(s.userId), meetingsOn(s, t), overdueTasks(s), openFollowups(s)]);
  const c = b.counts;
  return {
    kind: "daily", title: `Daily Brief — ${fmtDate(t, { dow: true })}`, subtitle: `${b.greeting}. Here's what needs attention today.`,
    sections: [
      sec("At a glance", [{ type: "stats", items: [
        { label: "Meetings today", value: String(c.meetings) },
        { label: "Overdue tasks", value: String(c.overdue), tone: c.overdue ? "red" : undefined },
        { label: "Open follow-ups", value: String(c.followups), tone: c.followups ? "amber" : undefined },
        { label: "Projects at risk", value: String(c.projectsAtRisk), tone: c.projectsAtRisk ? "amber" : undefined },
        { label: "Decisions pending", value: String(c.decisionsPending) },
        { label: "MoMs pending", value: String(c.momPending), tone: c.momPending ? "amber" : undefined },
      ] }]),
      sec("Priorities", [list(b.priorities.map((x) => ({ text: x.title, meta: x.detail, href: x.href })), true)], "Nothing urgent — a clear day."),
      sec("Today's meetings", [list(meetings.map((m) => ({ text: `${fmtTime(m.starts_at)} · ${m.title}`, meta: m.prep_notes?.split("\n")[0] ?? (m.mom_owner_name ? `MoM: ${m.mom_owner_name}` : undefined), href: `/meetings/${m.id}` })))], "No meetings today."),
      sec("Overdue", [list(overdue.slice(0, 10).map((x) => ({ text: x.title, meta: `${ownerOf(x)} · ${plural(x.days_overdue, "day")} late`, href: `/tasks/${x.id}`, tone: "red" })))], "Nothing overdue."),
      sec("Waiting on others", [list(fus.slice(0, 8).map((f) => ({ text: f.title ?? f.message ?? "Follow-up", meta: `${f.person_name ?? "—"} · asked ${plural(f.days_open, "day")} ago`, href: f.entity_type === "task" ? `/tasks/${f.entity_id}` : undefined })))], "No open follow-ups."),
    ],
    footer: stamp(),
  };
}

/* ---------------- Weekly PM review ---------------- */
async function weekly(s: Scope): Promise<ReportDoc> {
  const t = today();
  const from = [addDays(t, -6), s.joinedAt].sort().at(-1)!;
  const next = addDays(t, 7);
  const scopeTasks = `($2 or t.owner_id = $3 or t.requester_id = $3 or t.created_by = $3)`;
  const [meetings, counts, decisions, risks, atRisk, wins, milestonesDone, blocked, slips, critical, pending, nextMs, nextTasks, nextMeetings, aop, sopNext, tpl] = await Promise.all([
    q<{ id: string; title: string; starts_at: string; mom_status: MomStatus }>(
      `select m.id, m.title, m.starts_at, m.mom_status from meetings m where not m.cancelled and ${ist("m.starts_at")} between $1::date and $3::date and m.starts_at < now()
         and (m.organizer_id = $2 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $2)) order by m.starts_at`, [from, s.userId, t]),
    one<{ created: number; closed: number; overdue: number; open: number }>(
      `select count(*) filter (where ${ist("t.created_at")} >= $1::date)::int as created,
              count(*) filter (where t.status = 'completed' and ${ist("t.completed_at")} >= $1::date)::int as closed,
              count(*) filter (where t.status in ('not_started','in_progress','waiting','blocked') and t.due_date < $4::date)::int as overdue,
              count(*) filter (where t.status in ('not_started','in_progress','waiting','blocked'))::int as open
       from tasks t where ${scopeTasks}`, [from, s.manage, s.userId, t]),
    q<{ id: string; title: string; maker: string | null; meeting: string | null }>(
      `select d.id, d.title, u.name as maker, m.title as meeting from decisions d left join users u on u.id = d.decision_maker_id left join meetings m on m.id = d.meeting_id
       where d.status = 'made' and coalesce(d.decided_on, ${ist("d.created_at")}) >= $1::date order by d.decided_on desc`, [from]),
    q<{ id: string; title: string; score: number; owner: string | null }>(
      `select r.id, r.title, r.score, u.name as owner from risks r left join users u on u.id = r.owner_id where ${ist("r.created_at")} >= $1::date order by r.score desc`, [from]),
    projectsAtRisk(s),
    q<{ id: string; title: string; owner: string | null; project: string | null }>(
      `select t.id, t.title, u.name as owner, p.code as project from tasks t left join users u on u.id = t.owner_id left join projects p on p.id = t.project_id
       where t.status = 'completed' and ${ist("t.completed_at")} >= $1::date and t.priority in ('urgent','high') and ${scopeTasks} order by t.completed_at desc limit 8`, [from, s.manage, s.userId]),
    q<{ title: string; project: string; project_id: string }>(
      `select m.title, coalesce(p.code, p.name) as project, p.id as project_id from milestones m join projects p on p.id = m.project_id
       where m.status = 'done' and ${ist("m.completed_at")} >= $1::date order by m.completed_at desc`, [from]),
    blockedTasks(s), milestoneSlips(s), openRisks(s, 15), pendingDecisions(s),
    q<{ title: string; due_date: string; project: string; project_id: string }>(
      `select m.title, m.due_date, coalesce(p.code, p.name) as project, p.id as project_id from milestones m join projects p on p.id = m.project_id
       where m.status <> 'done' and m.due_date between $1::date and $2::date and p.status not in ('completed','cancelled') order by m.due_date`, [t, next]),
    q<{ id: string; title: string; due_date: string; owner: string | null }>(
      `select t.id, t.title, t.due_date, coalesce(u.name, tm.name) as owner from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
       where t.status in ('not_started','in_progress','waiting','blocked') and t.priority in ('urgent','high') and t.due_date between $1::date and $2::date
         and ($3 or t.owner_id = $4 or t.requester_id = $4) order by t.due_date limit 10`, [t, next, s.manage, s.userId]),
    q<{ id: string; title: string; starts_at: string }>(
      `select m.id, m.title, m.starts_at from meetings m where not m.cancelled and m.review_id is not null and m.starts_at > now() and ${ist("m.starts_at")} <= $1::date order by m.starts_at`, [next]),
    s.manage ? aopState() : null,
    sopDueSoon(s, 7),
    getTemplates(),
  ]);
  const c = counts ?? { created: 0, closed: 0, overdue: 0, open: 0 };
  const issues: ListItem[] = [
    ...slips.filter((m) => m.overdue_days > 0).map((m) => ({ text: `${m.project_code ?? m.project_name}: ${m.title} overdue by ${plural(m.overdue_days, "day")}`, href: `/projects/${m.project_id}`, tone: "red" as const })),
    ...blocked.map((b) => ({ text: `Blocked: ${b.title}`, meta: `${ownerOf(b)}${b.blocker ? ` — ${b.blocker}` : ""}`, href: `/tasks/${b.id}`, tone: "red" as const })),
    ...critical.map((r) => ({ text: `Critical risk: ${r.title}`, meta: `score ${r.score}${r.owner_name ? ` · ${r.owner_name}` : ""}`, href: "/risks", tone: "red" as const })),
    ...(aop?.streaks ?? []).slice(0, 3).map((g) => ({ text: `${g.function_name} ${g.group_name} over budget ${g.months.length} months running`, meta: g.months.map((m) => `${fmtMonth(m.period, false)} ${pct(m.pct, 1, true)}`).join(", "), href: "/aop", tone: "amber" as const })),
  ];
  const priorities: ListItem[] = [
    ...nextMs.map((m) => ({ text: `${m.project}: ${m.title}`, meta: `milestone · ${fmtDate(m.due_date, { dow: true })}`, href: `/projects/${m.project_id}` })),
    ...nextTasks.map((x) => ({ text: x.title, meta: `${x.owner ?? "Unassigned"} · ${fmtDate(x.due_date, { dow: true })}`, href: `/tasks/${x.id}` })),
    ...sopNext.map((x) => ({ text: `S&OP ${fmtMonth(x.period)} projection — ${x.stream}`, meta: `${x.poc_name ?? "—"} · due ${fmtDate(x.due_date)}`, href: "/sop" })),
    ...nextMeetings.map((m) => ({ text: `Review: ${m.title}`, meta: fmtDate(dateOf(m.starts_at), { dow: true }), href: `/meetings/${m.id}` })),
  ];
  const tplParts = tpl.weekly_report.split("{{report}}");
  const intro = tplParts.length > 1 ? tplParts[0].replace(/\{\{name\}\}/g, s.name).trim() : "";
  const outro = tplParts.length > 1 ? tplParts[1].replace(/\{\{name\}\}/g, s.name).trim() : "";
  return {
    kind: "weekly", title: "Weekly Program Manager Review", subtitle: `${fmtDate(from, { dow: true })} – ${fmtDate(t, { dow: true })} · ${s.name}`,
    sections: [
      ...(intro ? [sec("Note", [p(intro)])] : []),
      sec("Week in numbers", [{ type: "stats", items: [
        { label: "Meetings attended", value: String(meetings.length) },
        { label: "Tasks created", value: String(c.created) },
        { label: "Tasks closed", value: String(c.closed), tone: "green" },
        { label: "Overdue now", value: String(c.overdue), tone: c.overdue ? "red" : undefined },
        { label: "Decisions made", value: String(decisions.length) },
        { label: "Risks added", value: String(risks.length) },
      ] }]),
      sec("Meetings attended", [list(meetings.map((m) => ({ text: m.title, meta: `${fmtDate(dateOf(m.starts_at))} · ${MOM_STATUS[m.mom_status]?.label ?? m.mom_status}`, href: `/meetings/${m.id}` })))], "No meetings this week."),
      sec("Major wins", [list([
        ...milestonesDone.map((m) => ({ text: `${m.project}: ${m.title}`, meta: "milestone done", href: `/projects/${m.project_id}`, tone: "green" as const })),
        ...wins.map((w) => ({ text: w.title, meta: [w.owner, w.project].filter(Boolean).join(" · "), href: `/tasks/${w.id}`, tone: "green" as const })),
      ])], "No milestones or high-priority tasks closed this week."),
      sec("Decisions made", [list(decisions.map((d) => ({ text: d.title, meta: [d.maker, d.meeting].filter(Boolean).join(" · ") || undefined, href: "/decisions" })))], "No decisions recorded this week."),
      sec("Projects at risk", [list(atRisk.map((x) => ({ text: `${x.name} — ${x.health === "delayed" ? "Delayed" : "At risk"}`, meta: [x.owner_name, x.last_blockers ? `blocker: ${x.last_blockers}` : null, x.overdue_tasks ? `${x.overdue_tasks} overdue tasks` : null].filter(Boolean).join(" · "), href: `/projects/${x.id}`, tone: x.health === "delayed" ? "red" as const : "amber" as const })))], "All projects on track."),
      sec("Major issues", [list(issues)], "No major issues."),
      sec("Risks added", [list(risks.map((r) => ({ text: r.title, meta: `${RISK_LEVEL(r.score).label} (${r.score})${r.owner ? ` · ${r.owner}` : ""}`, href: "/risks" })))], "No new risks this week."),
      sec("Decisions pending", [list(pending.map((d) => ({ text: d.title, meta: [d.maker_name, d.due_date ? (d.days_overdue ? `${d.days_overdue}d past due` : `due ${fmtDate(d.due_date)}`) : null].filter(Boolean).join(" · "), href: "/decisions", tone: d.days_overdue ? "red" as const : undefined })))], "No decisions pending."),
      sec("Priorities next week", [list(priorities, true)], "Nothing scheduled for next week yet."),
      ...(outro ? [sec("—", [p(outro)])] : []),
    ],
    footer: stamp(),
  };
}

/* ---------------- End of day ---------------- */
async function eod(s: Scope): Promise<ReportDoc> {
  const t = today();
  const tom = addDays(t, 1);
  const scopeTasks = `($2 or t.owner_id = $3 or t.requester_id = $3 or t.created_by = $3)`;
  const [meetings, done, created, updates, overdue, dueTomorrow, tomorrow, fus, decisions] = await Promise.all([
    meetingsOn(s, t),
    q<{ id: string; title: string; owner: string | null }>(`select t.id, t.title, u.name as owner from tasks t left join users u on u.id = t.owner_id where t.status = 'completed' and ${ist("t.completed_at")} = $1::date and ${scopeTasks} order by t.completed_at`, [t, s.manage, s.userId]),
    q<{ id: string; title: string; owner: string | null }>(`select t.id, t.title, coalesce(u.name, tm.name) as owner from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id where ${ist("t.created_at")} = $1::date and ${scopeTasks} order by t.created_at`, [t, s.manage, s.userId]),
    q<{ task_id: string; title: string; author: string | null; body: string }>(
      `select x.task_id, t.title, u.name as author, x.body from task_updates x join tasks t on t.id = x.task_id left join users u on u.id = x.author_id
       where ${ist("x.created_at")} = $1::date and x.author_id is distinct from $3 and ${scopeTasks} order by x.created_at`, [t, s.manage, s.userId]),
    overdueTasks(s),
    q<{ id: string; title: string; owner: string | null }>(`select t.id, t.title, coalesce(u.name, tm.name) as owner from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id where t.status in ('not_started','in_progress','waiting','blocked') and t.due_date = $1::date and ${scopeTasks}`, [tom, s.manage, s.userId]),
    meetingsOn(s, tom),
    openFollowups(s),
    q<{ title: string }>(`select title from decisions where status = 'made' and coalesce(decided_on, ${ist("created_at")}) = $1::date`, [t]),
  ]);
  return {
    kind: "eod", title: `End-of-day Summary — ${fmtDate(t, { dow: true })}`, subtitle: s.name,
    sections: [
      sec("Today", [{ type: "stats", items: [
        { label: "Meetings", value: String(meetings.length) }, { label: "Tasks closed", value: String(done.length), tone: "green" },
        { label: "New tasks", value: String(created.length) }, { label: "Updates received", value: String(updates.length) },
        { label: "Still overdue", value: String(overdue.length), tone: overdue.length ? "red" : undefined },
      ] }]),
      sec("Meetings held", [list(meetings.map((m) => ({ text: `${fmtTime(m.starts_at)} · ${m.title}`, meta: MOM_STATUS[m.mom_status as MomStatus]?.label, href: `/meetings/${m.id}`, tone: m.mom_status === "pending" ? "amber" as const : undefined })))], "No meetings today."),
      sec("Closed today", [list(done.map((x) => ({ text: x.title, meta: x.owner ?? undefined, href: `/tasks/${x.id}`, tone: "green" as const })))], "Nothing closed today."),
      sec("Decisions logged", [list(decisions.map((d) => ({ text: d.title })))], "No decisions logged today."),
      sec("Updates received", [list(updates.map((u) => ({ text: `${u.title}: ${u.body}`, meta: u.author ?? undefined, href: `/tasks/${u.task_id}` })))], "No owner updates today."),
      sec("New tasks", [list(created.map((x) => ({ text: x.title, meta: x.owner ?? "Unassigned", href: `/tasks/${x.id}` })))], "No new tasks."),
      sec("Still open", [list([
        ...overdue.slice(0, 8).map((x) => ({ text: x.title, meta: `${ownerOf(x)} · ${x.days_overdue}d overdue`, href: `/tasks/${x.id}`, tone: "red" as const })),
        ...fus.slice(0, 5).map((f) => ({ text: `Awaiting update: ${f.title ?? f.message ?? "follow-up"}`, meta: f.person_name ?? undefined, href: f.entity_type === "task" ? `/tasks/${f.entity_id}` : undefined, tone: "amber" as const })),
      ])], "Nothing carried over."),
      sec("Tomorrow", [list([
        ...tomorrow.map((m) => ({ text: `${fmtTime(m.starts_at)} · ${m.title}`, href: `/meetings/${m.id}` })),
        ...dueTomorrow.map((x) => ({ text: `Due: ${x.title}`, meta: x.owner ?? undefined, href: `/tasks/${x.id}` })),
      ])], "Nothing scheduled for tomorrow."),
    ],
    footer: stamp(),
  };
}

/* ---------------- Project status ---------------- */
export async function projectOptions() {
  return q<{ value: string; label: string; hint: string | null }>(`select id as value, name as label, code as hint from projects where status <> 'cancelled' order by status = 'completed', name`);
}
async function project(s: Scope, id?: string): Promise<ReportDoc | null> {
  if (!id) return null;
  const pr = await one<{ id: string; name: string; code: string | null; objective: string | null; health: string; status: string; target_date: string | null; owner: string | null; program: string | null; budget: number | null; spent: number | null }>(
    `select p.id, p.name, p.code, p.objective, p.health, p.status, p.target_date, u.name as owner, g.name as program, p.budget, p.spent
     from projects p left join users u on u.id = p.owner_id left join programs g on g.id = p.program_id where p.id = $1`, [id]);
  if (!pr) return null;
  const t = today();
  const [ms, updates, tasks, risks, decisions] = await Promise.all([
    q<{ title: string; due_date: string | null; baseline_date: string | null; status: string }>(`select title, due_date, baseline_date, status from milestones where project_id = $1 order by sort, due_date`, [id]),
    q<{ what_changed: string | null; blockers: string | null; next_steps: string | null; decisions_required: string | null; percent_complete: number | null; health: string | null; created_at: string; author: string | null }>(
      `select x.what_changed, x.blockers, x.next_steps, x.decisions_required, x.percent_complete, x.health, x.created_at, u.name as author from project_updates x left join users u on u.id = x.author_id where x.project_id = $1 order by x.created_at desc limit 2`, [id]),
    q<{ id: string; title: string; status: TaskStatus; due_date: string | null; owner: string | null }>(
      `select t.id, t.title, t.status, t.due_date, coalesce(u.name, tm.name) as owner from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
       where t.project_id = $1 and t.status in ('not_started','in_progress','waiting','blocked') order by t.due_date nulls last`, [id]),
    q<{ title: string; score: number; status: string; owner: string | null; mitigation: string | null }>(`select r.title, r.score, r.status, u.name as owner, r.mitigation from risks r left join users u on u.id = r.owner_id where r.project_id = $1 and r.status <> 'closed' order by r.score desc`, [id]),
    q<{ title: string; status: string; decided_on: string | null; due_date: string | null }>(`select title, status, decided_on, due_date from decisions where project_id = $1 order by coalesce(decided_on, due_date) desc nulls last limit 10`, [id]),
  ]);
  const last = updates[0];
  const done = ms.filter((m) => m.status === "done").length;
  const msStatus = (m: (typeof ms)[number]) => m.status === "done" ? "Done" : m.due_date && m.due_date < t ? `Overdue ${t > m.due_date ? Math.round((Date.parse(t) - Date.parse(m.due_date)) / 864e5) : 0}d` : m.status === "in_progress" ? "In progress" : "Pending";
  return {
    kind: "project", title: `${pr.name} — Status`, subtitle: `${pr.program ?? "No program"} · Owner ${pr.owner ?? "—"} · ${fmtDate(t, { dow: true })}`,
    sections: [
      sec("Summary", [
        { type: "stats", items: [
          { label: "Health", value: pr.health === "on_track" ? "On track" : pr.health === "at_risk" ? "At risk" : "Delayed", tone: pr.health === "on_track" ? "green" : pr.health === "at_risk" ? "amber" : "red" },
          { label: "Complete", value: last?.percent_complete != null ? `${last.percent_complete}%` : "—" },
          { label: "Milestones", value: `${done}/${ms.length}` },
          { label: "Open tasks", value: String(tasks.length) },
          { label: "Target", value: pr.target_date ? fmtDate(pr.target_date) : "—" },
          ...(pr.budget ? [{ label: "Spent / budget", value: `${inr(pr.spent ?? 0)} / ${inr(pr.budget)}` }] : []),
        ] },
        ...(pr.objective ? [p(pr.objective)] : []),
      ]),
      sec("Milestones", ms.length ? [{ type: "table", columns: ["Milestone", "Due", "Baseline", "Status"], rows: ms.map((m) => [m.title, fmtDate(m.due_date), fmtDate(m.baseline_date), msStatus(m)]),
        tones: ms.map((m) => [null, null, null, m.status === "done" ? "green" : m.due_date && m.due_date < t ? "red" : null]) }] : [], "No milestones defined."),
      sec("Latest update", last ? [
        p(`${last.author ?? "Owner"}, ${fmtDate(dateOf(last.created_at))}: ${last.what_changed ?? "—"}`),
        list([
          ...(last.blockers ? [{ text: `Blockers: ${last.blockers}`, tone: "red" as const }] : []),
          ...(last.decisions_required ? [{ text: `Decisions required: ${last.decisions_required}` }] : []),
          ...(last.next_steps ? [{ text: `Next: ${last.next_steps}` }] : []),
        ]),
      ] : [], "No project update posted yet."),
      sec("Open tasks", [list(tasks.map((x) => ({ text: x.title, meta: `${x.owner ?? "Unassigned"} · ${TASK_STATUS[x.status].label}${x.due_date ? ` · due ${fmtDate(x.due_date)}` : ""}`, href: `/tasks/${x.id}`, tone: x.due_date && x.due_date < t ? "red" as const : undefined })))], "No open tasks."),
      sec("Risks", [list(risks.map((r) => ({ text: r.title, meta: `${RISK_LEVEL(r.score).label} (${r.score}) · ${r.owner ?? "—"}${r.mitigation ? ` · ${r.mitigation}` : ""}`, tone: r.score >= 15 ? "red" as const : r.score >= 10 ? "amber" as const : undefined })))], "No open risks."),
      sec("Decisions", [list(decisions.map((d) => ({ text: d.title, meta: d.status === "made" ? `decided ${fmtDate(d.decided_on)}` : `pending${d.due_date ? ` · due ${fmtDate(d.due_date)}` : ""}` })))], "No decisions recorded."),
    ],
    footer: stamp(),
  };
}

/* ---------------- Risks ---------------- */
async function risksReport(s: Scope): Promise<ReportDoc> {
  const rs = await openRisks(s);
  const groups = [["Critical", 15, 99], ["High", 10, 14], ["Medium", 5, 9], ["Low", 0, 4]] as const;
  return {
    kind: "risks", title: "Risk Report", subtitle: `${plural(rs.length, "open risk")} · ${fmtDate(today(), { dow: true })}`,
    sections: [
      sec("Overview", [{ type: "stats", items: groups.map(([l, a, b]): { label: string; value: string; tone?: "red" | "amber" } => ({ label: l, value: String(rs.filter((r) => r.score >= a && r.score <= b).length), tone: l === "Critical" ? "red" as const : l === "High" ? "amber" as const : undefined })).concat([{ label: "Escalated", value: String(rs.filter((r) => r.status === "escalated").length), tone: undefined }]) }]),
      ...groups.map(([l, a, b]) => sec(`${l} risks`, [list(rs.filter((r) => r.score >= a && r.score <= b).map((r) => ({
        text: `${r.title}${r.status === "escalated" ? " (escalated)" : r.status === "mitigating" ? " (mitigating)" : ""}`,
        meta: [`score ${r.score}`, r.owner_name, r.project_name, r.mitigation ? `mitigation: ${r.mitigation}` : "no mitigation", r.target_date ? `target ${fmtDate(r.target_date)}` : null].filter(Boolean).join(" · "),
        href: r.project_id ? `/projects/${r.project_id}` : "/risks", tone: l === "Critical" ? "red" as const : l === "High" ? "amber" as const : undefined,
      })))], `No ${l.toLowerCase()} risks.`)),
    ],
    footer: stamp(),
  };
}

/* ---------------- Action closure ---------------- */
async function actions(s: Scope): Promise<ReportDoc> {
  const t = today();
  const from = [addDays(t, -30), s.joinedAt].sort().at(-1)!;
  const rows = await q<{ id: string; title: string; starts_at: string; review: string | null; created: number; closed: number; open: number; overdue: number; pending_suggestions: number }>(
    `select m.id, m.title, m.starts_at, r.name as review,
            count(t.id)::int as created, count(t.id) filter (where t.status = 'completed')::int as closed,
            count(t.id) filter (where t.status in ('not_started','in_progress','waiting','blocked'))::int as open,
            count(t.id) filter (where t.status in ('not_started','in_progress','waiting','blocked') and t.due_date < $2::date)::int as overdue,
            (select count(*)::int from meeting_suggestions x where x.meeting_id = m.id and x.status = 'pending' and x.kind in ('action','followup')) as pending_suggestions
     from meetings m left join reviews r on r.id = m.review_id left join tasks t on t.meeting_id = m.id and t.status <> 'cancelled'
     where not m.cancelled and m.starts_at < now() and ${ist("m.starts_at")} >= $1::date
       and ($3 or m.organizer_id = $4 or m.mom_owner_id = $4 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $4))
     group by m.id, m.title, m.starts_at, r.name order by m.starts_at desc`, [from, t, s.manage, s.userId]);
  const withActions = rows.filter((r) => r.created || r.pending_suggestions);
  const tot = withActions.reduce((a, r) => ({ created: a.created + r.created, closed: a.closed + r.closed, overdue: a.overdue + r.overdue, pending: a.pending + r.pending_suggestions }), { created: 0, closed: 0, overdue: 0, pending: 0 });
  const byReview = new Map<string, { created: number; closed: number; overdue: number; meetings: number }>();
  for (const r of withActions) {
    const k = r.review ?? "Ad-hoc meetings";
    const v = byReview.get(k) ?? { created: 0, closed: 0, overdue: 0, meetings: 0 };
    byReview.set(k, { created: v.created + r.created, closed: v.closed + r.closed, overdue: v.overdue + r.overdue, meetings: v.meetings + 1 });
  }
  const rate = (c: number, d: number) => (d ? pct(c / d) : "—");
  return {
    kind: "actions", title: "Action Closure Report", subtitle: `Meeting actions since ${fmtDate(from)} · ${fmtDate(t, { dow: true })}`,
    sections: [
      sec("Overview", [{ type: "stats", items: [
        { label: "Actions created", value: String(tot.created) }, { label: "Closed", value: String(tot.closed), tone: "green" },
        { label: "Closure rate", value: rate(tot.closed, tot.created) }, { label: "Overdue", value: String(tot.overdue), tone: tot.overdue ? "red" : undefined },
        { label: "Awaiting distribution", value: String(tot.pending), tone: tot.pending ? "amber" : undefined, hint: "suggested in MoMs, not yet tasks" },
      ] }]),
      sec("By review", byReview.size ? [{ type: "table", columns: ["Review", "Meetings", "Created", "Closed", "Overdue", "Closure"], align: ["l", "r", "r", "r", "r", "r"],
        rows: [...byReview.entries()].map(([k, v]) => [k, String(v.meetings), String(v.created), String(v.closed), String(v.overdue), rate(v.closed, v.created)]),
        tones: [...byReview.values()].map((v) => [null, null, null, null, v.overdue ? "red" : null, null]) }] : [], "No meeting actions yet."),
      sec("By meeting", withActions.length ? [{ type: "table", columns: ["Meeting", "Date", "Created", "Closed", "Open", "Overdue", "Pending review"], align: ["l", "l", "r", "r", "r", "r", "r"],
        rows: withActions.map((r) => [r.title, fmtDate(dateOf(r.starts_at)), String(r.created), String(r.closed), String(r.open), String(r.overdue), String(r.pending_suggestions)]),
        tones: withActions.map((r) => [null, null, null, null, null, r.overdue ? "red" : null, r.pending_suggestions ? "amber" : null]) }] : [], "No meeting actions yet."),
    ],
    footer: stamp(),
  };
}

/* ---------------- AOP executive summary ---------------- */
async function aopReport(): Promise<ReportDoc> {
  const a = await aopState();
  if (!a.cycle) return { kind: "aop", title: "AOP Executive Summary", subtitle: "No active AOP cycle", sections: [sec("Status", [], "Set up an AOP cycle to see this report.")], footer: stamp() };
  const L = a.cycle.labels;
  const v = a.totals.ytd_plan_reported ? (a.totals.ytd_actual - a.totals.ytd_plan_reported) / a.totals.ytd_plan_reported : null;
  const missing = a.missing.filter((m) => m.days_late > 0 || m.due_date === today());
  return {
    kind: "aop", title: "AOP Executive Summary", subtitle: `${a.cycle.name} · YTD through ${monthLong(a.lastClosed, true)}`,
    sections: [
      sec("Headline", [
        { type: "stats", items: [
          { label: `FY ${L.plan.toLowerCase()}`, value: inr(a.totals.fy_plan) },
          { label: `YTD ${L.plan.toLowerCase()}`, value: inr(a.totals.ytd_plan) },
          { label: `YTD ${L.actual.toLowerCase()}`, value: inr(a.totals.ytd_actual) },
          { label: "Variance (reported lines)", value: v == null ? "—" : pct(v, 1, true), tone: v == null ? undefined : v > 0.02 ? "red" : v < -0.02 ? "green" : undefined },
          { label: "Missing inputs", value: String(missing.length), tone: missing.length ? "amber" : undefined },
        ] },
        p(`Year-to-date ${L.actual.toLowerCase()} of ${inr(a.totals.ytd_actual)} against ${inr(a.totals.ytd_plan_reported)} ${L.plan.toLowerCase()} on lines that have reported (${v == null ? "no variance yet" : `${pct(Math.abs(v), 1)} ${v > 0 ? "over" : "under"}`}). ${a.overspends.length} lines are over ${L.plan.toLowerCase()} in their latest reported month; ${a.streaks.length ? `${a.streaks.map((g) => `${g.function_name} ${g.group_name}`).join(", ")} ${a.streaks.length === 1 ? "has" : "have"} been over for consecutive months.` : "no group is over for consecutive months."}`),
      ]),
      sec("By function", [{ type: "table", columns: ["Function", "Owner", `FY ${L.plan}`, `YTD ${L.plan}*`, `YTD ${L.actual}`, "Var", `${fmtMonth(a.lastClosed, false)} lines in`], align: ["l", "l", "r", "r", "r", "r", "r"],
        rows: a.functions.map((f) => { const fv = f.ytd_plan_reported ? (f.ytd_actual - f.ytd_plan_reported) / f.ytd_plan_reported : null; return [f.name, f.owner_name ?? "—", inr(f.fy_plan), inr(f.ytd_plan_reported), inr(f.ytd_actual), fv == null ? "—" : pct(fv, 1, true), `${f.lines_reported_last}/${f.lines_planned_last}`]; }),
        tones: a.functions.map((f) => { const fv = f.ytd_plan_reported ? (f.ytd_actual - f.ytd_plan_reported) / f.ytd_plan_reported : 0; return [null, null, null, null, null, fv > 0.05 ? "red" : fv < -0.05 ? "green" : null, f.lines_reported_last < f.lines_planned_last ? "amber" : null]; }) },
        p(`* ${L.plan} on months where ${L.actual.toLowerCase()} have been reported, so the variance compares like with like.`)]),
      sec("Persistent overspends", [list(a.streaks.map((g) => ({ text: `${g.function_name} · ${g.group_name} — over ${g.months.length} months running`, meta: `${g.months.map((m) => `${fmtMonth(m.period, false)} ${pct(m.pct, 1, true)}`).join(", ")}${g.owner_name ? ` · ${g.owner_name}` : ""}`, tone: "red" as const, href: "/aop" })))], "No group over budget for consecutive months."),
      sec("Top overspends (latest reported month)", [list(a.overspends.slice(0, 8).map((l) => ({ text: `${l.function_name} · ${l.item}`, meta: `${fmtMonth(l.period)}: ${inr(l.actual)} vs ${inr(l.plan)} (${inr(l.variance, { sign: true })}, ${pct(l.variance_pct, 0, true)})${l.owner_name ? ` · ${l.owner_name}` : ""}`, tone: "red" as const, href: "/aop" })))], "No material overspends."),
      sec("Top savings", [list(a.savings.slice(0, 6).map((l) => ({ text: `${l.function_name} · ${l.item}`, meta: `${fmtMonth(l.period)}: ${inr(l.actual)} vs ${inr(l.plan)} (${inr(l.variance, { sign: true })})`, tone: "green" as const, href: "/aop" })))], "No material savings."),
      sec("Missing inputs", [list(missing.map((m) => ({ text: `${m.function_name} — ${monthLong(m.period)} ${m.kind}`, meta: `${m.owner_name ?? "—"} · ${m.days_late ? `${plural(m.days_late, "day")} late` : "due today"}`, tone: m.days_late ? "red" as const : "amber" as const, href: "/aop" })))], "All inputs are in."),
    ],
    footer: stamp(),
  };
}

/* ---------------- Meeting MoM ---------------- */
export async function meetingOptions(s: Scope) {
  return q<{ value: string; label: string; hint: string }>(
    `select m.id as value, m.title as label, to_char(m.starts_at at time zone 'Asia/Kolkata', 'Mon DD') as hint from meetings m
     where not m.cancelled and m.starts_at < now() and (m.starts_at at time zone 'Asia/Kolkata')::date >= $1::date
       and ($2 or m.organizer_id = $3 or m.mom_owner_id = $3 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $3))
     order by m.starts_at desc limit 100`, [s.joinedAt, s.manage, s.userId]);
}
async function mom(s: Scope, id?: string): Promise<ReportDoc | null> {
  if (!id) return null;
  const m = await one<{ id: string; title: string; starts_at: string; ends_at: string | null; mom_status: MomStatus; summary: string | null; agenda: string | null; mom_owner: string | null; review: string | null; project: string | null; follow_up_date: string | null; pm_feedback: string | null }>(
    `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, m.summary, m.agenda, u.name as mom_owner, r.name as review, p.name as project, m.follow_up_date, m.pm_feedback
     from meetings m left join users u on u.id = coalesce(m.mom_owner_id, m.organizer_id) left join reviews r on r.id = m.review_id left join projects p on p.id = m.project_id where m.id = $1`, [id]);
  if (!m) return null;
  const [att, note, decisions, tasks, risks, sugg, next] = await Promise.all([
    q<{ name: string }>(`select coalesce(u.name, a.name, a.email) as name from meeting_attendees a left join users u on u.id = a.user_id where a.meeting_id = $1 order by 1`, [id]),
    one<{ body: string; discussion: string | null; ai_output: { summary?: string; discussion?: string[] } | null }>(`select body, discussion, ai_output from meeting_notes where meeting_id = $1 and kind = 'mom' order by coalesce(submitted_at, updated_at) desc limit 1`, [id]),
    q<{ title: string; maker: string | null; status: string }>(`select d.title, u.name as maker, d.status from decisions d left join users u on u.id = d.decision_maker_id where d.meeting_id = $1 order by d.created_at`, [id]),
    q<{ id: string; title: string; owner: string | null; due_date: string | null; status: TaskStatus }>(
      `select t.id, t.title, coalesce(u.name, tm.name) as owner, t.due_date, t.status from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id where t.meeting_id = $1 order by t.created_at`, [id]),
    q<{ title: string; score: number; owner: string | null }>(`select r.title, r.score, u.name as owner from risks r left join users u on u.id = r.owner_id where r.meeting_id = $1`, [id]),
    q<{ kind: string; payload: { title?: string; owner_name?: string; due_date?: string } }>(`select kind, payload from meeting_suggestions where meeting_id = $1 and status = 'pending' order by sort`, [id]),
    one<{ id: string; starts_at: string }>(`select n.id, n.starts_at from meetings n join meetings m on m.id = $1 where n.review_id = m.review_id and n.starts_at > m.starts_at and not n.cancelled order by n.starts_at limit 1`, [id]),
  ]);
  const date = dateOf(m.starts_at);
  const summary = m.summary ?? note?.ai_output?.summary ?? null;
  const pendingActions = sugg.filter((x) => x.kind === "action" || x.kind === "followup");
  const pendingDecisions = sugg.filter((x) => x.kind === "decision");
  return {
    kind: "mom", title: `Minutes — ${m.title}`, subtitle: `${fmtDate(date, { dow: true })}, ${fmtTime(m.starts_at)}${m.ends_at ? `–${fmtTime(m.ends_at)}` : ""} IST${m.review ? ` · ${m.review}` : ""}`,
    sections: [
      sec("Details", [list([
        { text: `Attendees: ${att.map((a) => a.name).join(", ") || "—"}` },
        { text: `MoM owner: ${m.mom_owner ?? "—"} · ${MOM_STATUS[m.mom_status]?.label ?? m.mom_status}` },
        ...(m.project ? [{ text: `Project: ${m.project}` }] : []),
      ])]),
      ...(m.agenda ? [sec("Agenda", [{ type: "pre", text: m.agenda }])] : []),
      sec("Summary", summary ? [p(summary)] : [], m.mom_status === "pending" ? "MoM not written yet." : "No summary."),
      ...(note?.ai_output?.discussion?.length ? [sec("Discussion", [list(note.ai_output.discussion.map((d) => ({ text: d })))])] : note?.body && !summary ? [sec("Notes", [{ type: "pre", text: note.body }])] : []),
      sec("Decisions", [list([...decisions.map((d) => ({ text: d.title, meta: d.maker ?? undefined })), ...pendingDecisions.map((d) => ({ text: d.payload.title ?? "Decision", meta: "pending review", tone: "amber" as const }))])], "No decisions recorded."),
      sec("Action items", [list([
        ...tasks.map((x) => ({ text: x.title, meta: `${x.owner ?? "Unassigned"}${x.due_date ? ` · ${fmtDate(x.due_date)}` : ""} · ${TASK_STATUS[x.status].label}`, href: `/tasks/${x.id}`, tone: x.status === "completed" ? "green" as const : x.due_date && x.due_date < today() ? "red" as const : undefined })),
        ...pendingActions.map((x) => ({ text: x.payload.title ?? "Action", meta: `${x.payload.owner_name ?? "—"}${x.payload.due_date ? ` · ${fmtDate(x.payload.due_date)}` : ""} · awaiting PM review`, tone: "amber" as const })),
      ])], "No actions recorded."),
      ...(risks.length ? [sec("Risks", [list(risks.map((r) => ({ text: r.title, meta: `${RISK_LEVEL(r.score).label}${r.owner ? ` · ${r.owner}` : ""}` })))])] : []),
      ...(m.pm_feedback ? [sec("PM notes", [p(m.pm_feedback)])] : []),
      sec("Next", [list([...(next ? [{ text: `Next review: ${fmtDate(dateOf(next.starts_at), { dow: true })}`, href: `/meetings/${next.id}` }] : []), ...(m.follow_up_date ? [{ text: `Follow-up on ${fmtDate(m.follow_up_date)}` }] : [])])], "No follow-up scheduled."),
    ],
    footer: stamp(),
  };
}

/* ---------------- entry ---------------- */
export async function buildReport(kind: string, userId: string, opts: { project?: string; meeting?: string } = {}): Promise<ReportDoc | null> {
  const s = await scopeFor(userId);
  switch (kind) {
    case "daily": return daily(s);
    case "weekly": return weekly(s);
    case "eod": return eod(s);
    case "project": return project(s, opts.project);
    case "risks": return risksReport(s);
    case "actions": return actions(s);
    case "aop": return aopReport();
    case "mom": return mom(s, opts.meeting);
    default: return null;
  }
}

/** Optional AI polish: a short executive summary written from the rule-built document. Null when AI is off or fails. */
export async function polishReport(doc: ReportDoc): Promise<string | null> {
  if (!aiConfigured()) return null;
  return withTimeout(aiText({
    system: "You write crisp executive summaries for the Central Operations program manager at Snitch (Indian menswear retailer). Use only facts in the report. 3–5 sentences, plain text, no headings, no bullets, no invented numbers. Lead with what needs action.",
    prompt: toText(doc).slice(0, 14000),
    maxTokens: 600,
  }), 30000);
}
