// Functions module URLs (client-safe): /functions (overview) and /functions/<slug> (one function). Filters travel in the query string.
import type { FnKey, FnMode, FnSite } from "@/server/functions/types";

export const FN_KEYS: FnKey[] = ["inwards", "b2c_shopify", "b2c_marketplace", "b2b_retail", "b2b_marketplace", "b2c_returns", "b2b_returns"];
export const slugOf = (fn: FnKey) => fn.replace(/_/g, "-");
export const fnOfSlug = (slug: string): FnKey | null => FN_KEYS.find((k) => slugOf(k) === slug) ?? null;

export interface FnQuery { site?: FnSite; mode?: FnMode; cycle?: string; scenario?: string }
/** Link to the overview (fn = null) or a function, keeping site, mode and cycle; the Rulebook scenario only on B2B Retail. Defaults are left out. */
export function fnHref(fn: FnKey | null, q: FnQuery) {
  const p = new URLSearchParams();
  if (q.site && q.site !== "Both") p.set("site", q.site);
  if (q.mode && q.mode !== "day") p.set("mode", q.mode);
  if (q.cycle) p.set("cycle", q.cycle);
  if (fn === "b2b_retail" && q.scenario === "1") p.set("scenario", "1");
  const s = p.toString();
  return `/functions${fn ? `/${slugOf(fn)}` : ""}${s ? `?${s}` : ""}`;
}
export const parseSite = (v?: string): FnSite => (v === "South" || v === "North" ? v : "Both");
export const parseMode = (v?: string): FnMode => (v === "month" ? "month" : "day");
