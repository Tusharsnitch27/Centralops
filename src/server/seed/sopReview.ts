import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/sop-review-sep26.json";

/** S&OP monthly review data from the Sep 2026 review sheets (plan vs actual by WH, WH capacity). Idempotent upserts. */
export async function seedSopReview(S: RunQ) {
  for (const r of data.rows)
    await S(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (view_key, period, row_label) do update set row_group = excluded.row_group, sort = excluded.sort,
               south_plan = excluded.south_plan, south_actual = excluded.south_actual, north_plan = excluded.north_plan, north_actual = excluded.north_actual`,
      [r.view, data.period, r.label, r.group, r.sort, r.sp, r.sa, r.np, r.na]);
  for (const c of data.capacity)
    await S(`insert into sop_wh_capacity (period, warehouse, capacity, inventory) values ($1,$2,$3,$4)
             on conflict (period, warehouse) do update set capacity = excluded.capacity, inventory = coalesce(excluded.inventory, sop_wh_capacity.inventory)`,
      [c.period, c.wh, c.capacity, c.inventory]);
}
