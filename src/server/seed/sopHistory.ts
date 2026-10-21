import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/sop-history-fy27.json";
import plan from "../../db/seed/sop-fy27.json";
import planDaily from "../../db/seed/sop-plan-daily-fy27.json";
import planDailyOrders from "../../db/seed/sop-plan-daily-orders-fy27.json";

/** Apr–Oct 2026 plan vs actual, inventory flow, returns, outbound capacity and meeting call-outs
 *  from "(Plan vs Actual) S&OP_FY'26-27.xlsx". Idempotent upserts. */
export async function seedSopHistory(S: RunQ) {
  for (const p of data.periods)
    await S(`insert into sop_review_periods (period, through_day, label) values ($1,$2,$3) on conflict (period) do update set through_day = excluded.through_day, label = excluded.label`,
      [p.period, p.through, p.label ?? ""]);
  const up = (view: string, period: string, label: string, group: string | null, sort: number, sp: number | null, sa: number | null, np: number | null, na: number | null) =>
    S(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (view_key, period, row_label) do update set row_group = excluded.row_group, sort = excluded.sort,
         south_plan = excluded.south_plan, south_actual = excluded.south_actual, north_plan = excluded.north_plan, north_actual = excluded.north_actual`,
      [view, period, label, group, sort, sp, sa, np, na]);
  for (const r of data.rows) await up(r.view, r.period, r.label, r.group, r.sort, r.sp, r.sa, r.np, r.na);
  // liquidation: weekly projection vs actual by warehouse (projection workbook)
  const byMonth = new Map<string, number>();
  for (const w of plan.liquidation) {
    if ([w.proj_north, w.proj_south, w.act_north, w.act_south].every((v) => v == null || v === 0)) continue;
    const n = byMonth.get(w.period) ?? 0;
    byMonth.set(w.period, n + 1);
    await up("liquidation", w.period, w.week.replace(/_Week-0?/, " wk "), null, n, w.proj_south ?? 0, w.act_south ?? 0, w.proj_north ?? 0, w.act_north ?? 0);
  }
  for (const f of data.flow)
    await S(`insert into sop_inventory_flow (period, warehouse, capacity, opening, inward_category, inward_returns, outward, closing) values ($1,$2,$3,$4,$5,$6,$7,$8)
             on conflict (period, warehouse) do update set capacity = excluded.capacity, opening = excluded.opening, inward_category = excluded.inward_category,
               inward_returns = excluded.inward_returns, outward = excluded.outward, closing = excluded.closing`,
      [f.period, f.wh, f.capacity, f.opening, f.inward_category, f.inward_returns, f.outward, f.closing]);
  for (const r of data.returns) {
    await S(`insert into sop_returns (period, warehouse, b2c, b2b, fwd_b2c, fwd_retail) values ($1,'South',$2,$3,$4,$5) on conflict (period, warehouse) do update set b2c = excluded.b2c, b2b = excluded.b2b, fwd_b2c = excluded.fwd_b2c, fwd_retail = excluded.fwd_retail`,
      [r.period, r.b2c_south, r.b2b_south, r.fwd_b2c_south, r.fwd_retail_south]);
    await S(`insert into sop_returns (period, warehouse, b2c, b2b, fwd_b2c, fwd_retail) values ($1,'North',$2,$3,$4,$5) on conflict (period, warehouse) do update set b2c = excluded.b2c, b2b = excluded.b2b, fwd_b2c = excluded.fwd_b2c, fwd_retail = excluded.fwd_retail`,
      [r.period, r.b2c_north, r.b2b_north, r.fwd_b2c_north, r.fwd_retail_north]);
  }
  // Sep/Oct returns by type (no forward split yet): B2C = SF+MP, B2B = retail + MP returns
  const typ = new Map<string, { b2c: number; b2b: number }>();
  for (const t of data.returns_by_type) {
    const k = `${t.period}|${t.wh}`;
    const cur = typ.get(k) ?? { b2c: 0, b2b: 0 };
    if (/B2C/.test(t.type)) cur.b2c += t.qty ?? 0; else cur.b2b += t.qty ?? 0;
    typ.set(k, cur);
  }
  for (const [k, v] of typ) {
    const [period, wh] = k.split("|");
    await S(`insert into sop_returns (period, warehouse, b2c, b2b) values ($1,$2,$3,$4) on conflict (period, warehouse) do nothing`, [period, wh, v.b2c, v.b2b]);
  }
  for (const d of data.ob_capacity) {
    await S(`insert into sop_ob_capacity (day, warehouse, mp_required, retail_required, planned) values ($1,'South',$2,$3,$4) on conflict (day, warehouse) do nothing`, [d.date, d.mp_south ?? 0, d.retail_south ?? 0, d.planned_south ?? 0]);
    await S(`insert into sop_ob_capacity (day, warehouse, mp_required, retail_required, planned) values ($1,'North',$2,$3,$4) on conflict (day, warehouse) do nothing`, [d.date, d.mp_north ?? 0, d.retail_north ?? 0, d.planned_north ?? 0]);
  }
  // monthly WH inventory (lakh units) from "WH Utilization WeeklyMonthly", Apr–Oct
  const INV: Record<string, [number, number]> = { "2026-04-01": [15.38, 6.82], "2026-05-01": [15.65, 7.5], "2026-06-01": [15.53, 8.41], "2026-07-01": [14.06, 7.08], "2026-08-01": [13.39, 6.89], "2026-09-01": [14.94, 9.33], "2026-10-01": [14.22, 8.83] };
  for (const [period, [s, n]] of Object.entries(INV)) {
    await S(`insert into sop_wh_capacity (period, warehouse, capacity, inventory) values ($1,'South',1600000,$2) on conflict (period, warehouse) do update set inventory = coalesce(sop_wh_capacity.inventory, excluded.inventory)`, [period, Math.round(s * 100000)]);
    await S(`insert into sop_wh_capacity (period, warehouse, capacity, inventory) values ($1,'North',1200000,$2) on conflict (period, warehouse) do update set inventory = coalesce(sop_wh_capacity.inventory, excluded.inventory)`, [period, Math.round(n * 100000)]);
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
