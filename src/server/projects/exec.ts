import "server-only";
import { q } from "../db";
import { aiConfigured, aiText } from "../ai/provider";
import { dateOf, diffDays, fmtDate, today } from "@/lib/dates";
import { HEALTH } from "@/lib/meta";
import { plural } from "@/lib/format";
import { getProject, listMilestones } from "./queries";
import { pctInt } from "./metrics";

export interface ProjectExecSummary {
  status: string;               // "AT RISK"
  health: string;
  progress: number;             // 0..100
  reportedProgress: number | null;
  target: string | null;        // 'YYYY-MM-DD'
  primaryRisk: string | null;
  slip: string | null;          // "RFID tunnel live at YLK slipped 5 days"
  overdue: number;
  budgetUtilisation: number | null; // 0..1
  recommendation: string;
  recommendations: string[];
  text: string;
  parts: { label: string; value: string; tone?: "red" | "amber" | "green" }[];
}

/** Next Friday label for urgency ("before Friday"); if today is Thu/Fri use "this week". */
function byWhen(due: string | null, td: string) {
  if (due && due >= td && diffDays(due, td) <= 7) return `by ${fmtDate(due)}`;
  const dow = new Date(`${td}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 3 ? "before Friday" : "early next week";
}

/**
 * Rule-based executive summary that changes with the data. Composition order: status → progress → target →
 * primary risk / slip → overdue actions → budget → recommended intervention.
 */
export async function projectExecSummary(projectId: string): Promise<ProjectExecSummary | null> {
  const p = await getProject(projectId);
  if (!p) return null;
  const td = today();
  const [milestones, overdueTasks, risks, decisions, lastUpd] = await Promise.all([
    listMilestones([projectId]),
    q<{ title: string; owner_name: string | null; team_name: string | null; due_date: string }>(
      `select t.title, u.name as owner_name, tm.name as team_name, t.due_date from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
       where t.project_id = $1 and t.status not in ('completed','cancelled') and t.due_date < $2 order by t.due_date`, [projectId, td]),
    q<{ title: string; score: number; mitigation: string | null; status: string }>(
      `select title, score, mitigation, status from risks where project_id = $1 and status <> 'closed' order by (status = 'escalated') desc, score desc limit 3`, [projectId]),
    q<{ title: string; due_date: string | null }>(
      `select title, due_date from decisions where project_id = $1 and status in ('pending','proposed') order by due_date nulls last`, [projectId]),
    q<{ blockers: string | null; created_at: string; percent_complete: number | null }>(
      `select blockers, created_at, percent_complete from project_updates where project_id = $1 order by created_at desc limit 1`, [projectId]),
  ]);

  const progress = pctInt(p.progress);
  const status = HEALTH[p.health].label.toUpperCase();
  const openMs = milestones.filter((m) => m.status !== "done");
  const worstSlip = [...openMs].sort((a, b) => (b.slip + b.overdue) - (a.slip + a.overdue))[0];
  const slip = worstSlip && (worstSlip.slip > 0 || worstSlip.overdue > 0)
    ? `${worstSlip.title} ${worstSlip.slip > 0 ? `slipped ${plural(worstSlip.slip, "day")}` : ""}${worstSlip.slip > 0 && worstSlip.overdue > 0 ? ", " : ""}${worstSlip.overdue > 0 ? `${worstSlip.overdue}d overdue` : ""}`.trim()
    : null;
  const topRisk = risks[0];
  const blockers = lastUpd[0]?.blockers?.trim() || null;
  const primaryRisk = topRisk ? topRisk.title : blockers ? `Blocker — ${blockers}` : null;
  const budgetUtilisation = p.budget && p.budget > 0 && p.spent != null ? p.spent / p.budget : null;
  const daysSinceUpdate = lastUpd[0] ? diffDays(td, dateOf(lastUpd[0].created_at)) : null;

  // recommended interventions, most urgent first
  const recs: string[] = [];
  const dueDecision = decisions.find((d) => d.due_date && diffDays(d.due_date, td) <= 7) ?? decisions[0];
  if (dueDecision) recs.push(`take the pending decision “${dueDecision.title}” ${dueDecision.due_date ? (dueDecision.due_date < td ? `(overdue since ${fmtDate(dueDecision.due_date)})` : `by ${fmtDate(dueDecision.due_date)}`) : "this week"}`);
  if (worstSlip && (worstSlip.slip > 0 || worstSlip.overdue > 0))
    recs.push(`confirm a revised date for “${worstSlip.title}” ${byWhen(null, td)}${openMs.length > 1 && worstSlip.overdue > 0 ? " and decouple downstream milestones from it" : ""}`);
  if (overdueTasks.length) {
    const who = [...new Set(overdueTasks.map((t) => t.owner_name ?? t.team_name).filter(Boolean))].slice(0, 3).join(", ");
    recs.push(`clear ${plural(overdueTasks.length, "overdue action")}${who ? ` with ${who}` : ""}`);
  }
  if (topRisk && topRisk.score >= 12 && topRisk.mitigation) recs.push(`push the mitigation on “${topRisk.title}”: ${topRisk.mitigation.replace(/\.$/, "")}`);
  if (budgetUtilisation != null && budgetUtilisation - p.progress > 0.15)
    recs.push(`review spend — ${pctInt(budgetUtilisation)}% of budget used against ${progress}% progress`);
  if (daysSinceUpdate == null || daysSinceUpdate >= 7)
    recs.push(daysSinceUpdate == null ? `request a first status update from ${p.owner_name ?? "the owner"}` : `request a fresh update from ${p.owner_name ?? "the owner"} (last one ${daysSinceUpdate} days ago)`);
  if (!recs.length) recs.push(p.next_ms_title ? `stay the course — next milestone “${p.next_ms_title}” on ${fmtDate(p.next_ms_due)}` : "add the next milestone so progress can be tracked");
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const recommendation = cap(recs.slice(0, 2).join(" and "));

  const parts: ProjectExecSummary["parts"] = [
    { label: "Project status", value: status, tone: p.health === "on_track" ? "green" : p.health === "at_risk" ? "amber" : "red" },
    { label: "Progress", value: `${progress}%${lastUpd[0]?.percent_complete != null && Math.abs(lastUpd[0].percent_complete - progress) >= 10 ? ` (owner reports ${lastUpd[0].percent_complete}%)` : ""}` },
    { label: "Target", value: p.target_date ? fmtDate(p.target_date) : "not set" },
  ];
  if (primaryRisk) parts.push({ label: "Primary risk", value: primaryRisk, tone: topRisk && topRisk.score >= 15 ? "red" : "amber" });
  if (slip) parts.push({ label: "Milestone slip", value: slip, tone: "amber" });
  if (overdueTasks.length) parts.push({ label: "Overdue", value: plural(overdueTasks.length, "overdue action"), tone: "red" });
  if (decisions.length) parts.push({ label: "Decisions", value: `${plural(decisions.length, "decision")} pending` });
  if (budgetUtilisation != null) parts.push({ label: "Budget utilisation", value: `${pctInt(budgetUtilisation)}%`, tone: budgetUtilisation > 1 ? "red" : budgetUtilisation - p.progress > 0.15 ? "amber" : undefined });
  parts.push({ label: "Recommended intervention", value: recommendation });

  const text = parts.map((x) => (x.label === "Overdue" || x.label === "Decisions" ? x.value : `${x.label}: ${x.value}`)).join(" · ");
  return {
    status, health: p.health, progress, reportedProgress: lastUpd[0]?.percent_complete ?? null, target: p.target_date, primaryRisk, slip,
    overdue: overdueTasks.length, budgetUtilisation, recommendation, recommendations: recs.map(cap), text, parts,
  };
}

const g = globalThis as unknown as { __execPolish?: Map<string, string> };

/** Optional AI polish of the rule-based text (cached by input). Null when AI isn't configured or fails. */
export async function polishExecSummary(name: string, text: string): Promise<string | null> {
  if (!aiConfigured()) return null;
  g.__execPolish ??= new Map();
  const key = `${name}|${text}`;
  if (g.__execPolish.has(key)) return g.__execPolish.get(key)!;
  const out = await aiText({
    system: "You write executive status summaries for a Program Manager at an Indian menswear retailer. Rewrite the given facts as 2–3 crisp sentences for leadership. Keep every number, date and name exactly. No preamble, no bullet points, no markdown.",
    prompt: `Project: ${name}\nFacts: ${text}`,
    effort: "low",
    maxTokens: 400,
  });
  if (out) g.__execPolish.set(key, out);
  return out;
}

