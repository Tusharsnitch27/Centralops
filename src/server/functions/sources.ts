import "server-only";
import { cache } from "react";
import { Pool } from "pg";
import { q } from "../db";
import { addDays, monthStart } from "@/lib/dates";
import { processingMonth } from "../aop/processing";
import { STREAMS, type StreamKey, type Wh } from "../aop/processingTypes";
import { daysIn, placementShare, processingWeekday, stageTotal, weekdayOf } from "./aggregate";
import { FN, type DayRow, type FnKey } from "./types";
export { FN };

/**
 * Per-function daily sources (one row per day × site). Missing is null, never 0: a day a feed did not cover stays null; a day it
 * covered with nothing for the function is a real 0. Heads: attendance present heads of the department(s) × the stream's share
 * of that department under Processing's rule split, so they tie to AOP › Processing.
 */
export const SITES: Wh[] = ["South", "North"];

/**
 * Memo across requests for TTL_MS: a Functions render needs processingMonth and the IPP set for every FY month × site (~190 queries), which
 * crawls against the remote DB. ponytail: in-process TTL cache, so edits in Processing / the IPP master show here up to 10 min later; a
 * failed load is dropped so the next render retries. Upgrade to explicit invalidation from the editing actions if that lag matters.
 */
const TTL_MS = 10 * 60_000;
export function memo<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const m = new Map<string, { at: number; p: Promise<R> }>();
  return (...a: A) => {
    const key = JSON.stringify(a), hit = m.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
    const p = fn(...a); m.set(key, { at: Date.now(), p }); p.catch(() => m.delete(key));
    return p;
  };
}
/** processingMonth, memoised (dailyRows and the view both need it). */
export const pmonth = memo(processingMonth);
/** Months in [from, to] ("2026-04-01") with no daily inward plan, whose inward projection is the monthly plan spread evenly. */
export const inwardEvenMonths = async (from: string, to: string) => (await q<{ m: string }>(
  `select period::text as m from sop_review_rows r where view_key = 'category_inward' and period between $1::date and $2::date and south_plan is not null
    and not exists (select 1 from sop_plan_daily d where d.view_key = 'category_inward' and date_trunc('month', d.day)::date = r.period) group by 1`, [monthOf(from), monthOf(to)])).map((r) => r.m);
/** The latest store-order day pulled into fn_retail_order (null when none): later days are not known yet, not 0. */
export const lastOrderDay = cache(async () => (await q<{ last: string | null }>(`select max(order_date)::text as last from fn_retail_order`))[0]?.last ?? null);

const dayList = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const monthOf = monthStart;
const slaSite = `case wh when 'NORTH' then 'North' else 'South' end`;
type SiteDay = Map<string, number | null>; // key `${site}|${day}`
const k = (site: string, day: string) => `${site}|${day}`;

const RETURNS = { b2c_returns: "b2c", b2b_returns: "b2b" } as const;
const isReturns = (fn: FnKey): fn is keyof typeof RETURNS => fn in RETURNS;

