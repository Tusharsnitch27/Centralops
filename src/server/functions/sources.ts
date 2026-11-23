import "server-only";
import { cache } from "react";
import { q } from "../db";
import { addDays, monthStart } from "@/lib/dates";
import { processingMonth } from "../aop/processing";
import { STREAMS, type StreamKey, type Wh } from "../aop/processingTypes";
import { placementShare, processingWeekday, stageTotal, weekdayOf } from "./aggregate";
import { FN, type DayRow, type FnKey } from "./types";
export { FN };

/**
 * Per-function daily sources (one row per day × site). Missing is null, never 0: a day a feed did not cover stays null; a day it
 * covered with nothing for the function is a real 0. Heads: attendance present heads of the department(s) × the stream's share
 * of that department under Processing's rule split, so they tie to AOP › Processing.
 */
export const SITES: Wh[] = ["South", "North"];

/** processingMonth, once per request (dailyRows and the view both need it). */
export const pmonth = cache(processingMonth);
/** The latest store-order day pulled into fn_retail_order (null when none): later days are not known yet, not 0. */
export const lastOrderDay = cache(async () => (await q<{ last: string | null }>(`select max(order_date)::text as last from fn_retail_order`))[0]?.last ?? null);

const dayList = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const monthOf = monthStart;
const slaSite = `case wh when 'NORTH' then 'North' else 'South' end`;
type SiteDay = Map<string, number | null>; // key `${site}|${day}`
const k = (site: string, day: string) => `${site}|${day}`;

const RETURNS = { b2c_returns: "b2c", b2b_returns: "b2b" } as const;
const isReturns = (fn: FnKey): fn is keyof typeof RETURNS => fn in RETURNS;

/** Daily projection per site: S&OP daily plan, the monthly plan spread evenly (B2B Marketplace, Returns), or the rulebook (B2B Retail). */
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
  for (const d of days) { const r = rows.find((x) => x.day === d); for (const s of SITES) out.set(k(s, d), r ? (s === "South" ? r.south : r.north) : months.has(monthOf(d)) ? 0 : null); }
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
  // B2C / B2B MP received: UC items created that day ("ordered", before the SLA source's window) where no SLA cell has the day
  const events = fn === "inwards" || fn === "b2c_returns" ? ["putaway", "received"] : fn === "b2b_returns" ? ["putaway"] : fn === "b2b_retail" ? [f.processed.event] : [f.processed.event, "ordered"];
  const [proj, stage, heads, pms, orders, inward, created, deadline, lastOrder] = await Promise.all([
    projection(fn, from, to, days),
    q<{ day: string; site: string; stream: string; event: string; qty: number }>(
      `select day::text as day, site, stream, event, sum(qty)::float8 as qty from wcm_stage_output where day between $1 and $2 and event = any($3::text[]) group by 1, 2, 3, 4`, [from, to, events]),
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
    fn === "b2c_shopify" || fn === "b2c_marketplace" ? slaCells(f.label, "created_hr", from, to) : Promise.resolve(new Map()),
    fn === "b2c_shopify" || fn === "b2c_marketplace" || fn === "b2b_marketplace" ? slaCells(f.label, "deadline", from, to) : Promise.resolve(new Map()),
    fn === "b2b_retail" ? lastOrderDay() : Promise.resolve(null),
  ]);
  // a stage total is null when the feed did not run for that day × site × event, 0 when it ran with nothing for these streams
  const stageSum = (s: string, d: string, event: string, streams: string[]) => stageTotal(stage, s, d, event, streams);
  const ORDERS_FROM = "2026-04-01"; // fn_retail_order: store orders from the spine from April
  const out: DayRow[] = [];
  for (const d of days) for (const s of sites) {
    const hs = heads.filter((h) => h.day === d && h.site === s), pm = pms.get(k(s, monthOf(d)));
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
      received = deadline.get(k(s, d))?.units ?? stageSum(s, d, "ordered", f.streams);
    } else if (fn === "b2c_returns") {
      received = stageSum(s, d, "received", f.streams); // returns-app packets (~1.05–1.2 units each)
    }
    const processed = stageSum(s, d, f.processed.event, f.processed.streams);
    if (fn === "b2b_returns") received = processed; // no B2B receiving scan: received is the putaway
    out.push({ day: d, site: s, projected: proj.get(k(s, d)) ?? null, received, processed, issues, presentHeads, overlay, overlayBase });
  }
  return out;
}

/** Inward days whose received came from PO receipts (no WAM row) — for the grey area. */
export async function inwardFallbackDays(from: string, to: string, sites: Wh[]) {
  return (await q<{ n: number }>(`select count(*)::int as n from wcm_stage_output o where o.stream = 'Inward' and o.event = 'received' and o.day between $1 and $2
    and o.site = any($3::text[]) and not exists (select 1 from fn_inward_daily w where w.day = o.day and w.site = o.site and w.received is not null)`, [from, to, sites]))[0]?.n ?? 0;
}
