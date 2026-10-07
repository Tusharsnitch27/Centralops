import "server-only";
import { aiConfigured, aiText } from "../ai/provider";
import type { Suggestion } from "./engine";
import { withTimeout } from "../reports/util";

/** A short "read" of the situation. Claude when configured; otherwise a rule-based paragraph. */
export async function situationRead(items: Suggestion[]): Promise<{ text: string; engine: "claude" | "rules" }> {
  const rules = rulesRead(items);
  if (!items.length || !aiConfigured()) return { text: rules, engine: "rules" };
  const ai = await withTimeout(aiText({
    system: "You are the analyst for the Central Operations program manager at Snitch (Indian menswear retailer). Write a 2–4 sentence read of the situation from the suggestions given: what matters most, what connects, and the single best next move. Plain prose, no lists, no headings. Use only the facts provided; never invent numbers or names.",
    prompt: items.map((s, i) => `${i + 1}. [${s.severity}] ${s.title}. ${s.body ?? ""} Recommendation: ${s.recommendation ?? "-"}`).join("\n"),
    maxTokens: 400,
  }), 12000);
  return ai ? { text: ai, engine: "claude" } : { text: rules, engine: "rules" };
}

function rulesRead(items: Suggestion[]) {
  if (!items.length) return "Nothing is slipping right now — budgets, inputs, milestones and follow-ups are within their thresholds.";
  const crit = items.filter((s) => s.severity === "critical");
  const by = (k: string[]) => items.filter((s) => k.includes(s.kind));
  const parts: string[] = [];
  const aop = by(["aop_overspend", "aop_missing"]);
  const sop = by(["sop_late", "capacity"]);
  const exec = by(["milestone_slip", "stale_tasks", "project_update", "decision_due"]);
  const mom = by(["mom_missing"]);
  if (aop.length) parts.push(`On cost, ${aop.map((s) => s.title.charAt(0).toLowerCase() + s.title.slice(1)).join("; ")}.`);
  if (sop.length) parts.push(`In S&OP, ${sop.map((s) => s.title.charAt(0).toLowerCase() + s.title.slice(1)).join("; ")} — capacity sign-off depends on these inputs.`);
  if (exec.length) parts.push(`On execution, ${exec.length === 1 ? exec[0].title.charAt(0).toLowerCase() + exec[0].title.slice(1) : `${exec.length} items are drifting (milestones, delegated updates or decisions)`}.`);
  if (mom.length) parts.push(`${mom.length === 1 ? "One meeting is" : `${mom.length} meetings are`} missing minutes, so their actions aren't tracked yet.`);
  const first = crit[0] ?? items[0];
  parts.push(`Start with: ${first.recommendation ?? first.title}.`);
  return parts.join(" ");
}
