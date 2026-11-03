import "server-only";
import type { RunQ } from "../db";
import { weekOfMonth } from "@/lib/sopWeeks";
import data from "../../db/seed/sop-history-fy27.json";
import plan from "../../db/seed/sop-fy27.json";
import planDaily from "../../db/seed/sop-plan-daily-fy27.json";
import planDailyOrders from "../../db/seed/sop-plan-daily-orders-fy27.json";
import planB2bMp from "../../db/seed/sop-plan-b2bmp-fy27.json";
import planReturns from "../../db/seed/sop-plan-returns-fy27.json";
import planInward from "../../db/seed/sop-plan-inward-fy27.json";
import sheetInputs from "../../db/seed/sop-inputs-fy27.json";

/** Apr–Oct 2026 plans, outbound capacity and meeting call-outs from "(Plan vs Actual) S&OP_FY'26-27.xlsx".
 *  Workbook actuals land in wb_*; months before the Sep 2026 cut-over show them as actuals (seedSopWorkbookActuals), later months use Snowflake. */
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

/** Re-load the B2C daily plan (items or orders) from the projection sheet: each month it covers is replaced whole. */
export async function reloadSopB2cPlan(S: RunQ, which: "items" | "orders") {
  const view = which === "orders" ? "b2c_orders" : "b2c";
  const rows = ((which === "orders" ? planDailyOrders.rows : planDaily.rows) as [string, string, string, number, number][]).filter((r) => r[0] === view);
  const months = [...new Set(rows.map((r) => `${r[1].slice(0, 7)}-01`))];
  await S(`delete from sop_plan_daily where view_key = $1 and date_trunc('month', day)::date = any($2::date[])`, [view, months]);
  await seedSopPlanDaily(S, which);
  if (view !== "b2c") return; // order plans only drive the day-level order comparison
  const month = new Map<string, { period: string; label: string; south: number; north: number }>();
  for (const [, day, label, south, north] of rows) {
    const period = `${day.slice(0, 7)}-01`;
    const m = month.get(`${period}|${label}`) ?? { period, label, south: 0, north: 0 };
    m.south += south; m.north += north;
    month.set(`${period}|${label}`, m);
  }
  // the sheet is the plan for every month it covers: a channel it leaves out has no plan that month
  await S(`update sop_review_rows set south_plan = null, north_plan = null where view_key = 'b2c' and period = any($1::date[])`, [months]);
  for (const m of month.values())
    await S(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, north_plan)
             values ('b2c',$1,$2,$3,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = 'b2c' and period = $1),$4,$5)
             on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
      [m.period, m.label, m.label.startsWith("Shopify") ? null : "Marketplace", Math.round(m.south), Math.round(m.north)]);
}

