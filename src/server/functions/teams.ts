// Pure: which attendance department works each function, how a shared department splits, and the minimum crew no productivity norm covers.
import { ALLOC } from "../aop/processingMath.ts";
import type { FnKey } from "./types";

export type Site = "South" | "North";
export const DEPT_OF: Record<FnKey, string> = { inwards: "Inward", b2c_shopify: "B2C Forward", b2c_marketplace: "B2C Forward", b2b_retail: "B2B Forward",
  b2b_marketplace: "B2B Forward", b2c_returns: "B2C Return", b2b_returns: "B2B Return" };
const STREAM_OF: Partial<Record<FnKey, "B2C Shopify" | "B2C Marketplace" | "B2B Retail" | "B2B Marketplace">> = { b2c_shopify: "B2C Shopify", b2c_marketplace: "B2C Marketplace", b2b_retail: "B2B Retail", b2b_marketplace: "B2B Marketplace" };

/** A function's share of its department's heads at a site: the channel weight (AOP › Processing's ALLOC) over the department's functions' weights; 1 when alone. */
export function poolShare(fn: FnKey, site: Site): number {
  const mates = (Object.keys(DEPT_OF) as FnKey[]).filter((k) => DEPT_OF[k] === DEPT_OF[fn]);
  if (mates.length === 1) return 1;
  const w = (k: FnKey) => ALLOC[site][STREAM_OF[k]!] ?? 0, tot = mates.reduce((a, k) => a + w(k), 0);
  return tot ? w(fn) / tot : 1 / mates.length;
}

/**
 * Minimum crew per department, on roll: the roles with no productivity norm (supervisors, DEO, ERP associates), so no IPP sizes them.
 * North from the site's "Department wise IPP" sheet (Aquib, 23 Nov 2026, current active): B2B Forward DEO 4 + Supervisor 3; B2C Forward DEO 2 +
 * Supervisor 4; Inward DEO 4 + ERP 2; B2B Return DEO 2 + Supervisor 1; B2C Return Supervisor 1. South has no such sheet yet: no crew is assumed
 * there (named on the page) until Manish confirms the figures.
 */
export const MIN_CREW: Record<Site, Record<string, number> | null> = {
  North: { "B2B Forward": 7, "B2C Forward": 6, Inward: 6, "B2B Return": 3, "B2C Return": 1 },
  South: null,
};
/** A function's minimum crew on roll at a site (its department's crew × its pool share); null when the site's crew is not validated. */
export const crewOf = (fn: FnKey, site: Site) => (MIN_CREW[site] ? (MIN_CREW[site]![DEPT_OF[fn]] ?? 0) * poolShare(fn, site) : null);
