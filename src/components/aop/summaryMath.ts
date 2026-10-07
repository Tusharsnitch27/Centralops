// Pure month maths for the AOP Summary / Review (client + server safe).
import type { FnNode, LineNode, SummaryTree } from "@/server/aop/summaryData";
import type { Vals } from "@/server/aop/model";
import { impactOf, monLabel, type Direction } from "@/server/aop/calc";
import { inr, pct } from "@/lib/format";

export const prevMonth = (t: Pick<SummaryTree, "months">, p: string) => t.months[t.months.indexOf(p) - 1] ?? null;

export interface Agg { plan: number; forecast: number; actual: number; hasPlan: boolean; hasForecast: boolean; hasActual: boolean; planReported: number; forecastReported: number; missing: number }
/** Sum lines over one month or several (a quarter / the year). Gaps use only month-lines that have an actual. */
export function aggLines(lines: LineNode[], period: string | string[]): Agg {
  const periods = Array.isArray(period) ? period : [period];
  const a: Agg = { plan: 0, forecast: 0, actual: 0, hasPlan: false, hasForecast: false, hasActual: false, planReported: 0, forecastReported: 0, missing: 0 };
  for (const l of lines) for (const p of periods) {
    const v: Vals | undefined = l.vals[p];
    if (!v) continue;
    if (v.plan != null) { a.plan += v.plan; a.hasPlan = true; }
    if (v.forecast != null) { a.forecast += v.forecast; a.hasForecast = true; }
    if (v.actual != null) { a.actual += v.actual; a.hasActual = true; a.planReported += v.plan ?? 0; if (v.forecast != null) a.forecastReported += v.forecast; }
    else if ((v.plan ?? 0) !== 0) a.missing++;
  }
  return a;
}

/* ---------- time spans: month · quarter · year ---------- */
export type Grain = "month" | "quarter" | "year";
export interface Span { key: string; label: string; short: string; periods: string[]; closed: boolean }
/** Indian FY quarters: Q1 Apr–Jun … Q4 Jan–Mar. Year offers full FY and YTD (through last closed month). */
export function spansFor(t: Pick<SummaryTree, "months" | "lastClosed">, grain: Grain): Span[] {
  const closed = (ps: string[]) => t.lastClosed != null && ps.every((p) => p <= t.lastClosed!);
  if (grain === "month") return t.months.map((p) => ({ key: p, label: monLabel(p), short: monLabel(p).slice(0, 3), periods: [p], closed: closed([p]) }));
  if (grain === "quarter") {
    const out: Span[] = [];
    for (let i = 0; i < t.months.length; i += 3) {
      const ps = t.months.slice(i, i + 3), q = i / 3 + 1;
      out.push({ key: `Q${q}`, label: `Q${q} · ${monLabel(ps[0]).slice(0, 3)}–${monLabel(ps[ps.length - 1])}`, short: `Q${q}`, periods: ps, closed: closed(ps) });
    }
    return out;
  }
  const ytd = t.lastClosed ? t.months.filter((p) => p <= t.lastClosed!) : [];
  return [
    ...(ytd.length ? [{ key: "YTD", label: `YTD · through ${monLabel(ytd[ytd.length - 1])}`, short: "YTD", periods: ytd, closed: true }] : []),
    { key: "FY", label: "Full year", short: "FY", periods: t.months, closed: closed(t.months) },
  ];
}
export const prevSpan = (spans: Span[], s: Span) => (s.key === "YTD" || s.key === "FY" ? null : spans[spans.findIndex((x) => x.key === s.key) - 1] ?? null);
export const fnLines = (f: FnNode) => [...f.lines, ...f.groups.flatMap((g) => g.lines)];
export const allLines = (t: SummaryTree) => t.functions.flatMap(fnLines);

/** Months that carry any value — the month filter only offers these. */
export function activeMonths(t: SummaryTree) {
  const lines = allLines(t);
  return t.months.filter((p) => lines.some((l) => { const v = l.vals[p]; return v && (v.plan != null || v.forecast != null || v.actual != null); }));
}

/* ---------- deviations (Summary insights + Review prompts) ---------- */
export type DevKind = "over" | "under" | "provision" | "mom_up" | "mom_down" | "missing";
export interface Deviation {
  key: string; kind: DevKind; line: LineNode; fnName: string; path: string; period: string; amount: number; pct: number | null;
  title: string; detail: string; prompt: string; chips: string[]; severity: "high" | "medium" | "low";
}
const CHIPS: Record<DevKind, string[]> = {
  over: ["Higher volume than planned", "Rate / tariff increase", "Arrears from an earlier month", "One-time / ad-hoc cost", "Disputed — credit note expected", "Budget under-estimated"],
  under: ["Invoice not received yet", "Lower volume", "Savings from renegotiation", "Timing — will land next month", "Cost moved to another line"],
  provision: ["Invoice came in different from estimate", "Provision missed a cost", "Volume changed after provisioning", "Credit note adjusted"],
  mom_up: ["Sale event / seasonal volume", "Arrears billed this month", "New vendor or route", "Rate revision", "Quarterly billing landed"],
  mom_down: ["Lower volume", "Invoice pending", "Vendor switched", "Quarterly billing — none this month"],
  missing: ["Invoice pending from vendor", "Awaiting Finance / AP booking", "No spend this month", "Disputed invoice on hold"],
};

