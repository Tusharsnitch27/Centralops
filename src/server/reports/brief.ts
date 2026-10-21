import "server-only";
import { addDays, fmtMonth, today, TZ } from "@/lib/dates";
import { plural } from "@/lib/format";
import { monthLong } from "./util";
import {
  aopState, meetingsOn, meetingsWithoutMom, milestoneSlips, momsToReview, openFollowups, openRisks, overdueTasks, pendingDecisions,
  projectsAtRisk, scopeFor, sopLateInputs, staleDelegated, type Scope,
} from "../insights/signals";

export interface BriefPriority { rank: number; title: string; detail: string; href: string }
export interface MorningBrief {
  greeting: string;
  counts: { meetings: number; overdue: number; followups: number; projectsAtRisk: number; decisionsPending: number; momPending: number };
  priorities: BriefPriority[];
}

export function greetingFor(name: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(now));
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

const short = (p: { project_code: string | null; project_name: string }) => p.project_code ?? p.project_name.split(/[—–-]/)[0].trim();

/** Rule-based morning brief: counts + ranked priorities. Used by the Command Centre and the Daily Brief report. */
export async function morningBrief(userId: string): Promise<MorningBrief> {
  const s = await scopeFor(userId);
  const t = today();
  const [meetings, overdue, followups, atRisk, decisions, noMom, toReview, slips, sopLate, aop, risks, stale] = await Promise.all([
    meetingsOn(s, t), overdueTasks(s), openFollowups(s), projectsAtRisk(s), pendingDecisions(s), meetingsWithoutMom(s), momsToReview(s),
    milestoneSlips(s), sopLateInputs(s), s.manage ? aopState() : null, openRisks(s, 15), staleDelegated(s),
  ]);
  const myMomPending = noMom.filter((m) => s.manage || m.mom_owner_id === s.userId);

  type Cand = BriefPriority & { score: number };
  const c: Cand[] = [];
  const push = (score: number, title: string, detail: string, href: string) => c.push({ rank: 0, score, title, detail, href });

  // AOP review preparation: missing actuals for the last closed month (more urgent when a cost review is close)
  if (aop?.cycle) {
    const miss = aop.missing.filter((m) => m.kind === "actuals" && m.period === aop.lastClosed);
    if (miss.length) {
      const reviewSoon = meetings.some((m) => /cost|aop/i.test(m.title));
      const names = [...new Set(miss.map((m) => m.function_name))];
      push(reviewSoon ? 98 : 80, `AOP review preparation — ${plural(names.length, "function")} ${names.length === 1 ? "hasn't" : "haven't"} submitted ${monthLong(aop.lastClosed)} actuals`,
        `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` +${names.length - 4}` : ""}${reviewSoon ? " · cost review today" : ""}`, "/aop");
    }
    const streak = aop.streaks[0];
    if (streak) push(70, `${streak.function_name} ${streak.group_name} over budget ${streak.months.length} months running`, `Agree a recovery plan with ${streak.owner_name ?? "the owner"}`, "/aop");
  }
  for (const m of slips.slice(0, 3)) {
    const late = m.overdue_days > 0;
    push(late ? 85 + Math.min(m.overdue_days, 10) : 60 + Math.min(m.slip_days, 10),
      `${short(m)} — ${m.title} ${late ? `overdue by ${plural(m.overdue_days, "day")}` : `slipped ${plural(m.slip_days, "day")}`}`,
      `${m.owner_name ? `Owner ${m.owner_name} · ` : ""}${m.project_name}`, `/tasks/goals#project-${m.project_id}`);
  }
  const byStream = new Map<string, typeof sopLate[number]>();
  for (const l of sopLate) if (!byStream.has(l.stream_id)) byStream.set(l.stream_id, l);
  for (const l of [...byStream.values()].slice(0, 2))
    push(82 + Math.min(l.days_late, 10), `S&OP — ${l.stream.replace(/-Category Wise/i, "").toLowerCase()} projections late`,
      `${fmtMonth(l.period)} input was due ${plural(l.days_late, "day")} ago${l.poc_name ? ` · ${l.poc_name}` : ""}`, "/sop");
  for (const m of toReview.slice(0, 2))
    push(78, `Review the ${m.title} MoM`, `${m.open_suggestions ? `${plural(m.open_suggestions, "suggested item")} waiting to be distributed` : "Submitted by " + (m.mom_owner_name ?? "the owner")}`, `/meetings/${m.id}`);
  if (myMomPending.length) {
    const m = myMomPending[0];
    push(m.overdue ? 74 : 60, myMomPending.length === 1 ? `${m.title} has no MoM yet` : `${plural(myMomPending.length, "meeting")} without a MoM`,
      `${m.mom_owner_name ? `MoM owner ${m.mom_owner_name}` : ""}`, myMomPending.length === 1 ? `/meetings/${m.id}` : "/meetings");
  }
  if (overdue.length) {
    const top = overdue[0];
    push(72 + Math.min(overdue.length, 8), overdue.length === 1 ? `Overdue: ${top.title}` : `${plural(overdue.length, "task")} overdue`,
      overdue.length === 1 ? `${top.owner_name ?? top.owner_team_name ?? "Unassigned"} · ${plural(top.days_overdue, "day")} late` : `Oldest: ${top.title} (${top.owner_name ?? top.owner_team_name ?? "—"}, ${top.days_overdue}d)`,
      overdue.length === 1 ? `/tasks/${top.id}` : "/exceptions#overdue");
  }
  for (const d of decisions.filter((d) => d.due_date && d.due_date <= addDays(t, 3)).slice(0, 2))
    push(d.days_overdue > 0 ? 76 : 66, `Decision due: ${d.title}`, d.days_overdue > 0 ? `${plural(d.days_overdue, "day")} past due` : `Due ${d.due_date === t ? "today" : d.due_date}`, "/meetings");
  if (stale.length >= 2) push(58 + Math.min(stale.length, 10), `${plural(stale.length, "delegated task")} without an update`, "Request updates before the reviews", "/exceptions#stale");
  for (const r of risks.slice(0, 1)) push(62, `Critical risk: ${r.title}`, `Score ${r.score}${r.owner_name ? ` · ${r.owner_name}` : ""}`, `/risks`);
  const prep = meetings.find((m) => m.prep_notes || m.agenda);
  if (prep) push(55, `Prepare for ${prep.title}`, prep.prep_notes?.split("\n")[0]?.slice(0, 120) ?? "Agenda ready", `/meetings/${prep.id}`);

  const priorities = c.sort((a, b) => b.score - a.score).slice(0, 6).map(({ score: _s, ...p }, i) => ({ ...p, rank: i + 1 }));
  return {
    greeting: greetingFor(s.name),
    counts: {
      meetings: meetings.length,
      overdue: overdue.length,
      followups: followups.length,
      projectsAtRisk: atRisk.length,
      decisionsPending: decisions.length,
      momPending: myMomPending.length + toReview.length,
    },
    priorities,
  };
}

export type { Scope };
