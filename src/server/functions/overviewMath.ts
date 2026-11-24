// Pure maths for the Functions overview (no server imports; scripts/check-functions.mjs runs it).
// Actuals only: heads present (attendance), items handled (stage feed), booked payroll (Cost Master → AOP).
import { poolShare, type Site } from "./teams.ts";
import { stageTotal } from "./aggregate.ts";
import type { FnKey } from "./types";

export type { Site };
/** Attendance departments that serve no function: counted in the warehouse total once, never in a function row. */
export const SUPPORT_DEPTS = ["Inventory", "Ops & Logistics", "Admin"];

/**
 * What each function counts (Malhar, 24 Nov 2026): a transaction is an item handled — pieces put away (putaway completed quantity: inward,
 * returns) or items dispatched. Unloading is costed per piece the same way (the inward team over the pieces it brings in, not per box).
 * units = the secondary count: packages dispatched / putaway lines (one SKU into one bin). Heads come from one attendance department; departments
 * that serve two functions are split by AOP › Processing's channel weights (ALLOC), so the parts add back to the pool.
 */
export const OVERVIEW_FN: Record<FnKey, { dept: string; txn: { event: string; streams: string[]; unit: string }; units: { event: string; streams: string[]; unit: string } }> = {
  inwards: { dept: "Inward", txn: { event: "putaway", streams: ["Inward"], unit: "pieces put away" }, units: { event: "putaway_lines", streams: ["Inward"], unit: "putaway lines" } },
  b2c_shopify: { dept: "B2C Forward", txn: { event: "dispatched", streams: ["B2C Shopify"], unit: "items dispatched" }, units: { event: "shipments", streams: ["B2C Shopify"], unit: "packages" } },
  b2c_marketplace: { dept: "B2C Forward", txn: { event: "dispatched", streams: ["B2C Marketplace"], unit: "items dispatched" }, units: { event: "shipments", streams: ["B2C Marketplace"], unit: "packages" } },
  b2b_retail: { dept: "B2B Forward", txn: { event: "dispatched", streams: ["B2B Retail"], unit: "items dispatched" }, units: { event: "shipments", streams: ["B2B Retail"], unit: "packages" } },
  b2b_marketplace: { dept: "B2B Forward", txn: { event: "dispatched", streams: ["B2B Marketplace"], unit: "items dispatched" }, units: { event: "shipments", streams: ["B2B Marketplace"], unit: "packages" } },
  b2c_returns: { dept: "B2C Return", txn: { event: "putaway", streams: ["B2C Returns (channel open)"], unit: "pieces put away" }, units: { event: "putaway_lines", streams: ["B2C Returns (channel open)"], unit: "putaway lines" } },
  b2b_returns: { dept: "B2B Return", txn: { event: "putaway", streams: ["B2B Returns Retail", "B2B Returns Marketplace"], unit: "pieces put away" }, units: { event: "putaway_lines", streams: ["B2B Returns Retail", "B2B Returns Marketplace"], unit: "putaway lines" } },
};
/** The support row's own activity: inventory audit moves (pieces moved, putaway_tracking "Audit Activity"). Same feed run as putaway: a day the
 *  putaway feed covered with no audit rows is a real 0, a day it did not cover is unknown. */
export const SUPPORT_TXN = { event: "audit_move", streams: ["Inventory"], unit: "pieces moved (inventory audits)" };
export { poolShare };

export type StageRow = { day: string; site: string; stream: string; event: string; qty: number; source?: string | null };
export type HeadRow = { day: string; site: string; dept: string; heads: number };

/** Σ an event's quantity for these streams on one site-day (rows already that site-day's): AOP Functions' stageTotal — null when the feed did
 *  not cover the day, 0 when it ran with none of these streams; B2B Marketplace dispatch coverage follows UC items. */
export const eventTotal = (mine: StageRow[], event: string, streams: string[]) => (mine.length ? stageTotal(mine, mine[0]!.site, mine[0]!.day, event, streams) : null);

const supportTxn = (stage: StageRow[]) => eventTotal(stage, SUPPORT_TXN.event, SUPPORT_TXN.streams) ?? (eventTotal(stage, "putaway", SUPPORT_TXN.streams) == null ? null : 0);

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
  out.support = { heads: !any ? null : SUPPORT_DEPTS.reduce((a, k) => a + (dept.get(k) ?? 0), 0), txn: supportTxn(stage), units: null };
  out.total = { heads: !any ? null : heads.reduce((a, h) => a + h.heads, 0), txn: null, units: null };
  const fns = Object.keys(OVERVIEW_FN) as FnKey[];
  const parts = [...fns.map((f) => out[f].txn), out.support.txn]; // the seven functions + inventory moves: items handled across all activities
  out.total.txn = parts.every((x) => x != null) ? parts.reduce<number>((a, x) => a + x!, 0) : null; // every activity covered, else unknown
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