export function deviationsFor(t: SummaryTree, period: string, opts: { minAmount?: number; momPct?: number; provPct?: number } = {}): Deviation[] {
  const min = opts.minAmount ?? 25000, momPct = opts.momPct ?? 0.25, provPct = opts.provPct ?? 0.15, th = t.threshold;
  const prev = prevMonth(t, period);
  const closed = t.lastClosed != null && period <= t.lastClosed;
  const out: Deviation[] = [];
  const P = t.labels.plan.toLowerCase(), F = t.labels.forecast.toLowerCase(), A = t.labels.actual.toLowerCase(), M = monLabel(period);
  for (const f of t.functions) {
    const paths: [LineNode, string][] = [...f.lines.map((l) => [l, f.name] as [LineNode, string]), ...f.groups.flatMap((g) => g.lines.map((l) => [l, `${f.name} › ${g.name}`] as [LineNode, string]))];
    for (const [l, path] of paths) {
      const v = l.vals[period];
      if (!v) continue;
      const base = { line: l, fnName: f.name, path, period };
      if (v.actual == null) {
        if (closed && (v.plan ?? 0) !== 0)
          out.push({ ...base, key: `${l.id}:missing`, kind: "missing", amount: v.plan ?? 0, pct: null, severity: "medium",
            title: `${l.name}: no ${A} for ${M}`, detail: `${t.labels.plan} ${inr(v.plan)}${v.forecast != null ? ` · ${t.labels.forecast} ${inr(v.forecast)}` : ""}`,
            prompt: `${M} ${A} for ${l.name} aren't in yet. What's holding them up, and when will they land?`, chips: CHIPS.missing });
        continue;
      }
      if (v.plan != null && v.plan !== 0) {
        const diff = v.actual - v.plan, rel = diff / Math.abs(v.plan), fav = impactOf(l.direction, v.plan, v.actual) >= 0;
        if (Math.abs(diff) >= min && Math.abs(rel) >= th) {
          const kind: DevKind = fav ? "under" : "over";
          const word = l.direction === "lower_better" ? (fav ? `under ${P}` : `over ${P}`) : (fav ? `ahead of ${P}` : `behind ${P}`);
          out.push({ ...base, key: `${l.id}:${kind}`, kind, amount: diff, pct: rel, severity: !fav && Math.abs(rel) > 2 * th ? "high" : !fav ? "medium" : "low",
            title: `${l.name} ${inr(Math.abs(diff))} ${word} in ${M}`, detail: `${t.labels.actual} ${inr(v.actual)} vs ${t.labels.plan} ${inr(v.plan)} (${pct(rel, 0, true)})`,
            prompt: fav ? `${l.name} came in ${inr(Math.abs(diff))} ${word} in ${M}. Is this a real saving or timing?` : `${l.name} was ${inr(Math.abs(diff))} ${word} in ${M} (${pct(rel, 0, true)}). What caused it, and what's the corrective action?`,
            chips: fav ? CHIPS.under : CHIPS.over });
        }
      }
      if (v.forecast != null && v.forecast !== 0) {
        const diff = v.actual - v.forecast, rel = diff / Math.abs(v.forecast);
        if (Math.abs(diff) >= min && Math.abs(rel) >= provPct)
          out.push({ ...base, key: `${l.id}:provision`, kind: "provision", amount: diff, pct: rel, severity: "low",
            title: `${l.name}: ${A} ${pct(rel, 0, true)} vs ${F}`, detail: `${t.labels.actual} ${inr(v.actual)} vs ${t.labels.forecast} ${inr(v.forecast)}`,
            prompt: `${M} ${A} for ${l.name} differ from the ${F} by ${inr(Math.abs(diff))}. Why did the estimate miss?`, chips: CHIPS.provision });
      }
      const pv = prev ? l.vals[prev]?.actual : null;
      if (pv != null && pv !== 0) {
        const diff = v.actual - pv, rel = diff / Math.abs(pv);
        if (Math.abs(diff) >= min * 2 && Math.abs(rel) >= momPct) {
          const up = diff > 0, bad = l.direction === "lower_better" ? up : !up;
          out.push({ ...base, key: `${l.id}:mom`, kind: up ? "mom_up" : "mom_down", amount: diff, pct: rel, severity: bad && Math.abs(rel) > 0.5 ? "medium" : "low",
            title: `${l.name} ${up ? "up" : "down"} ${pct(Math.abs(rel), 0)} month-on-month`, detail: `${monLabel(prev!)} ${inr(pv)} → ${M} ${inr(v.actual)}`,
            prompt: `${l.name} moved ${inr(diff, { sign: true })} from ${monLabel(prev!)} to ${M}. What changed?`, chips: up ? CHIPS.mom_up : CHIPS.mom_down });
        }
      }
    }
  }
  const sev = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || Math.abs(b.amount) - Math.abs(a.amount));
}

/** Does a line already carry a reason for this month? */
export const hasReason = (l: LineNode, period: string) => (l.remarks[period] ?? []).some((r) => r.kind === "variance_reason" || r.kind === "commentary");
export const dirOf = (l: LineNode): Direction => l.direction;

/** Like-for-like change in actuals: only lines that reported in both periods. */
export function momLike(lines: LineNode[], cur: string[], prev: string[]) {
  let a = 0, b = 0, n = 0;
  for (const l of lines) {
    const ca = cur.map((p) => l.vals[p]?.actual).filter((v): v is number => v != null);
    const pa = prev.map((p) => l.vals[p]?.actual).filter((v): v is number => v != null);
    if (ca.length !== cur.length || pa.length !== prev.length) continue;
    a += ca.reduce((x, y) => x + y, 0); b += pa.reduce((x, y) => x + y, 0); n++;
  }
  return n && b ? { cur: a, prev: b, lines: n } : null;
}
