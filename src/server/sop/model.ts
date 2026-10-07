// S&OP shared model: types + pure helpers. No server-only imports — safe for client components.
import { addMonths, diffDays, today } from "@/lib/dates";

export type ActualSource = "manual" | "snowflake" | "demo";
export type Granularity = "month" | "week" | "day";

export interface Stream {
  id: string;
  code: string | null;
  name: string;
  area: string;
  poc_id: string | null;
  poc_name: string | null;
  poc_color: string | null;
  poc_label: string | null;
  description: string | null;
  granularity: Granularity;
  unit: string;
  dimensions: string[];
  due_day: number;
  actual_source: ActualSource;
  actual_query: string | null;
  headline_metric: string | null;
  sort: number;
}

export interface Line { id: string; stream_id: string; name: string; metric: string | null; unit: string | null; sort: number }

export interface ValueRow {
  id: string;
  line_id: string;
  period: string;
  period_label: string;
  dimension: string;
  projection: number | null;
  revised_projection: number | null;
  actual: number | null;
  actual_source: ActualSource | null;
}

/** Display state of a stream's input for a month. */
export type SubState = "done" | "done_late" | "pending" | "late" | "na";
export interface SubCell {
  stream_id: string;
  period: string;
  state: SubState;
  due_date: string;
  submitted_at: string | null;
  exists: boolean;
  note: string | null;
}

export const currentPeriod = (d = today()) => `${d.slice(0, 7)}-01`;
export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Projections for month M are due on `dueDay` of M-1 (week 3 of the previous month). */
export function dueDateFor(period: string, dueDay = 21) {
  const prev = addMonths(period, -1);
  const last = new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0)).getUTCDate();
  return `${prev.slice(0, 7)}-${pad2(Math.min(dueDay, last))}`;
}

export function subState(status: string | null, due: string, submittedAt: string | Date | null, ref = today()): SubState {
  if (status === "not_required") return "na";
  if (status === "submitted") {
    const at = submittedAt ? new Date(submittedAt).toISOString().slice(0, 10) : null;
    return at && at > due ? "done_late" : "done";
  }
  return due < ref ? "late" : "pending";
}

export const SUB_META: Record<SubState, { label: string; tone: "green" | "amber" | "red" | "neutral" | "muted" }> = {
  done: { label: "Done", tone: "green" },
  done_late: { label: "Done · late", tone: "green" },
  pending: { label: "Pending", tone: "neutral" },
  late: { label: "Late", tone: "red" },
  na: { label: "Not required", tone: "muted" },
};
export const isOpenSub = (s: SubState) => s === "pending" || s === "late";

export function dueLabel(due: string, ref = today()) {
  const n = diffDays(due, ref);
  if (n === 0) return "due today";
  if (n > 0) return `due in ${n}d`;
  return `${-n}d overdue`;
}

/** Projection actually in force: revised (in-month change) wins over the baseline. */
export const effective = (v: Pick<ValueRow, "projection" | "revised_projection">) => v.revised_projection ?? v.projection;

/**
 * Accuracy = 1 − Σ|A − P| / ΣP over rows with both a (baseline) projection and an actual (weighted MAPE).
 * Bias = (ΣA − ΣP) / ΣP: positive = actuals above projection (under-projected).
 */
export interface Accuracy { accuracy: number | null; bias: number | null; proj: number; actual: number; rows: number; demo: boolean }
export function accuracyOf(rows: { projection: number | null; actual: number | null; demo?: boolean }[]): Accuracy {
  let p = 0, a = 0, err = 0, n = 0, demo = false;
  for (const r of rows) {
    if (r.projection == null || r.actual == null || r.projection <= 0) continue;
    p += r.projection; a += r.actual; err += Math.abs(r.actual - r.projection); n++;
    if (r.demo) demo = true;
  }
  if (!n || p <= 0) return { accuracy: null, bias: null, proj: p, actual: a, rows: 0, demo };
  return { accuracy: Math.max(0, 1 - err / p), bias: (a - p) / p, proj: p, actual: a, rows: n, demo };
}
export const variance = (proj: number | null | undefined, act: number | null | undefined) =>
  proj == null || act == null || proj === 0 ? null : (act - proj) / proj;

export const accuracyTone = (a: number | null, threshold = 0.2) => (a == null ? "neutral" : a >= 1 - threshold / 2 ? "green" : a >= 1 - threshold ? "amber" : "red");

/** Metric that represents the stream on cards and charts. */
export function headlineMetric(stream: Pick<Stream, "headline_metric">, metrics: (string | null)[]) {
  const set = new Set(metrics.filter(Boolean) as string[]);
  if (stream.headline_metric && set.has(stream.headline_metric)) return stream.headline_metric;
  for (const m of ["items", "units", "orders", "inventory", "returns", "nso"]) if (set.has(m)) return m;
  return [...set][0] ?? null;
}
export const METRIC_LABEL: Record<string, string> = { items: "Items", units: "Units", orders: "Orders", inventory: "Inventory", returns: "Returns", nso: "NSO launches" };
export const metricLabel = (m: string | null | undefined) => (m ? METRIC_LABEL[m] ?? m[0]!.toUpperCase() + m.slice(1) : "Volume");

export const SOURCE_META: Record<ActualSource, { label: string; tone: "info" | "amber" | "neutral" }> = {
  manual: { label: "Manual entry", tone: "neutral" },
  demo: { label: "Demo actuals", tone: "amber" },
  snowflake: { label: "Snowflake", tone: "info" },
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Default week labels for a month (Mondays that fall in it), matching the workbook's 'Oct_WK_01' style. */
export function weekLabels(period: string) {
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let mondays = 0;
  for (let d = 1; d <= days; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) mondays++;
  return Array.from({ length: Math.max(4, mondays) }, (_, i) => `${MON[m - 1]}_WK_${pad2(i + 1)}`);
}
/** 'Sep_Week-01' / 'Oct_WK_02' → 'Wk 1' / 'Wk 2'. */
export const weekShort = (label: string) => { const n = label.match(/(\d+)\s*$/); return n ? `Wk ${Number(n[1])}` : label; };
export const weekSortKey = (label: string) => Number(label.match(/(\d+)\s*$/)?.[1] ?? 0);
