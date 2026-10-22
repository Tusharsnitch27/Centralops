// Packaging model: which AOP line a marketplace belongs to, and the rate in force on a day. No server-only imports.

export const AOP_LINES = ["Shopify", "Marketplace", "B2B MP", "Store"] as const;
export type AopLine = (typeof AOP_LINES)[number];

const STORE = new Set(["STORE", "SNITCH HQ", "SAPL_WH_TRANSFERS", "OWN_STORE_B2B"]);
const B2C_MP = new Set(["AJIO", "AMAZON", "COCOBLU", "FLIPKART", "MYNTRA", "NYKAA.COM", "NYKAA_FASHION", "NYKAA"]);
/** marketplacemapped → AOP Packaging line. Everything that is not Shopify, a B2C marketplace or a store is B2B marketplace. */
export function aopLineOf(marketplace: string): AopLine {
  const m = marketplace.trim().toUpperCase();
  if (m === "SHOPIFY") return "Shopify";
  if (STORE.has(m)) return "Store";
  if (B2C_MP.has(m)) return "Marketplace";
  return "B2B MP";
}

export const normType = (t: string | null | undefined) => (t ?? "").trim().toUpperCase().replace(/\s+/g, " ") || "DEFAULT";

export interface RateRow { package_type: string; effective_from: string; rate: number }
/** Rate for a package type on a day: the latest row effective on or before that day. */
export function rateOn(rates: RateRow[], type: string, day: string): number | null {
  let best: RateRow | null = null;
  for (const r of rates) if (r.package_type === type && r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
  return best ? Number(best.rate) : null;
}
