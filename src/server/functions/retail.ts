import "server-only";
import { q } from "../db";
import type { StoreOrders } from "./aggregate";
import { dearerWh, zoneClass } from "./math";
import type { FnSite } from "./types";

/**
 * B2B Retail: the "Rulebook followed" scenario (store orders re-timed to their rulebook day) and cross-zone freight from the LR file.
 * Stores match on upper(trim(store)); missing is null, never 0.
 */
const sitesOf = (site: FnSite) => (site === "Both" ? ["South", "North"] : [site]);

/**
 * Store orders per day × site × rulebook slot × placement flag (orders ±6 days around [from, to]), the slot from the rulebook upload in force
 * on the order date (FRESH → fresh slot, else RPL); retimeOrders moves the late ones. Stores not in that upload have no slot.
 * The upload in force is looked up once per order day (d), not per order, and the rulebook joined on its normalised store: the per-order
 * correlated lookup scanned fn_rulebook once for each of ~35k orders (FY, Both: 27.8 s on the local copy, 11–13 s on prod; now ~1 s).
 * Output identical to the per-order form on the local copy (FY Both, Oct–Nov South, last 30 days North). Two rulebook rows of one upload ×
 * site whose stores differ only in case or spacing resolve to the first by store (the old LIMIT 1 took either).
 */
export async function rulebookScenario(site: FnSite, from: string, to: string): Promise<StoreOrders[]> {
  return q<StoreOrders>(
    `with o as (select order_date, site, upper(trim(store)) as s, order_type like 'FRESH%' as fresh, placement_sla, quantity from fn_retail_order
           where order_date between $1::date - 6 and $2::date + 6 and site = any($3::text[]) and quantity is not null),
     up as materialized (select distinct upload_date as u from fn_rulebook),
     d as (select x.d, (select max(u) from up where u <= x.d) as u from (select distinct order_date as d from o) x),
     r as (select distinct on (upload_date, site, upper(trim(store))) upload_date, site, upper(trim(store)) as s, fresh_tat, rpl_tat
           from fn_rulebook order by upload_date, site, upper(trim(store)), store)
     select o.order_date::text as day, o.site, case when o.fresh then r.fresh_tat else r.rpl_tat end as tat, o.placement_sla as sla, sum(o.quantity)::float8 as qty
     from o join d on d.d = o.order_date left join r on r.upload_date = d.u and r.site = o.site and r.s = o.s
     group by 1, 2, 3, 4`, [from, to, sitesOf(site)]);
}

/** AOP › Logistics' B2B retail freight categories. */
const RETAIL = ["Retail B2B", "Dedicated Lane", "NSO FTL", "NSO PTL", "Own vehicle (BLR)"];

/**
 * Cross-zone freight (North site → SOUTH-zone store, South site → NORTH-zone store), per (month, site, zone) lane from the LR file:
 * rupees = Σ cross qty × (lane ₹/unit − home lane ₹/unit), home lane = the other site to the same zone, ₹/unit = Σ freight ÷ Σ qty.
 * Store zone = lg_zone (migration 094: the spine's zone by normalised store key, with Malhar's overrides). East / West stores have no home
 * site: eastWest = units shipped from the dearer site that month × the lane gap to the cheaper one (dearerWh), kept apart from cross-zone. Months with no LR file and lanes with no home rate are left out and named in
 * `unpriced`; byMonth: each month's ₹ (null when not priced). All three are null when no month has an LR file; rupees is also null when no cross lane has a rate.
 */
export async function crossZone(site: FnSite, months: string[]) {
  const lanes = await q<{ month: string; site: "South" | "North"; zone: string | null; qty: number; freight: number }>(
    `select b.month::text as month, b.site, z.zone, sum(b.qty)::float8 as qty, sum(b.freight)::float8 as freight
     from lg_b2b_lr b left join lg_zone z on z.key = lg_key(b.store) where b.month = any($1::date[]) and b.category = any($2::text[]) group by 1, 2, 3`,
    [months, RETAIL]);
  const mine = sitesOf(site), unpriced: string[] = [], byMonth: Record<string, number | null> = {};
  const name = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const rate = (m: string, s: string, z: string) => { const l = lanes.find((x) => x.month === m && x.site === s && x.zone === z); return l?.qty ? l.freight / l.qty : null; };
  let crossUnits: number | null = null, unmappedUnits: number | null = null, rupees: number | null = null;
  const eastWest = { units: 0, rupees: null as number | null, unpriced: [] as string[] };
  for (const m of months) {
    byMonth[m] = null;
    if (!lanes.some((l) => l.month === m)) { unpriced.push(name(m)); continue; }
    crossUnits ??= 0; unmappedUnits ??= 0;
    let part = 0, priced = 0, missed = 0;
    for (const l of lanes.filter((x) => x.month === m && mine.includes(x.site))) {
      const c = zoneClass(l.site, l.zone);
      if (c === "unmapped" && l.zone !== "EXCLUDED") unmappedUnits += l.qty;
      if (c !== "cross") continue;
      crossUnits += l.qty;
      const home = rate(m, l.site === "North" ? "South" : "North", l.zone!), own = rate(m, l.site, l.zone!);
      if (home == null || own == null) { unpriced.push(`${name(m)} ${l.site} to ${l.zone!.toLowerCase()} stores`); missed++; continue; }
      part += l.qty * (own - home); priced++;
    }
    // East / West: per zone, the dearer site's units against the cheaper site's lane (both sites' rates, whichever site is selected)
    for (const zone of ["EAST", "WEST"]) {
      const got = (s: "North" | "South") => lanes.find((x) => x.month === m && x.site === s && x.zone === zone);
      const d = dearerWh({ North: rate(m, "North", zone), South: rate(m, "South", zone) }, { North: got("North")?.qty ?? 0, South: got("South")?.qty ?? 0 });
      const units = mine.reduce((a, s) => a + (got(s as "North" | "South")?.qty ?? 0), 0);
      if (!units) continue;
      if (!d) { eastWest.unpriced.push(`${name(m)} ${zone.toLowerCase()} stores`); continue; }
      if (!mine.includes(d.cheaper === "North" ? "South" : "North")) continue; // the selected site is the cheaper one: nothing extra
      eastWest.units += d.units; eastWest.rupees = (eastWest.rupees ?? 0) + d.rupees;
    }
    if (priced || !missed) { rupees = (rupees ?? 0) + part; byMonth[m] = part; } // a month whose cross lanes all lack a rate adds nothing, not ₹0
  }
  return { crossUnits, unmappedUnits, rupees, unpriced, byMonth, eastWest };
}
