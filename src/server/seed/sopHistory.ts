import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/sop-history-fy27.json";
import plan from "../../db/seed/sop-fy27.json";
import planDaily from "../../db/seed/sop-plan-daily-fy27.json";
import planDailyOrders from "../../db/seed/sop-plan-daily-orders-fy27.json";

/** Apr–Oct 2026 plans, outbound capacity and meeting call-outs from "(Plan vs Actual) S&OP_FY'26-27.xlsx".
 *  Actuals come only from Snowflake: the workbook's actuals are kept in wb_* for reconciliation, never shown as actuals. */
export async function seedSopHistory(S: RunQ) {
  const up = (view: string, period: string, label: string, group: string | null, sort: number, sp: number | null, sa: number | null, np: number | null, na: number | null) =>
    S(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, wb_south_actual, north_plan, wb_north_actual)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (view_key, period, row_label) do update set row_group = excluded.row_group, sort = excluded.sort,
         south_plan = excluded.south_plan, wb_south_actual = excluded.wb_south_actual, north_plan = excluded.north_plan, wb_north_actual = excluded.wb_north_actual`,
      [view, period, label, group, sort, sp, sa, np, na]);
  for (const r of data.rows.filter((x) => (x.sp ?? 0) || (x.np ?? 0))) await up(r.view, r.period, r.label, r.group, r.sort, r.sp, r.sa, r.np, r.na);
  // liquidation: weekly projection vs actual by warehouse (projection workbook)
  const byMonth = new Map<string, number>();
  for (const w of plan.liquidation) {
    if ([w.proj_north, w.proj_south, w.act_north, w.act_south].every((v) => v == null || v === 0)) continue;
    const n = byMonth.get(w.period) ?? 0;
    byMonth.set(w.period, n + 1);
    await up("liquidation", w.period, w.week.replace(/_Week-0?/, " wk "), null, n, w.proj_south ?? 0, w.act_south ?? 0, w.proj_north ?? 0, w.act_north ?? 0);
  }
  for (const d of data.ob_capacity) {
    await S(`insert into sop_ob_capacity (day, warehouse, mp_required, retail_required, planned) values ($1,'South',$2,$3,$4) on conflict (day, warehouse) do nothing`, [d.date, d.mp_south ?? 0, d.retail_south ?? 0, d.planned_south ?? 0]);
    await S(`insert into sop_ob_capacity (day, warehouse, mp_required, retail_required, planned) values ($1,'North',$2,$3,$4) on conflict (day, warehouse) do nothing`, [d.date, d.mp_north ?? 0, d.retail_north ?? 0, d.planned_north ?? 0]);
  }
  // warehouse capacity only — inventory comes from the Snowflake inventory feed
  for (const period of ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]) {
    await S(`insert into sop_wh_capacity (period, warehouse, capacity) values ($1,'South',1600000) on conflict (period, warehouse) do nothing`, [period]);
    await S(`insert into sop_wh_capacity (period, warehouse, capacity) values ($1,'North',1200000) on conflict (period, warehouse) do nothing`, [period]);
  }
  if (!(await S(`select 1 from sop_callouts limit 1`)).length)
    for (const [i, c] of data.callouts.entries())
      await S(`insert into sop_callouts (meeting_date, title, poc, remarks, sort) values ($1,$2,$3,$4,$5)`, [c.date, c.task, c.poc, c.remarks, i]);
}

/** Day-level plans from the projection workbook (B2C per channel × WH, retail per WH). */
export async function seedSopPlanDaily(S: RunQ, which: "items" | "orders" = "items") {
  // items: B2C per channel (item level) + retail; orders: B2C per channel from the order-level sheet (view b2c_orders)
  const rows = (which === "orders" ? planDailyOrders.rows : planDaily.rows) as [string, string, string, number, number][];
  for (let i = 0; i < rows.length; i += 500) {
    const c = rows.slice(i, i + 500);
    await S(`insert into sop_plan_daily (day, view_key, row_label, south, north, source)
             select d::date, v, l, s, n, 'workbook' from unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[]) as t(v, d, l, s, n)
             on conflict (day, view_key, row_label) do update set south = excluded.south, north = excluded.north`,
      [c.map((r) => r[0]), c.map((r) => r[1]), c.map((r) => r[2]), c.map((r) => r[3]), c.map((r) => r[4])]);
  }
}
