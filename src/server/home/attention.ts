import "server-only";
import { q, one } from "../db";
import { addMonths, diffDays, fmtDate, fmtMonth, fmtTime, monthStart, today } from "@/lib/dates";
import { inr, num, plural } from "@/lib/format";
import type { User } from "../auth";

export type Severity = "critical" | "high" | "medium" | "info";
export interface AttentionItem {
  key: string;
  severity: Severity;
  area: "tasks" | "followups" | "meetings" | "aop" | "sop" | "projects" | "decisions" | "risks";
  title: string;
  detail?: string;
  cta: { label: string; href: string };
  secondary?: { label: string; href: string };
  weight: number;
}

const SEV_RANK: Record<Severity, number> = { critical: 300, high: 200, medium: 100, info: 0 };

/**
 * The attention engine: turns the state of every module into a short, ranked list of things the
 * Program Manager should act on today. Exception-first — counts only appear when something is wrong.
 */
export async function attention(u: User): Promise<AttentionItem[]> {
  const t = today();
  const manager = u.role === "admin" || u.role === "pm";
  const out: AttentionItem[] = [];
  const push = (i: AttentionItem) => out.push(i);

  const [mine, delegated, critToday, moms, aop, aopFns, sopPending, capacity, nextMeeting] = await Promise.all([
    one<{ overdue: number; oldest: string | null; blocked: number }>(
      `select count(*) filter (where due_date < $2)::int as overdue, min(due_date) filter (where due_date < $2) as oldest, count(*) filter (where status = 'blocked')::int as blocked
       from tasks where owner_id = $1 and status in ('not_started','in_progress','waiting','blocked')`, [u.id, t]),
    q<{ id: string; title: string; owner: string | null; days: number; overdue: boolean }>(
      `select t.id, t.title, coalesce(o.name, tm.name) as owner, extract(day from now() - coalesce(t.last_update_at, t.created_at))::int as days, (t.due_date < $2) as overdue
       from tasks t left join users o on o.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
       where (t.requester_id = $1 or t.created_by = $1) and t.owner_id is distinct from $1 and t.status in ('not_started','in_progress','waiting','blocked')
         and (coalesce(t.last_update_at, t.created_at) < now() - interval '5 days' or t.due_date < $2)
       order by (t.due_date < $2) desc, coalesce(t.last_update_at, t.created_at) asc`, [u.id, t]),
    q<{ id: string; title: string }>(`select id, title from tasks where owner_id = $1 and due_date = $2 and priority in ('urgent','high') and status not in ('completed','cancelled')`, [u.id, t]),
    q<{ id: string; title: string; mom_status: string; ends_at: string; mom_owner: string | null; mom_owner_id: string | null; suggestions: number }>(
      `select m.id, m.title, m.mom_status, m.ends_at, o.name as mom_owner, m.mom_owner_id,
              (select count(*)::int from meeting_suggestions s where s.meeting_id = m.id and s.status = 'pending') as suggestions
       from meetings m left join users o on o.id = m.mom_owner_id
       where not m.cancelled and m.ends_at < now() and m.starts_at::date >= $2::date and m.ends_at > now() - interval '21 days'
         and (m.mom_status in ('pending','draft') or (m.mom_status = 'submitted' and $3))
         and ($3 or m.mom_owner_id = $1 or m.organizer_id = $1)
       order by m.ends_at desc`, [u.id, u.joined_at, manager]),
    one<{ id: string; name: string; labels: { plan: string; actual: string }; fy_start: string } >(`select id, name, labels, fy_start from aop_cycles where status = 'active' order by created_at limit 1`),
    q<{ name: string; owner: string | null; due_date: string; kind: string; period: string }>(
      `select sec.name, o.name as owner, s.due_date, s.kind, s.period from aop_submissions s join aop_sections sec on sec.id = s.section_id
       left join users o on o.id = s.owner_id join aop_cycles c on c.id = s.cycle_id
       where c.status = 'active' and s.status = 'pending' and s.due_date <= $1::date + 3 order by s.due_date`, [t]),
    q<{ name: string; poc: string | null; due_date: string; period: string; status: string }>(
      `select st.name, o.name as poc, s.due_date, s.period, s.status from sop_submissions s join sop_streams st on st.id = s.stream_id left join users o on o.id = st.poc_id
       where s.status in ('pending','late') and s.due_date <= $1::date + 21 order by s.due_date`, [t]),
    q<{ period: string; warehouse: string; department: string; short: number }>(
      `select period, warehouse, department, (required - available) as short from sop_capacity
       where required > available and period >= $1::date order by period, (required - available) desc limit 5`, [monthStart(t)]),
    one<{ id: string; title: string; starts_at: string; review_module: string | null }>(
      `select m.id, m.title, m.starts_at, r.module as review_module from meetings m left join reviews r on r.id = m.review_id join meeting_attendees a on a.meeting_id = m.id and a.user_id = $1
       where not m.cancelled and m.starts_at > now() and m.starts_at < now() + interval '6 hours' order by m.starts_at limit 1`, [u.id]),
  ]);

  // ---- tasks
  if (mine && mine.overdue > 0)
    push({ key: "overdue", area: "tasks", severity: mine.overdue >= 5 ? "critical" : "high", weight: 50 + mine.overdue,
      title: `${plural(mine.overdue, "task")} overdue`, detail: mine.oldest ? `Oldest was due ${fmtDate(mine.oldest)} (${diffDays(t, mine.oldest)} days ago).` : undefined,
      cta: { label: "Review", href: "/tasks/all?view=overdue" } });
  if (critToday.length)
    push({ key: "crit-today", area: "tasks", severity: "high", weight: 45, title: `${plural(critToday.length, "critical action")} due today`,
      detail: critToday.slice(0, 2).map((x) => x.title).join(" · "), cta: { label: "Open", href: critToday.length === 1 ? `/tasks/${critToday[0].id}` : "/tasks/all?view=today" } });
  if (delegated.length) {
    const worst = delegated[0];
    push({ key: "stale", area: "followups", severity: delegated.length >= 5 ? "high" : "medium", weight: 40 + delegated.length,
      title: `${plural(delegated.length, "delegated task")} need a follow-up`,
      detail: `${worst.owner ?? "Owner"} hasn’t updated “${worst.title}” in ${worst.days} days${worst.overdue ? " and it’s overdue" : ""}.`,
      cta: { label: "Follow up", href: "/tasks/all?view=delegated" } });
  }
  if (mine && mine.blocked > 0)
    push({ key: "blocked", area: "tasks", severity: "medium", weight: 30, title: `${plural(mine.blocked, "of your tasks is", "of your tasks are")} blocked`, cta: { label: "Unblock", href: "/tasks/all?status=blocked" } });

  // ---- meetings
  for (const m of moms.filter((x) => x.mom_status === "submitted").slice(0, 2))
    push({ key: `review-${m.id}`, area: "meetings", severity: "high", weight: 48, title: `${m.title} — MoM awaiting your review`,
      detail: `${m.mom_owner ?? "The owner"} submitted the MoM. ${m.suggestions ? `${plural(m.suggestions, "suggested item")} to distribute.` : ""}`, cta: { label: "Review & distribute", href: `/meetings/${m.id}` } });
  const myMoms = moms.filter((x) => x.mom_status !== "submitted" && x.mom_owner_id === u.id);
  for (const m of myMoms.slice(0, 2))
    push({ key: `mom-${m.id}`, area: "meetings", severity: "medium", weight: 38, title: `${m.title} ended ${relEnded(m.ends_at)} — add MoM`,
      detail: "You’re the MoM owner for this meeting.", cta: { label: "Add MoM", href: `/meetings/${m.id}` } });
  const othersMoms = moms.filter((x) => x.mom_status !== "submitted" && x.mom_owner_id !== u.id);
  if (othersMoms.length)
    push({ key: "mom-others", area: "meetings", severity: "medium", weight: 33,
      title: othersMoms.length === 1 ? `${othersMoms[0].title} has no MoM yet` : `${othersMoms.length} meetings have no MoM yet`,
      detail: othersMoms.slice(0, 3).map((m) => `${m.mom_owner ?? "Unassigned"} · ${m.title}`).join("  ·  "),
      cta: { label: othersMoms.length === 1 ? "Nudge owner" : "View", href: othersMoms.length === 1 ? `/meetings/${othersMoms[0].id}` : "/meetings?tab=needs-mom" } });

  // ---- AOP
  if (aop) {
    const lastClosed = addMonths(monthStart(t), -1);
    const dev = await q<{ section: string; over: number; budget: number }>(
      `select f.name as section, sum(v.actual - v.plan) as over, sum(v.plan) as budget
       from aop_period_values v join aop_items i on i.id = v.item_id join aop_sections g on g.id = i.section_id join aop_sections f on f.id = coalesce(g.parent_id, g.id)
       where i.cycle_id = $1 and v.period <= $2 and v.plan > 0 and v.actual is not null and i.direction = 'lower_better'
       group by f.name having sum(v.actual - v.plan) > 0.03 * sum(v.plan) order by over desc`, [aop.id, lastClosed]);
    const actualsDue = aopFns.filter((s) => s.kind === "actuals");
    if (actualsDue.length) {
      // headline the current cut-off month; older incomplete months are reported as backlog
      const latest = actualsDue.reduce((m, s) => (s.period > m ? s.period : m), actualsDue[0].period);
      const cur = actualsDue.filter((s) => s.period === latest);
      const backlog = new Set(actualsDue.filter((s) => s.period < latest).map((s) => s.name)).size;
      const dueToday = cur.some((s) => s.due_date === t), late = cur.some((s) => s.due_date < t);
      push({ key: "aop-inputs", area: "aop", severity: late || dueToday ? "high" : "medium", weight: 44,
        title: `${plural(cur.length, "function hasn’t", "functions haven’t")} submitted ${fmtMonth(latest, false)} actuals`,
        detail: `${dueToday ? "Cut-off is today. " : late ? "Past cut-off. " : ""}Missing: ${cur.map((s) => `${s.name}${s.owner ? ` (${s.owner})` : ""}`).slice(0, 4).join(", ")}.${backlog ? ` ${plural(backlog, "function")} also ${backlog === 1 ? "has" : "have"} older months incomplete.` : ""}`,
        cta: { label: "Send reminders", href: "/aop/inputs" } });
    }
    const proj = aopFns.filter((s) => s.kind === "projections" && s.due_date < t);
    if (proj.length)
      push({ key: "aop-proj", area: "aop", severity: "medium", weight: 28, title: `${plural(proj.length, "projection input")} past due`,
        detail: [...new Set(proj.map((s) => s.name))].slice(0, 4).join(", "), cta: { label: "Review inputs", href: "/aop/inputs" } });
    if (dev.length) {
      const total = dev.reduce((a, d) => a + d.over, 0);
      push({ key: "aop-dev", area: "aop", severity: total > 2_000_000 ? "high" : "medium", weight: 42,
        title: `${inr(total)} over ${aop.labels.plan.toLowerCase()} YTD across ${plural(dev.length, "function")}`,
        detail: dev.slice(0, 3).map((d) => `${d.section} +${inr(d.over)} (${((d.over / d.budget) * 100).toFixed(1)}%)`).join(" · "),
        cta: { label: "View deviations", href: "/aop" } });
    }
  }

  // ---- S&OP
  const late = sopPending.filter((s) => s.status === "late" || s.due_date < t);
  if (late.length)
    push({ key: "sop-late", area: "sop", severity: "high", weight: 41, title: `${plural(late.length, "S&OP projection")} late`,
      detail: late.slice(0, 3).map((s) => `${s.name} · ${fmtMonth(s.period)} (${s.poc ?? "no POC"})`).join(" · "), cta: { label: "Chase inputs", href: "/sop/inputs" } });
  const upcoming = sopPending.filter((s) => s.due_date >= t);
  if (upcoming.length) {
    const next = upcoming[0];
    const sameDue = upcoming.filter((s) => s.due_date === next.due_date);
    push({ key: "sop-next", area: "sop", severity: "medium", weight: 26, title: `${sameDue.length} S&OP inputs pending for ${fmtMonth(next.period)}`,
      detail: `Due ${fmtDate(next.due_date)} — ${sameDue.map((s) => s.poc ?? s.name).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.`, cta: { label: "View inputs", href: "/sop/inputs" } });
  }
  if (capacity.length) {
    const c = capacity[0];
    push({ key: "sop-cap", area: "sop", severity: "high", weight: 39, title: `${c.warehouse} warehouse short of capacity in ${fmtMonth(c.period)}`,
      detail: `${c.department}: ${num(c.short)} units/day short${capacity.length > 1 ? ` · ${capacity.length - 1} more breaches` : ""}.`, cta: { label: "Plan capacity", href: "/sop/capacity" } });
  }

  if (nextMeeting) {
    const missing = nextMeeting.review_module === "sop" ? sopPending.length : nextMeeting.review_module === "aop" ? aopFns.length : 0;
    push({ key: "next-meeting", area: "meetings", severity: missing ? "medium" : "info", weight: 36,
      title: `${nextMeeting.title} at ${fmtTime(nextMeeting.starts_at)}${missing ? ` — ${plural(missing, "input")} missing` : ""}`,
      detail: "Your pre-read is ready: previous actions, decisions and open items.", cta: { label: "Open brief", href: `/meetings/${nextMeeting.id}` } });
  }

  return out.sort((a, b) => SEV_RANK[b.severity] + b.weight - (SEV_RANK[a.severity] + a.weight));
}

function relEnded(ts: string) {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
const addDaysStr = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