/** Retail forward from the projection sheet: day plan per WH, and the review's week rows = those days summed by week of the month. */
export async function reloadSopRetailPlan(S: RunQ) {
  const rows = (planDaily.rows as [string, string, string, number, number][]).filter((r) => r[0] === "retail_fwd");
  const months = [...new Set(rows.map((r) => `${r[1].slice(0, 7)}-01`))];
  await S(`delete from sop_plan_daily where view_key = 'retail_fwd' and date_trunc('month', day)::date = any($1::date[])`, [months]);
  await S(`insert into sop_plan_daily (day, view_key, row_label, south, north, source)
           select d::date, 'retail_fwd', '', s, n, 'workbook' from unnest($1::text[], $2::numeric[], $3::numeric[]) as t(d, s, n)`,
    [rows.map((r) => r[1]), rows.map((r) => r[3]), rows.map((r) => r[4])]);
  const week = new Map<string, { period: string; wk: string; south: number; north: number }>();
  for (const [, day, , south, north] of rows) {
    const period = `${day.slice(0, 7)}-01`, wk = weekOfMonth(day);
    const w = week.get(`${period}|${wk}`) ?? { period, wk, south: 0, north: 0 };
    w.south += south; w.north += north;
    week.set(`${period}|${wk}`, w);
  }
  await S(`update sop_review_rows set south_plan = null, north_plan = null where view_key = 'retail_fwd' and period = any($1::date[])`, [months]);
  for (const w of week.values())
    await S(`insert into sop_review_rows (view_key, period, row_label, sort, south_plan, north_plan) values ('retail_fwd',$1,$2,$3,$4,$5)
             on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
      [w.period, w.wk, Number(w.wk.slice(3)), Math.round(w.south), Math.round(w.north)]);
}

/**
 * Inward plans from the projection sheet: category inward and pre-pack by week, category-wise by category. Each month the sheet covers
 * is replaced; a week keeps the label its row already has (e.g. "Apr_Wk_01" from the Plan vs Actual workbook, with its actuals).
 */
export async function reloadSopInwardPlan(S: RunQ) {
  const rows = planInward.rows as [string, string, string, number, number][];
  for (const view of ["category_inward", "prepack", "category_view"]) {
    const vr = rows.filter((r) => r[0] === view);
    const months = [...new Set(vr.map((r) => r[1]))];
    if (!months.length) continue;
    await S(`update sop_review_rows set south_plan = null, north_plan = null where view_key = $1 and period = any($2::date[])`, [view, months]);
    const have = await S<{ period: string; row_label: string }>(`select period::text as period, row_label from sop_review_rows where view_key = $1 and period = any($2::date[])`, [view, months]);
    for (const [, period, label, south, north] of vr) {
      const same = (l: string) => (view === "category_view" ? l.toLowerCase() === label.toLowerCase() : l.slice(-5).toLowerCase() === label.toLowerCase());
      const row = have.find((h) => h.period === period && same(h.row_label))?.row_label ?? label;
      await S(`insert into sop_review_rows (view_key, period, row_label, sort, south_plan, north_plan)
               values ($1,$2,$3,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = $1 and period = $2),$4,$5)
               on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
        [view, period, row, south, north]);
    }
  }
}

/**
 * Future months' projections from the projection sheet entered as each stream's day-wise inputs (North / South), so the Inputs grids
 * show them. Each touched line × month is replaced; actuals and submission status are left alone (owners still review and submit).
 */
export async function loadSopSheetInputs(S: RunQ) {
  const rows = sheetInputs.rows as [string, string, string, string, number][];
  const lines = await S<{ id: string; code: string; name: string }>(`select l.id, s.code, l.name from sop_lines l join sop_streams s on s.id = l.stream_id where l.active`);
  const lineId = new Map(lines.map((l) => [`${l.code}|${l.name}`, l.id]));
  const missing = [...new Set(rows.filter((r) => !lineId.has(`${r[0]}|${r[1]}`)).map((r) => `${r[0]} · ${r[1]}`))];
  if (missing.length) console.warn(`[seed] S&OP inputs: no line for ${missing.join(", ")} — skipped`);
  const ok = rows.filter((r) => lineId.has(`${r[0]}|${r[1]}`));
  const touched = [...new Set(ok.map((r) => `${lineId.get(`${r[0]}|${r[1]}`)}|${r[2].slice(0, 7)}-01`))];
  await S(`update sop_values v set projection = null, revised_projection = null from unnest($1::uuid[], $2::date[]) t(l, p) where v.line_id = t.l and v.period = t.p`,
    [touched.map((t) => t.split("|")[0]), touched.map((t) => t.split("|")[1])]);
  for (let i = 0; i < ok.length; i += 1000) {
    const c = ok.slice(i, i + 1000);
    await S(`insert into sop_values (line_id, period, period_label, dimension, projection)
             select l, date_trunc('month', d::date)::date, d, dim, v from unnest($1::uuid[], $2::text[], $3::text[], $4::numeric[]) as t(l, d, dim, v)
             on conflict (line_id, period, period_label, dimension) do update set projection = excluded.projection, revised_projection = null, updated_at = now()`,
      [c.map((r) => lineId.get(`${r[0]}|${r[1]}`)), c.map((r) => r[2]), c.map((r) => r[3]), c.map((r) => r[4])]);
  }
}

