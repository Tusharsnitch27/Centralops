import "server-only";
import { q } from "../db";
import { VIEWS, flowCalc, flowInsights, latestUtil, returnsInsights, tableRows, trendTable, viewInsights, whInsights, whSeries, type FlowRow, type RawRow, type ReturnsRow, type WhCap } from "@/components/sop/reviewMath";

export async function reviewPeriods() {
  // a month is reviewable once channel / inward actuals exist for it (future liquidation plans alone don't count)
  return (await q<{ p: string }>(`select distinct period::text as p from sop_review_rows where view_key <> 'liquidation' order by 1 desc`)).map((r) => r.p);
}

/** Months covered only partly so far (MTD), keyed by period → last day included. */
export async function partialPeriods() {
  const rows = await q<{ p: string; through_day: number }>(`select period::text as p, through_day from sop_review_periods`);
  return Object.fromEntries(rows.filter((r) => r.through_day < new Date(Date.UTC(Number(r.p.slice(0, 4)), Number(r.p.slice(5, 7)), 0)).getUTCDate()).map((r) => [r.p, r.through_day]));
}

export async function monthlyReview(period: string) {
  const [rows, caps] = await Promise.all([
    q<{ view_key: string; row_label: string; row_group: string | null; south_plan: number | null; south_actual: number | null; north_plan: number | null; north_actual: number | null }>(
      `select view_key, row_label, row_group, south_plan, south_actual, north_plan, north_actual from sop_review_rows where period = $1 order by view_key, sort, row_label`, [period]),
    q<{ period: string; warehouse: "South" | "North"; capacity: number; inventory: number | null }>(`select period::text as period, warehouse, capacity, inventory from sop_wh_capacity order by period`),
  ]);
  const wh = whSeries(caps as WhCap[]);
  // utilisation used for impact = the review month if present, else the latest known
  const at = (w: "South" | "North") => wh[w].find((p) => p.period === period && p.util != null) ?? latestUtil(wh[w]);
  const ctx = { South: at("South"), North: at("North") };
  const views = VIEWS.map((v) => {
    const raw: RawRow[] = rows.filter((r) => r.view_key === v.key).map((r) => ({ label: r.row_label, group: r.row_group, sp: r.south_plan ?? 0, sa: r.south_actual ?? 0, np: r.north_plan ?? 0, na: r.north_actual ?? 0 }));
    return { def: v, rows: tableRows(v, raw), insights: viewInsights(v, raw, ctx) };
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
    period, through, mtd: through < days, days, wh, whInsights: whInsights(wh), views,
    trend: trendTable(trendRows), flow, flowNow, flowInsights: flowInsights(flowNow.length ? flowNow : flow.filter((f) => f.period === flow.at(-1)?.period)),
    returns, returnsInsights: returnsInsights(returns),
  };
}
export type MonthlyReview = Awaited<ReturnType<typeof monthlyReview>>;