/** Daily projection per site: S&OP daily plan, the monthly plan spread evenly (B2B Marketplace, Returns; Inwards before its daily plan), or the rulebook (B2B Retail). */
async function projection(fn: FnKey, from: string, to: string, days: string[]): Promise<SiteDay> {
  const out: SiteDay = new Map();
  if (fn === "b2b_marketplace" || isReturns(fn)) {
    const rows = await q<{ period: string; south: number | null; north: number | null }>(
      `select period::text as period, sum(south_plan)::float8 as south, sum(north_plan)::float8 as north from sop_review_rows
        where view_key = $1 and period between $2::date and $3::date ${isReturns(fn) ? `and row_label ~* '^${RETURNS[fn]}'` : ""} group by 1`,
      [isReturns(fn) ? "returns" : "b2b_mp", monthOf(from), monthOf(to)]);
    const dim = (p: string) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7), 0)).getUTCDate();
    for (const d of days) { const r = rows.find((x) => x.period === monthOf(d)); for (const s of SITES) { const v = r?.[s === "South" ? "south" : "north"]; out.set(k(s, d), v == null ? null : v / dim(monthOf(d))); } }
    return out;
  }
  if (fn === "b2b_retail") {
    // the rulebook upload in force that day: Σ store quantities whose handover slot is worked on that weekday (6 PM = that day, 5 AM = the day before)
    const rows = await q<{ upload: string; site: string; fq: number | null; rq: number | null; fresh_tat: string | null; rpl_tat: string | null }>(
      `select upload_date::text as upload, site, fresh_qty::float8 as fq, rpl_qty::float8 as rq, fresh_tat, rpl_tat from fn_rulebook where upload_date <= $1`, [to]);
    const plan = new Map<string, number>(); // `${upload}|${site}|${weekday}`
    const has = new Set<string>(); // `${upload}|${site}`
    for (const r of rows) {
      has.add(`${r.upload}|${r.site}`);
      for (const [qty, tat] of [[r.fq, r.fresh_tat], [r.rq, r.rpl_tat]] as const) {
        const wd = processingWeekday(tat);
        if (wd && qty != null) plan.set(`${r.upload}|${r.site}|${wd}`, (plan.get(`${r.upload}|${r.site}|${wd}`) ?? 0) + qty);
      }
    }
    const uploads = [...new Set(rows.map((r) => r.upload))].sort();
    for (const d of days) {
      const up = uploads.filter((u) => u <= d).at(-1);
      for (const s of SITES) out.set(k(s, d), up && has.has(`${up}|${s}`) ? plan.get(`${up}|${s}|${weekdayOf(d)}`) ?? 0 : null);
    }
    return out;
  }
  const filter = fn === "inwards" ? `view_key = 'category_inward'` : `view_key = 'b2c' and row_label ${fn === "b2c_shopify" ? "~*" : "!~*"} '^shopify'`;
  const rows = await q<{ day: string; south: number; north: number }>(
    `select day::text as day, sum(south)::float8 as south, sum(north)::float8 as north from sop_plan_daily where ${filter} and day between $1 and $2 group by 1`, [from, to]);
  const months = new Set(rows.map((r) => monthOf(r.day))); // a month with a daily plan: a day with no row is a planned 0
  // inward months with no daily plan (before Sep 2026): the review's monthly plan spread evenly over the days
  const monthly = fn === "inwards" ? await q<{ period: string; south: number | null; north: number | null }>(
    `select period::text as period, sum(south_plan)::float8 as south, sum(north_plan)::float8 as north from sop_review_rows
      where view_key = 'category_inward' and period between $1::date and $2::date group by 1`, [monthOf(from), monthOf(to)]) : [];
  for (const d of days) {
    const r = rows.find((x) => x.day === d), m = months.has(monthOf(d)) ? null : monthly.find((x) => x.period === monthOf(d));
    for (const s of SITES) {
      const v = m?.[s === "South" ? "south" : "north"];
      out.set(k(s, d), r ? (s === "South" ? r.south : r.north) : months.has(monthOf(d)) ? 0 : v == null ? null : v / daysIn(d));
    }
  }
  return out;
}

/** wcm_sla_cell by day (created or deadline) per site: units, and on-time % with its judged base. */
async function slaCells(stream: string, by: "created_hr" | "deadline", from: string, to: string) {
  const rows = await q<{ day: string; site: string; units: number; ok: number; judged: number }>(
    `select ${by}::date::text as day, ${slaSite} as site, sum(units)::float8 as units, sum(within + fut_done)::float8 as ok,
       sum(within + fut_done + breached + pend_breach)::float8 as judged
     from wcm_sla_cell where stream = $1 and ${by} >= $2::date and ${by} < $3::date + 1 group by 1, 2`, [stream, from, to]);
  return new Map(rows.map((r) => [k(r.site, r.day), r]));
}

