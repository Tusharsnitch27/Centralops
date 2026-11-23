import "server-only";
import { q } from "../db";
import { addDays } from "@/lib/dates";
import { processingWeekday, retimeToWeekday } from "./aggregate";
import { zoneClass } from "./math";
import type { DayRow, FnSite } from "./types";

/**
 * B2B Retail: the "Rulebook followed" scenario (store orders re-timed to their rulebook day) and cross-zone freight from the LR file.
 * Stores match on upper(trim(store)); missing is null, never 0.
 */
const sitesOf = (site: FnSite) => (site === "Both" ? ["South", "North"] : [site]);

/**
 * Each store order moved to the processing weekday of its shipping site's rulebook slot (FRESH → fresh slot, else RPL), in the
 * rulebook upload in force on the order date, within the same ISO week. Stores not in that upload, or with no slot, keep their day.
 * Returns received per day × site for [from, to] (other fields null).
 */
export async function rulebookScenario(site: FnSite, from: string, to: string): Promise<DayRow[]> {
  const rows = await q<{ day: string; site: string; tat: string | null; qty: number }>(
    `with up as (select distinct upload_date as u from fn_rulebook),
     o as (select o.*, (select max(u) from up where u <= o.order_date) as u from fn_retail_order o
           where o.order_date between $1::date - 6 and $2::date + 6 and o.site = any($3::text[]) and o.quantity is not null)
     select o.order_date::text as day, o.site, r.tat, sum(o.quantity)::float8 as qty from o
     left join lateral (select case when o.order_type like 'FRESH%' then r.fresh_tat else r.rpl_tat end as tat from fn_rulebook r
       where r.upload_date = o.u and r.site = o.site and upper(trim(r.store)) = upper(trim(o.store)) limit 1) r on true
     group by 1, 2, 3`, [from, to, sitesOf(site)]);
  const by = new Map<string, number>();
  for (const r of rows) {
    const wd = processingWeekday(r.tat), day = wd ? retimeToWeekday(r.day, wd) : r.day;
    if (day >= from && day <= to) by.set(`${r.site}|${day}`, (by.get(`${r.site}|${day}`) ?? 0) + r.qty);
  }
  return [...by].map(([k, qty]) => { const [s, d] = k.split("|") as ["South" | "North", string];
    return { day: d, site: s, projected: null, received: qty, processed: null, issues: null, presentHeads: null, overlay: null }; });
}

/** AOP › Logistics' B2B retail freight categories. */
const RETAIL = ["Retail B2B", "Dedicated Lane", "NSO FTL", "NSO PTL", "Own vehicle (BLR)"];

/**
 * Cross-zone freight (North site → SOUTH-zone store, South site → NORTH-zone store), per (month, site, zone) lane from the LR file:
 * rupees = Σ cross qty × (lane ₹/unit − home lane ₹/unit), home lane = the other site to the same zone, ₹/unit = Σ freight ÷ Σ qty.
 * Store zone = the store's latest rulebook zone. Months with no LR file and lanes with no home rate are left out and named in
 * `unpriced`; byMonth: each month's ₹ (null when not priced). All three are null when no month has an LR file; rupees is also null when no cross lane has a rate.
 */
export async function crossZone(site: FnSite, months: string[]) {
  const lanes = await q<{ month: string; site: "South" | "North"; zone: string | null; qty: number; freight: number }>(
    `with z as (select distinct on (upper(trim(store))) upper(trim(store)) as s, zone from fn_rulebook where zone is not null order by upper(trim(store)), upload_date desc)
     select b.month::text as month, b.site, z.zone, sum(b.qty)::float8 as qty, sum(b.freight)::float8 as freight
     from lg_b2b_lr b left join z on z.s = upper(trim(b.store)) where b.month = any($1::date[]) and b.category = any($2::text[]) group by 1, 2, 3`,
    [months, RETAIL]);
  const mine = sitesOf(site), unpriced: string[] = [], byMonth: Record<string, number | null> = {};
  const name = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  const rate = (m: string, s: string, z: string) => { const l = lanes.find((x) => x.month === m && x.site === s && x.zone === z); return l?.qty ? l.freight / l.qty : null; };
  let crossUnits: number | null = null, unmappedUnits: number | null = null, rupees: number | null = null;
  for (const m of months) {
    byMonth[m] = null;
    if (!lanes.some((l) => l.month === m)) { unpriced.push(name(m)); continue; }
    crossUnits ??= 0; unmappedUnits ??= 0;
    let part = 0, priced = 0, missed = 0;
    for (const l of lanes.filter((x) => x.month === m && mine.includes(x.site))) {
      const c = zoneClass(l.site, l.zone);
      if (c === "unmapped") unmappedUnits += l.qty;
      if (c !== "cross") continue;
      crossUnits += l.qty;
      const home = rate(m, l.site === "North" ? "South" : "North", l.zone!), own = rate(m, l.site, l.zone!);
      if (home == null || own == null) { unpriced.push(`${name(m)} ${l.site} to ${l.zone!.toLowerCase()} stores`); missed++; continue; }
      part += l.qty * (own - home); priced++;
    }
    if (priced || !missed) { rupees = (rupees ?? 0) + part; byMonth[m] = part; } // a month whose cross lanes all lack a rate adds nothing, not ₹0
  }
  return { crossUnits, unmappedUnits, rupees, unpriced, byMonth };
}
