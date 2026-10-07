// AOP input deadlines — pure, shared by server and client.
// Default rules (user, 2026-10-07): Budget for month M by the 1st of M · Provision by the 30th of M (last day for shorter months)
// · Actuals by the 7th of M+1 — Logistics by the 12th of M+1.

export type Measure = "plan" | "forecast" | "actual";
export interface DeadlineRule { monthOffset: number; day: number }
export interface ReminderPolicy { enabled: boolean; dueDayNudge: boolean; everyDays: number; maxPerItem: number; escalateAfterDays: number }
export interface DeadlineConfig {
  plan: DeadlineRule; forecast: DeadlineRule; actual: DeadlineRule;
  overrides: Record<string, Partial<Record<Measure, DeadlineRule>>>; // keyed by function name
  reminders: ReminderPolicy;
}
export const DEFAULT_DEADLINES: DeadlineConfig = {
  plan: { monthOffset: 0, day: 1 }, forecast: { monthOffset: 0, day: 30 }, actual: { monthOffset: 1, day: 7 },
  overrides: { Logistics: { actual: { monthOffset: 1, day: 12 } } },
  reminders: { enabled: true, dueDayNudge: true, everyDays: 2, maxPerItem: 5, escalateAfterDays: 3 },
};

export function parseDeadlines(raw: unknown): DeadlineConfig {
  const r = (raw ?? {}) as Partial<DeadlineConfig>;
  return {
    plan: { ...DEFAULT_DEADLINES.plan, ...r.plan }, forecast: { ...DEFAULT_DEADLINES.forecast, ...r.forecast }, actual: { ...DEFAULT_DEADLINES.actual, ...r.actual },
    overrides: r.overrides ?? DEFAULT_DEADLINES.overrides, reminders: { ...DEFAULT_DEADLINES.reminders, ...r.reminders },
  };
}

/** Input kinds used by submissions: budget ↔ plan, projections ↔ forecast (provision), actuals ↔ actual. */
export type InputKind = "budget" | "projections" | "actuals";
export const KIND_MEASURE: Record<InputKind, Measure> = { budget: "plan", projections: "forecast", actuals: "actual" };
export const MEASURE_KIND: Record<Measure, InputKind> = { plan: "budget", forecast: "projections", actual: "actuals" };

export function ruleFor(cfg: DeadlineConfig, measure: Measure, functionName?: string | null): DeadlineRule {
  return (functionName && cfg.overrides[functionName]?.[measure]) || cfg[measure];
}

/** Due date (YYYY-MM-DD) for a month's input; day is clamped to the month's last day (30 → 28 in Feb). */
export function dueDate(cfg: DeadlineConfig, measure: Measure, period: string, functionName?: string | null): string {
  const r = ruleFor(cfg, measure, functionName);
  const d = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + r.monthOffset);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(Math.max(1, r.day), last));
  return d.toISOString().slice(0, 10);
}

const ORD = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
/** "1st of the month" / "7th of next month". */
export const describeRule = (r: DeadlineRule) => `${r.day >= 28 ? `${ORD(r.day)} (or month-end)` : ORD(r.day)} of ${r.monthOffset === 0 ? "the month" : r.monthOffset === 1 ? "next month" : r.monthOffset === -1 ? "the previous month" : `month +${r.monthOffset}`}`;