/** Returns plan per month from the projection sheet: "B2C returns" and "B2B returns" (stores + marketplaces), South / North. */
export async function reloadSopReturnsPlan(S: RunQ) {
  const rows = planReturns.rows as [string, string, number, number][];
  const months = [...new Set(rows.map((r) => r[0]))];
  await S(`update sop_review_rows set south_plan = null, north_plan = null where view_key = 'returns' and period = any($1::date[])`, [months]);
  for (const [period, label, south, north] of rows)
    await S(`insert into sop_review_rows (view_key, period, row_label, sort, south_plan, north_plan) values ('returns',$1,$2,$3,$4,$5)
             on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
      [period, label, label.startsWith("B2C") ? 1 : 2, south, north]);
}

/** B2B marketplace monthly plan from the projection sheet. It has no warehouse split, so each channel is split 50/50 South / North. */
export async function reloadSopB2bMpPlan(S: RunQ) {
  const rows = planB2bMp.rows as [string, string, number][];
  const months = [...new Set(rows.map((r) => r[0]))];
  await S(`update sop_review_rows set south_plan = null, north_plan = null where view_key = 'b2b_mp' and period = any($1::date[])`, [months]);
  for (const [period, label, total] of rows)
    await S(`insert into sop_review_rows (view_key, period, row_label, sort, south_plan, north_plan)
             values ('b2b_mp',$1,$2,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = 'b2b_mp' and period = $1),$3,$4)
             on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
      [period, label, Math.ceil(total / 2), Math.floor(total / 2)]);
}

/** Workbook actuals for the months before the Snowflake cut-over (Apr–Aug 2026): inventory flow, returns, review periods. */
export async function seedSopWorkbookActuals(S: RunQ, cutover: string) {
  for (const p of data.periods.filter((x) => x.period < cutover))
    await S(`insert into sop_review_periods (period, through_day, label) values ($1,$2,$3) on conflict (period) do update set through_day = excluded.through_day`, [p.period, p.through, p.label ?? ""]);
  for (const f of data.flow.filter((x) => x.period < cutover)) {
    await S(`insert into sop_inventory_flow (period, warehouse, capacity, opening, inward_category, inward_returns, outward, closing, source) values ($1,$2,$3,$4,$5,$6,$7,$8,'workbook')
             on conflict (period, warehouse) do update set capacity = excluded.capacity, opening = excluded.opening, inward_category = excluded.inward_category,
               inward_returns = excluded.inward_returns, outward = excluded.outward, closing = excluded.closing, source = 'workbook'`,
      [f.period, f.wh, f.capacity, f.opening, f.inward_category, f.inward_returns, f.outward, f.closing]);
    // month-end stock = the workbook's closing inventory
    await S(`insert into sop_wh_capacity (period, warehouse, capacity, inventory, inventory_source) values ($1,$2,$3,$4,'workbook')
             on conflict (period, warehouse) do update set inventory = excluded.inventory, inventory_source = 'workbook'`, [f.period, f.wh, f.capacity, f.closing]);
  }
  for (const r of data.returns.filter((x) => x.period < cutover && x.period >= "2026-04-01"))
    for (const [wh, b2c, b2b, fb, fr] of [["South", r.b2c_south, r.b2b_south, r.fwd_b2c_south, r.fwd_retail_south], ["North", r.b2c_north, r.b2b_north, r.fwd_b2c_north, r.fwd_retail_north]] as const)
      await S(`insert into sop_returns (period, warehouse, b2c, b2b, fwd_b2c, fwd_retail, source) values ($1,$2,$3,$4,$5,$6,'workbook')
               on conflict (period, warehouse) do update set b2c = excluded.b2c, b2b = excluded.b2b, fwd_b2c = excluded.fwd_b2c, fwd_retail = excluded.fwd_retail, source = 'workbook'`,
        [r.period, wh, b2c, b2b, fb, fr]);
}
