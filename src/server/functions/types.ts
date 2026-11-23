// Shared types and the function list for the AOP Functions view (pure; no server imports).
import type { StreamKey } from "../aop/processingTypes";
export type FnKey = "inwards" | "b2c_shopify" | "b2c_marketplace" | "b2b_retail" | "b2b_marketplace" | "b2c_returns" | "b2b_returns";
export type FnSite = "South" | "North" | "Both";
export type FnMode = "day" | "month";
export interface DayRow { day: string; site: "South" | "North"; projected: number | null; received: number | null; processed: number | null;
  issues: number | null; presentHeads: number | null; overlay: number | null; overlayBase?: number | null } // overlay: SLA % or merchandising SLA %, function-specific; overlayBase: its denominator (units judged), so Both / months weight it
export type Cause = "plan_peak" | "volume" | "held_up" | "below_ipp" | "absenteeism" | "cross_zone" | "courier_rate" | "other";
export interface GapPart { cause: Cause; rupees: number | null; note: string }
export interface Point { key: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
  idealHeads: number | null; actualHeads: number | null; idealCost: number | null; actualCost: number | null;
  costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null }
export interface FunctionView { fn: FnKey; site: FnSite; mode: FnMode; points: Point[]; manpowerGap: GapPart[]; logisticsGap: GapPart[] | null;
  summary: string[]; grey: string[]; scenario: { points: Point[]; needed: Needed[]; deltaRupees: number | null; deltaPerUnit: number | null } | null }
/** Heads (and their ₹, costed as ideal) needed for the actual store orders' peak, as placed and on rulebook days; one per point key. */
export interface Needed { key: string; asIsHeads: number | null; asIsCost: number | null; heads: number | null; cost: number | null }

/** Per function: Processing's streams (heads, ₹ and month units tie to AOP › Processing) and the stage that counts as processed. */
type Stage = { streams: string[]; event: string };
export const FN: Record<FnKey, { label: string; streams: StreamKey[]; processed: Stage }> = {
  inwards: { label: "Inwards", streams: ["Inward"], processed: { streams: ["Inward"], event: "putaway" } },
  b2c_shopify: { label: "B2C Shopify", streams: ["B2C Shopify"], processed: { streams: ["B2C Shopify"], event: "dispatched" } },
  b2c_marketplace: { label: "B2C Marketplace", streams: ["B2C Marketplace"], processed: { streams: ["B2C Marketplace"], event: "dispatched" } },
  b2b_retail: { label: "B2B Retail", streams: ["B2B Retail"], processed: { streams: ["B2B Retail"], event: "dispatched" } },
  b2b_marketplace: { label: "B2B Marketplace", streams: ["B2B Marketplace"], processed: { streams: ["B2B Marketplace"], event: "dispatched" } },
  b2c_returns: { label: "B2C Returns", streams: ["B2C Returns Shopify", "B2C Returns Marketplace"], processed: { streams: ["B2C Returns (channel open)"], event: "putaway" } },
  b2b_returns: { label: "B2B Returns", streams: ["B2B Returns Retail", "B2B Returns Marketplace"], processed: { streams: ["B2B Returns Retail", "B2B Returns Marketplace"], event: "putaway" } },
};
