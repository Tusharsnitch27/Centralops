// Pure maths for the Functions overview (no server imports; scripts/check-functions.mjs runs it).
// Actuals only: heads present (attendance), completed transactions and processed units (stage feed), booked payroll (Cost Master → AOP).
import { ALLOC } from "../aop/processingMath.ts";
import { stageTotal } from "./aggregate.ts";
import type { FnKey } from "./types";

export type Site = "South" | "North";
/** Attendance departments that serve no function: counted in the warehouse total once, never in a function row. */
export const SUPPORT_DEPTS = ["Inventory", "Ops & Logistics", "Admin"];

/**
 * What each function counts. Transaction = one completed warehouse event (a package dispatched, a putaway line, a return packet QC'd);
 * units = the items those events carried (kept apart: one package can hold several items). Heads come from one attendance department;
 * departments that serve two functions are split by the same channel weights AOP › Processing uses (ALLOC), so the parts add back to the pool.
 */
export const OVERVIEW_FN: Record<FnKey, { dept: string; txn: { event: string; streams: string[]; unit: string }; units: { event: string; streams: string[] } }> = {
  inwards: { dept: "Inward", txn: { event: "putaway_lines", streams: ["Inward"], unit: "putaway lines" }, units: { event: "putaway", streams: ["Inward"] } },
  b2c_shopify: { dept: "B2C Forward", txn: { event: "shipments", streams: ["B2C Shopify"], unit: "packages dispatched" }, units: { event: "dispatched", streams: ["B2C Shopify"] } },
  b2c_marketplace: { dept: "B2C Forward", txn: { event: "shipments", streams: ["B2C Marketplace"], unit: "packages dispatched" }, units: { event: "dispatched", streams: ["B2C Marketplace"] } },
  b2b_retail: { dept: "B2B Forward", txn: { event: "shipments", streams: ["B2B Retail"], unit: "packages dispatched" }, units: { event: "dispatched", streams: ["B2B Retail"] } },
  b2b_marketplace: { dept: "B2B Forward", txn: { event: "shipments", streams: ["B2B Marketplace"], unit: "packages dispatched" }, units: { event: "dispatched", streams: ["B2B Marketplace"] } },
  // not QC'd packets: North's returns app stamps QC in bulk (Jul 2026: 97,505 packets on 4 days), so the putaway line is the daily completion
  b2c_returns: { dept: "B2C Return", txn: { event: "putaway_lines", streams: ["B2C Returns (channel open)"], unit: "putaway lines" }, units: { event: "putaway", streams: ["B2C Returns (channel open)"] } },
  b2b_returns: { dept: "B2B Return", txn: { event: "putaway_lines", streams: ["B2B Returns Retail", "B2B Returns Marketplace"], unit: "putaway lines" }, units: { event: "putaway", streams: ["B2B Returns Retail", "B2B Returns Marketplace"] } },
};
const STREAM_OF: Partial<Record<FnKey, string>> = { b2c_shopify: "B2C Shopify", b2c_marketplace: "B2C Marketplace", b2b_retail: "B2B Retail", b2b_marketplace: "B2B Marketplace" };

/** A function's share of its department's heads at a site: the channel weight over the department's functions' weights (1 when it has the pool alone). */
export function poolShare(fn: FnKey, site: Site): number {
  const dept = OVERVIEW_FN[fn].dept, mates = (Object.keys(OVERVIEW_FN) as FnKey[]).filter((k) => OVERVIEW_FN[k].dept === dept);
  if (mates.length === 1) return 1;
  const w = (k: FnKey) => ALLOC[site][STREAM_OF[k] as keyof (typeof ALLOC)["South"]] ?? 0;
  const tot = mates.reduce((a, k) => a + w(k), 0);
  return tot ? w(fn) / tot : 1 / mates.length;
}

export type StageRow = { day: string; site: string; stream: string; event: string; qty: number; source?: string | null };
export type HeadRow = { day: string; site: string; dept: string; heads: number };

/** Σ an event's quantity for these streams on one site-day (rows already that site-day's): AOP Functions' stageTotal — null when the feed did
 *  not cover the day, 0 when it ran with none of these streams; B2B Marketplace dispatch coverage follows UC items. */
export const eventTotal = (mine: StageRow[], event: string, streams: string[]) => (mine.length ? stageTotal(mine, mine[0]!.site, mine[0]!.day, event, streams) : null);

export interface Cell { heads: number | null; txn: number | null; units: number | null }
/** One site-day per function plus the support pool and the warehouse total. Heads: function = its department × poolShare; total = every
 *  department once. A department absent that day is unknown (null), not 0; with no attendance at all the day's heads are null. */
export function dayCells(site: Site, heads: HeadRow[], stage: StageRow[]) {
  const dept = new Map(heads.map((h) => [h.dept, h.heads]));
  const any = heads.length > 0;
  const out = {} as Record<FnKey | "support" | "total", Cell>;
  for (const fn of Object.keys(OVERVIEW_FN) as FnKey[]) {
    const d = OVERVIEW_FN[fn], h = dept.get(d.dept);
    out[fn] = { heads: !any ? null : (h ?? 0) * poolShare(fn, site), txn: eventTotal(stage, d.txn.event, d.txn.streams), units: eventTotal(stage, d.units.event, d.units.streams) };
  }
  out.support = { heads: !any ? null : SUPPORT_DEPTS.reduce((a, k) => a + (dept.get(k) ?? 0), 0), txn: null, units: null };
  out.total = { heads: !any ? null : heads.reduce((a, h) => a + h.heads, 0), txn: null, units: null };
  const fns = Object.keys(OVERVIEW_FN) as FnKey[];
  out.total.txn = fns.every((f) => out[f].txn != null) ? fns.reduce((a, f) => a + out[f].txn!, 0) : null; // all seven covered, else unknown
  return out;
}

/** Sum over periods / sites only when every part is known: a missing part makes the total missing, never a partial number read as whole. */
export const sumAll = (xs: (number | null)[]) => (xs.length && xs.every((x) => x != null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);
/** Σ the known parts and how many there were (for coverage): partial sums are shown with their coverage, never as complete. */
export const sumKnown = (xs: (number | null)[]) => ({ sum: xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null, n: xs.filter((x) => x != null).length });

/** ₹ per transaction = Σ cost ÷ Σ transactions over the same function, site and dates; a dash when either is missing or the count is 0. */
export const perTxn = (cost: number | null, txn: number | null) => (cost == null || !txn ? null : cost / txn);

/**
 * Average payroll per head for a site-month: booked manpower (excl. OT) ÷ heads on roll, heads on roll = head-days present ÷ working days per
 * head (Processing's norm, 23). Head-weighted by construction (total salary over total heads of the covered population). Null when either is missing.
 */
export const salaryPerHead = (booked: number | null, headDays: number | null, wd = 23) => (booked == null || !headDays ? null : booked / (headDays / wd));
