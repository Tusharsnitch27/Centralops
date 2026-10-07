import "server-only";
import { q } from "../db";
import { VIEWS, latestUtil, tableRows, viewInsights, whInsights, whSeries, type RawRow, type WhCap } from "@/components/sop/reviewMath";

export async function reviewPeriods() {
  return (await q<{ p: string }>(`select distinct period::text as p from sop_review_rows order by 1 desc`)).map((r) => r.p);
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
  return { period, wh, whInsights: whInsights(wh), views };
}
export type MonthlyReview = Awaited<ReturnType<typeof monthlyReview>>;