export async function dailyRows(fn: FnKey, from: string, to: string, sites: Wh[] = SITES): Promise<DayRow[]> {
  const f = FN[fn], days = dayList(from, to);
  const months = [...new Set(days.map(monthOf))];
  // B2C / B2B MP received: units ordered by creation day — UC items ("ordered") and the SLA tracker's created hours
  const events = fn === "inwards" || fn === "b2c_returns" ? ["putaway", "received"] : fn === "b2b_returns" ? ["putaway"] : fn === "b2b_retail" ? [f.processed.event] : [f.processed.event, "ordered"];
  const [proj, stage, heads, pms, orders, inward, created, deadline, lastOrder] = await Promise.all([
    projection(fn, from, to, days),
    q<{ day: string; site: string; stream: string; event: string; qty: number; source: string | null }>(
      `select day::text as day, site, stream, event, source, sum(qty)::float8 as qty from wcm_stage_output where day between $1 and $2 and event = any($3::text[]) group by 1, 2, 3, 4, 5`, [from, to, events]),
    q<{ day: string; site: string; dept: string; heads: number }>(
      `select d.day::text as day, sm.warehouse as site, coalesce(fm.department, d.func) as dept, sum(d.heads)::float8 as heads
       from mp_daily d join mp_site_map sm on sm.site = d.site left join mp_func_map fm on fm.func = d.func
       where d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2, 3`, [from, to, sites]),
    Promise.all(months.flatMap((m) => sites.map(async (s) => [k(s, m), await pmonth(m, s)] as const))).then((x) => new Map(x)),
    fn === "b2b_retail" ? q<{ day: string; site: string; sla: string | null; qty: number }>(
      `select order_date::text as day, site, placement_sla as sla, sum(quantity)::float8 as qty
       from fn_retail_order where order_date between $1 and $2 and quantity is not null group by 1, 2, 3`, [from, to]) : Promise.resolve([]),
    fn === "inwards" ? q<{ day: string; site: string; received: number | null; issues: number | null }>(
      `select day::text as day, site, received::float8 as received, issues::float8 as issues from fn_inward_daily where day between $1 and $2`, [from, to]) : Promise.resolve([]),
    fn === "b2c_shopify" || fn === "b2c_marketplace" || fn === "b2b_marketplace" ? slaCells(f.label, "created_hr", from, to) : Promise.resolve(new Map()),
    fn === "b2c_shopify" || fn === "b2c_marketplace" ? slaCells(f.label, "deadline", from, to) : Promise.resolve(new Map()),
    fn === "b2b_retail" ? lastOrderDay() : Promise.resolve(null),
  ]);
  // a stage total is null when the feed did not run for that day × site × event, 0 when it ran with nothing for these streams
  const stageSum = (s: string, d: string, event: string, streams: string[]) => stageTotal(stage, s, d, event, streams);
  const ORDERS_FROM = "2026-04-01"; // fn_retail_order: store orders from the spine from April
  const headsBy = new Map<string, typeof heads>(); // site-day → its department rows (one pass, not a scan per day)
  for (const h of heads) { const key = k(h.site, h.day); headsBy.set(key, [...(headsBy.get(key) ?? []), h]); }
  const out: DayRow[] = [];
  for (const d of days) for (const s of sites) {
    const hs = headsBy.get(k(s, d)) ?? [], pm = pms.get(k(s, monthOf(d)));
    const share = (st: StreamKey) => pm?.shares[st];
    const deptHeads = f.streams.map((st) => hs.find((h) => h.dept === STREAMS.find((x) => x.key === st)!.dept)?.heads); // a department absent that day is unknown, not 0
    const presentHeads = !hs.length || f.streams.some((st, i) => share(st) == null || deptHeads[i] == null) ? null
      : f.streams.reduce((a, st, i) => a + deptHeads[i]! * share(st)!, 0);
    let received: number | null = null, issues: number | null = null, overlay: number | null = null, overlayBase: number | null = null;
    if (fn === "inwards") {
      const w = inward.find((r) => r.day === d && r.site === s);
      received = w?.received ?? stageSum(s, d, "received", ["Inward"]); // WAM, else PO receipts
      issues = w?.issues ?? null;
    } else if (fn === "b2c_shopify" || fn === "b2c_marketplace") {
      received = created.get(k(s, d))?.units ?? stageSum(s, d, "ordered", f.streams);
      const c = deadline.get(k(s, d));
      if (c?.judged) { overlay = (100 * c.ok) / c.judged; overlayBase = c.judged; }
    } else if (fn === "b2b_retail") {
      const o = orders.filter((r) => r.day === d && r.site === s);
      received = o.length ? o.reduce((a, r) => a + r.qty, 0) : d >= ORDERS_FROM && lastOrder != null && d <= lastOrder ? 0 : null; // after the latest pulled day: not known yet
      ({ overlay, overlayBase } = placementShare(o)); // no-rule units are not judged
    } else if (fn === "b2b_marketplace") {
      // by the day the order was created, as B2C: UC items while they cover the day, then the SLA tracker (its created hours reach back
      // only to orders still open in its window, so it never replaces UC; by deadline it counted lagged orders twice)
      received = stageSum(s, d, "ordered", f.streams) ?? created.get(k(s, d))?.units ?? null;
    } else if (fn === "b2c_returns") {
      received = stageSum(s, d, "received", f.streams); // returns-app packets (~1.05–1.2 units each)
    }
    const processed = stageSum(s, d, f.processed.event, f.processed.streams);
    if (fn === "b2b_returns") received = processed; // no B2B receiving scan: received is the putaway
    out.push({ day: d, site: s, projected: proj.get(k(s, d)) ?? null, received, processed, issues, presentHeads, overlay, overlayBase });
  }
  return out;
}

