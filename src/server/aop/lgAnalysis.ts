import "server-only";
import { q } from "../db";

/**
 * Logistics working-file analysis (lg_b2c_month, lg_b2b_lr; billed before credit notes) + retail store volume (lg_retail_month).
 * Every figure is a plain sum of source rows; ratios are Σ₹ ÷ Σunits, never an average of ratios.
 */
export type LgSite = "South" | "North" | "Both";
const siteSql = (col: string, i: number) => `($${i}::text = 'Both' or ${col} = $${i})`;

export const lgMonths = async () => (await q<{ m: string }>(`select distinct month::text as m from lg_b2b_lr union select distinct month::text from lg_b2c_month order by 1`)).map((r) => r.m);

/** B2C courier × month × type: AWBs, ₹, qty. RTO % = RTO AWBs ÷ FWD AWBs (same courier, same month). */
export const b2cRows = (months: string[]) => q<{ courier: string; month: string; type: string; awbs: number; cost: number; qty: number }>(
  `select courier, month::text as month, type, sum(awbs)::float8 as awbs, sum(cost)::float8 as cost, sum(qty)::float8 as qty
     from lg_b2c_month where month = any($1::date[]) group by 1, 2, 3 order by 1, 2, 3`, [months]);

export interface B2bAgg { key: string; lrs: number; boxes: number; qty: number; kg: number; freight: number; oneBoxLrs: number; oneBoxFreight: number; oneBoxQty: number }
const AGG = `count(*)::int as lrs, coalesce(sum(boxes), 0)::float8 as boxes, coalesce(sum(qty), 0)::float8 as qty, coalesce(sum(kg), 0)::float8 as kg,
  coalesce(sum(freight), 0)::float8 as freight, count(*) filter (where boxes = 1)::int as "oneBoxLrs",
  coalesce(sum(freight) filter (where boxes = 1), 0)::float8 as "oneBoxFreight", coalesce(sum(qty) filter (where boxes = 1), 0)::float8 as "oneBoxQty"`;

/** B2B LRs grouped by one dimension (month | category | type | partner | site), filtered to months × site × dispatch categories (null = all). */
export function b2bBy(dim: "month" | "category" | "type" | "partner" | "site", months: string[], site: LgSite, category: string[] | null) {
  const col = dim === "month" ? "month::text" : dim;
  return q<B2bAgg>(`select ${col} as key, ${AGG} from lg_b2b_lr
     where month = any($1::date[]) and ${siteSql("site", 2)} and ($3::text[] is null or category = any($3::text[])) group by 1 order by ${dim === "month" ? "1" : "freight desc"}`,
    [months, site, category]);
}
export const b2bCategories = async () => (await q<{ c: string }>(`select category as c from lg_b2b_lr group by 1 order by sum(freight) desc`)).map((r) => r.c);

/**
 * Minimum-charge read per partner: 1-box LRs whose charged weight equals that partner's most common 1-box weight (the
 * likely minimum slab) vs everything else. Inferred, not a contract term — the partner rate cards will confirm the slab.
 */
export const minCharge = (months: string[], site: LgSite, category: string[] | null) => q<{ partner: string; floor_kg: number | null; at_floor: number; at_floor_freight: number; one_box: number; lrs: number }>(
  `with b as (select * from lg_b2b_lr where month = any($1::date[]) and ${siteSql("site", 2)} and ($3::text[] is null or category = any($3::text[]))),
   f as (select partner, mode() within group (order by kg) as floor_kg from b where boxes = 1 and kg > 0 group by 1)
   select b.partner, f.floor_kg::float8 as floor_kg, count(*) filter (where b.boxes = 1 and b.kg = f.floor_kg)::int as at_floor,
     coalesce(sum(b.freight) filter (where b.boxes = 1 and b.kg = f.floor_kg), 0)::float8 as at_floor_freight,
     count(*) filter (where b.boxes = 1)::int as one_box, count(*)::int as lrs
   from b left join f using (partner) group by 1, 2 order by sum(b.freight) desc`, [months, site, category]);

/**
 * Zone lanes: each LR's store matched by lg_key to its zone (lg_zone: spine zone + overrides, migration 094); dispatching site vs store zone.
 * Unmatched stores stay "zone unknown" (shown, never dropped).
 */
export const zoneLanes = (months: string[], site: LgSite, category: string[] | null) => q<{ site: string; zone: string; lrs: number; boxes: number; qty: number; freight: number }>(
  `select b.site, coalesce(z.zone, 'zone unknown') as zone, count(*)::int as lrs, coalesce(sum(b.boxes), 0)::float8 as boxes,
     coalesce(sum(b.qty), 0)::float8 as qty, coalesce(sum(b.freight), 0)::float8 as freight
   from lg_b2b_lr b left join lg_zone z on z.key = lg_key(b.store)
   where b.month = any($1::date[]) and ${siteSql("b.site", 2)} and ($3::text[] is null or b.category = any($3::text[])) group by 1, 2 order by 1, freight desc`, [months, site, category]);

/** Freight (LR file) beside dispatched volume (retail journey spine) per month × site — the retail store correlation. */
export const retailCorrelation = (months: string[], site: LgSite) => q<{ month: string; site: string; freight: number; lr_qty: number; lr_boxes: number; lrs: number; spine_qty: number | null; spine_boxes: number | null; spine_awbs: number | null; spine_orders: number | null }>(
  `with f as (select month, site, sum(freight)::float8 as freight, sum(qty)::float8 as lr_qty, sum(boxes)::float8 as lr_boxes, count(*)::int as lrs
       from lg_b2b_lr where month = any($1::date[]) and category in ('Retail B2B', 'Dedicated Lane', 'NSO FTL', 'NSO PTL', 'Own vehicle (BLR)') group by 1, 2),
   s as (select month, site, sum(qty)::float8 as spine_qty, sum(boxes)::float8 as spine_boxes, sum(awbs)::int as spine_awbs, sum(orders)::int as spine_orders
       from lg_retail_month where month = any($1::date[]) group by 1, 2)
   select f.month::text as month, f.site, f.freight, f.lr_qty, f.lr_boxes, f.lrs, s.spine_qty, s.spine_boxes, s.spine_awbs, s.spine_orders
   from f left join s using (month, site) where ${siteSql("f.site", 2)} order by 1, 2`, [months, site]);

/** Top stores by freight with their spine volume: ₹ per dispatched unit per store. */
export const storeTop = (months: string[], site: LgSite, limit = 25) => q<{ store: string; site: string; zone: string | null; freight: number; lrs: number; one_box: number; lr_qty: number; spine_qty: number | null }>(
  `with v as (select lg_key(store) as s, sum(qty)::float8 as spine_qty from lg_retail_month where month = any($1::date[]) group by 1),
   z as (select coalesce(v.s, g.key) as s, g.zone, v.spine_qty from v full join lg_zone g on g.key = v.s)
   select b.store, b.site, z.zone, sum(b.freight)::float8 as freight, count(*)::int as lrs, count(*) filter (where b.boxes = 1)::int as one_box,
     sum(b.qty)::float8 as lr_qty, max(z.spine_qty) as spine_qty
   from lg_b2b_lr b left join z on z.s = lg_key(b.store)
   where b.month = any($1::date[]) and ${siteSql("b.site", 2)} and b.store <> '' group by 1, 2, 3 order by 4 desc limit ${limit}`, [months, site]);
