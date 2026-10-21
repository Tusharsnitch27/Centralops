import "server-only";
import { q } from "../db";
import { VIEWS, overallTable, flowCalc, flowInsights, latestUtil, returnsInsights, tableRows, trendTable, viewInsights, whInsights, whSeries, type FlowRow, type RawRow, type ReturnsRow, type WhCap } from "@/components/sop/reviewMath";

export async function reviewPeriods() {
  // a month is reviewable once channel / inward actuals exist for it (future liquidation plans alone don't count)
  return (await q<{ p: string }>(`select distinct period::text as p from sop_review_rows where view_key <> 'liquidation' order by 1 desc`)).map((r) => r.p);
}

/** Months covered only partly so far (MTD), keyed by period → last day included. */
export async function partialPeriods() {
  const rows = await q<{ p: string; through_day: number }>(`select period::text as p, through_day from sop_review_periods`);
  return Object.fromEntries(rows.filter((r) => r.through_day < new Date(Date.UTC(Number(r.p.slice(0, 4)), Number(r.p.slice(5, 7)), 0)).getUTCDate()).map((r) => [r.p, r.through_day]));
}

/* ---------- period selection: month / FY quarter / FY ---------- */
export type Grain = "month" | "quarter" | "year";
const fyStart = (m: string) => (Number(m.slice(5, 7)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1);
const fyQuarter = (m: string) => Math.floor(((Number(m.slice(5, 7)) + 8) % 12) / 3) + 1; // Apr–Jun = Q1
const fyLabel = (y: number) => `FY${String(y + 1).slice(2)}`;
const MON = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
export interface PeriodOption { key: string; label: string; months: string[] }
/** Month / quarter / year options built from the months that have review data (newest first). */
export function periodOptions(months: string[], grain: Grain): PeriodOption[] {
  if (grain === "month") return months.map((m) => ({ key: m, label: new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), months: [m] }));
  const groups = new Map<string, string[]>();
  for (const m of months) {
    const k = grain === "quarter" ? `${fyStart(m)}-Q${fyQuarter(m)}` : `${fyStart(m)}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, ms]) => {
    const sorted = ms.sort(), y = Number(k.slice(0, 4));
    const span = sorted.length > 1 ? `${MON(sorted[0])}–${MON(sorted.at(-1)!)}` : MON(sorted[0]);
    return { key: k, months: sorted, label: grain === "quarter" ? `${k.slice(5)} ${fyLabel(y)} · ${span}` : `${fyLabel(y)} · ${span}` };
  });
}

export async function monthlyReview(input: string | string[], label?: string) {
  const months = (Array.isArray(input) ? input : [input]).slice().sort();
  const period = months.at(-1)!; // latest month in the range drives warehouse context and inventory flow
  const multi = months.length > 1;
  const [rowsRaw, caps] = await Promise.all([
    q<{ period: string; view_key: string; row_label: string; row_group: string | null; sort: number; south_plan: number | null; south_actual: number | null; north_plan: number | null; north_actual: number | null }>(
      `select period::text as period, view_key, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual from sop_review_rows where period = any($1::date[]) order by period, view_key, sort, row_label`, [months]),
    q<{ period: string; warehouse: "South" | "North"; capacity: number; inventory: number | null; prepack_units: number | null }>(`select period::text as period, warehouse, capacity, inventory, prepack_units from sop_wh_capacity order by period`),
  ]);
  const wh = whSeries(caps as WhCap[]);
  const prepack: Record<string, { South?: number; North?: number }> = {};
  for (const c of caps) if (c.prepack_units != null) (prepack[c.period] ??= {})[c.warehouse] = Number(c.prepack_units);
  const at = (w: "South" | "North") => wh[w].find((p) => p.period === period && p.util != null) ?? latestUtil(wh[w]);
  const ctx = { South: at("South"), North: at("North") };
  const views = VIEWS.map((v) => {
    // across several months: channel/category views add up by row; week views become one row per month
    const acc = new Map<string, RawRow>();
    for (const r of rowsRaw.filter((x) => x.view_key === v.key)) {
      const label = multi && v.weekly ? MON(r.period) : r.row_label;
      const cur = acc.get(label) ?? { label, group: r.row_group, sp: 0, sa: 0, np: 0, na: 0 };
      cur.sp += r.south_plan ?? 0; cur.sa += r.south_actual ?? 0; cur.np += r.north_plan ?? 0; cur.na += r.north_actual ?? 0;
      acc.set(label, cur);
    }
    const raw = [...acc.values()];
    const def = multi && v.weekly ? { ...v, rowLabel: "Month", weekly: false } : v;
    return { def, rows: tableRows(def, raw), insights: viewInsights(def, raw, ctx) };
  }).filter((v) => v.rows.length > 1);
  const [meta, trendRows, flowRows, returns] = await Promise.all([
    q<{ through_day: number }>(`select through_day from sop_review_periods where period = $1`, [period]),
    q<{ view_key: string; period: string; sp: number; sa: number; np: number; na: number }>(
      `select view_key, period::text as period, coalesce(south_plan,0) as sp, coalesce(south_actual,0) as sa, coalesce(north_plan,0) as np, coalesce(north_actual,0) as na
       from sop_review_rows where period in (select period from sop_review_rows where view_key <> 'liquidation')`),
    q<FlowRow>(`select period::text as period, warehouse, capacity, coalesce(opening,0) as opening, coalesce(inward_category,0) as inward_category, coalesce(inward_returns,0) as inward_returns, coalesce(outward,0) as outward, coalesce(closing,0) as closing from sop_inventory_flow order by period, warehouse desc`),
    q<ReturnsRow>(`select period::text as period, warehouse, b2c, b2b, fwd_b2c, fwd_retail from sop_returns order by period, warehouse desc`),
  ]);
  const flow = flowRows.map(flowCalc);
  const flowNow = flow.filter((f) => f.period === period);
  const days = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const through = meta[0]?.through_day ?? days;
  return {
    period, months, label: label ?? MON(period), multi, prepack, through, mtd: through < days, days, wh, whInsights: whInsights(wh), views, overall: overallTable(views),
    trend: trendTable(trendRows), flow, flowNow, flowInsights: flowInsights(flowNow.length ? flowNow : flow.filter((f) => f.period === flow.at(-1)?.period)),
    returns, returnsInsights: returnsInsights(returns),
  };
}
export type MonthlyReview = Awaited<ReturnType<typeof monthlyReview>>;