/** Ad-hoc work and event notes recorded for a function (fn_adhoc / fn_note, migration 093; seed.fn_adhoc). */
export const adhocRows = (fn: FnKey, sites: Wh[], months: string[]) => Promise.all([
  q<{ month: string; site: string; task: string; dates: string | null; man_days: number; note: string | null }>(
    `select month::text as month, site, task, dates, man_days::float8 as man_days, note from fn_adhoc where fn = $1 and site = any($2::text[]) and month = any($3::date[]) order by month, site, id`, [fn, sites, months]),
  q<{ month: string; site: string; note: string }>(`select month::text as month, site, note from fn_note where fn = $1 and site = any($2::text[]) and month = any($3::date[]) order by month, site, id`, [fn, sites, months]),
]);

/**
 * B2B Forward works both B2B Retail and B2B Marketplace. Per site over [from, to] (Sundays out): correlation of the department's present
 * heads with each stream's dispatched units. Heads following retail and not marketplace = the same team absorbs marketplace on lighter
 * retail days, so a fixed monthly split misplaces heads day to day. Null below 20 days.
 */
export async function sharedTeam(sites: Wh[], from: string, to: string) {
  return q<{ site: string; n: number; r: number | null; m: number | null }>(
    `with h as (select d.day, sm.warehouse as site, sum(d.heads)::float8 as heads from mp_daily d join mp_site_map sm on sm.site = d.site
       left join mp_func_map fm on fm.func = d.func where coalesce(fm.department, d.func) = 'B2B Forward' and d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2),
     v as (select day, site, sum(qty) filter (where stream = 'B2B Retail')::float8 as r, sum(qty) filter (where stream = 'B2B Marketplace')::float8 as m
       from wcm_stage_output where event = 'dispatched' and day between $1 and $2 group by 1, 2)
     select h.site, count(*)::int as n, corr(h.heads, v.r)::float8 as r, corr(h.heads, v.m)::float8 as m from h join v using (day, site)
     where extract(dow from h.day) <> 0 group by 1 having count(*) >= 20 order by 1`, [from, to, sites]);
}

