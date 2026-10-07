// Pure AOP maths + semantics, shared by server and client (no server-only imports).
// Never hardcode cost semantics: everything is driven by item.direction and cycle.labels.
import type { Tone } from "@/lib/meta";

export type Measure = "plan" | "forecast" | "actual";
export type Direction = "lower_better" | "higher_better";
export type AopStatus = "on_track" | "at_risk" | "delayed";
export interface Labels { plan: string; forecast: string; actual: string }
export const DEFAULT_LABELS: Labels = { plan: "Plan", forecast: "Forecast", actual: "Actual" };
export const MEASURES: Measure[] = ["plan", "forecast", "actual"];

export const LABEL_PRESETS: Record<string, Labels> = {
  cost: { plan: "Budget", forecast: "Provision", actual: "Actuals" },
  revenue: { plan: "Target", forecast: "Forecast", actual: "Actual" },
  mixed: { plan: "Plan", forecast: "Forecast", actual: "Actual" },
};

export const STATUS_META: Record<AopStatus, { label: string; tone: Tone }> = {
  on_track: { label: "On track", tone: "green" },
  at_risk: { label: "At risk", tone: "amber" },
  delayed: { label: "Off track", tone: "red" },
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monShort = (p: string) => MON[Number(p.slice(5, 7)) - 1];
export const monLabel = (p: string) => `${monShort(p)} ’${p.slice(2, 4)}`;

/** Month starts of the plan year. */
export function cycleMonths(fyStart: string, n = 12): string[] {
  const out: string[] = [];
  const y0 = Number(fyStart.slice(0, 4)), m0 = Number(fyStart.slice(5, 7)) - 1;
  for (let i = 0; i < n; i++) {
    const y = y0 + Math.floor((m0 + i) / 12), m = (m0 + i) % 12;
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-01`);
  }
  return out;
}

/** Signed favourability: positive = good for this line (under budget for cost, ahead of plan for revenue). */
export const impactOf = (direction: Direction, plan: number, actual: number) => (direction === "lower_better" ? plan - actual : actual - plan);

/** "Over budget" / "Under budget" (cost) or "Behind target" / "Ahead of target" (revenue). */
export function varianceWord(direction: Direction, labels: Labels, favourable: boolean) {
  const p = labels.plan.toLowerCase();
  if (direction === "lower_better") return favourable ? `Under ${p}` : `Over ${p}`;
  return favourable ? `Ahead of ${p}` : `Behind ${p}`;
}
/** Short word for the favourable outcome: "savings" for cost, "upside" for revenue. */
export const goodWord = (direction: Direction) => (direction === "lower_better" ? "savings" : "upside");
/** Utilisation (cost) vs achievement (revenue). */
export const ratioWord = (direction: Direction) => (direction === "lower_better" ? "utilised" : "achieved");

/** Status from favourability % (impact / base). threshold = the overspend rule threshold. */
export function statusFrom(impactPct: number | null, threshold = 0.05, projImpactPct?: number | null): AopStatus {
  const worst = Math.min(impactPct ?? 0, projImpactPct ?? 0);
  if (worst < -2 * threshold) return "delayed";
  if (worst < -threshold) return "at_risk";
  return "on_track";
}

export type UnitMode = "inr" | "lakh" | "cr";
const g0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const g2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Grid number in the chosen unit (no ₹ symbol — the unit is in the toolbar). */
export function fmtUnit(v: number | null | undefined, mode: UnitMode, unit: "inr" | "num" | "pct" = "inr") {
  if (v == null || !Number.isFinite(v)) return "";
  if (unit === "pct") return `${(v * 100).toFixed(1)}%`;
  if (unit === "num") return g0.format(v);
  if (mode === "inr") return g0.format(v);
  return g2.format(v / (mode === "lakh" ? 1e5 : 1e7));
}
/** Parse user input in the chosen unit back to a raw number. Accepts "12.5", "12,50,000", "12.5L", "1.2cr", "45k". */
export function parseUnit(s: string, mode: UnitMode): number | null {
  const t = s.trim().toLowerCase().replace(/[₹,\s]/g, "");
  if (!t || t === "-") return null;
  const m = t.match(/^(-?\d*\.?\d+)(cr|l|lakh|lac|k)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (m[2] === "cr") return n * 1e7;
  if (m[2] === "l" || m[2] === "lakh" || m[2] === "lac") return n * 1e5;
  if (m[2] === "k") return n * 1e3;
  return mode === "inr" ? n : n * (mode === "lakh" ? 1e5 : 1e7);
}