/** Inward days whose received came from PO receipts (no WAM row) — for the grey area. */
export async function inwardFallbackDays(from: string, to: string, sites: Wh[]) {
  return (await q<{ n: number }>(`select count(*)::int as n from wcm_stage_output o where o.stream = 'Inward' and o.event = 'received' and o.day between $1 and $2
    and o.site = any($3::text[]) and not exists (select 1 from fn_inward_daily w where w.day = o.day and w.site = o.site and w.received is not null)`, [from, to, sites]))[0]?.n ?? 0;
}

/** SLA rows per receiving / deadline day × site: within and judged units; [] when the function has no SLA source (B2B Marketplace: no TAT). */
export type SlaDay = { day: string; site: Wh; within: number; judged: number };
const rrPool = () => {
  if (!process.env.RETAIL_RETURN_DATABASE_URL) return null;
  const g = globalThis as { __rrPg?: Pool };
  if (!g.__rrPg) {
    g.__rrPg = new Pool({ connectionString: process.env.RETAIL_RETURN_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    g.__rrPg.on("error", (e) => console.error("[retail-return-db] idle client error", e.message)); // a dropped idle client must not crash the app
  }
  return g.__rrPg;
};
/** True when the Retail Return Tool's database is configured (B2B Returns SLA). */
export const hasRetailReturnDb = () => !!process.env.RETAIL_RETURN_DATABASE_URL;

/**
 * Per function (Malhar M, 25 Nov 2026): Inwards and B2C Returns from fn_sla_daily (pullFnSla); B2C Shopify / Marketplace and B2B Retail from
 * wcm_sla_cell by deadline day (within + future-done ÷ those + breached + overdue open); B2B Returns from the WH Retail Return Tool's
 * shipment_tracker (read-only RETAIL_RETURN_DATABASE_URL): considered-delivered day → processing end within 2 days, pieces = DC quantity,
 * open past 2 days = missed; [] when the connection is not set.
 */
export async function slaDaily(fn: FnKey, sites: Wh[], from: string, to: string): Promise<SlaDay[]> {
  const num = (rows: { day: string; site: string; within: number; judged: number }[]) =>
    rows.filter((r) => sites.includes(r.site as Wh)).map((r) => ({ day: r.day, site: r.site as Wh, within: Number(r.within), judged: Number(r.judged) }));
  if (fn === "inwards" || fn === "b2c_returns")
    return num(await q(`select day::text as day, site, within::float8 as within, judged::float8 as judged from fn_sla_daily where fn = $1 and day between $2 and $3`, [fn, from, to]));
  if (fn === "b2c_shopify" || fn === "b2c_marketplace" || fn === "b2b_retail")
    return num(await q(`select deadline::date::text as day, ${slaSite} as site, sum(within + fut_done)::float8 as within, sum(within + fut_done + breached + pend_breach)::float8 as judged
       from wcm_sla_cell where stream = $1 and deadline >= $2::date and deadline < $3::date + 1 group by 1, 2`, [FN[fn].label, from, to]));
  if (fn === "b2b_returns") {
    const pool = rrPool();
    if (!pool) return [];
    try {
    const { rows } = await pool.query<{ day: string; site: string; within: number; judged: number }>(
      `select "consideredDeliveredDate"::text as day, case facility when 'NORTH' then 'North' else 'South' end as site,
         sum(case when "processingEndDate" is not null and "processingEndDate" - "consideredDeliveredDate" <= 2 then "dcQuantity" else 0 end)::float8 as within,
         sum(case when "processingEndDate" is not null or (now() at time zone 'Asia/Kolkata')::date - "consideredDeliveredDate" > 2 then "dcQuantity" else 0 end)::float8 as judged
       from shipment_tracker where "consideredDeliveredDate" between $1 and $2 group by 1, 2`, [from, to]);
    return num(rows);
    } catch (e) { console.error("[retail-return-db] SLA read failed", e instanceof Error ? e.message : e); return []; } // the page still renders, SLA blank
  }
  return [];
}
