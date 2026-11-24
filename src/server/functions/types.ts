// Shared types and the function list for the AOP Functions view (pure; no server imports).
import type { StreamKey } from "../aop/processingTypes";
export type FnKey = "inwards" | "b2c_shopify" | "b2c_marketplace" | "b2b_retail" | "b2b_marketplace" | "b2c_returns" | "b2b_returns";
export type FnSite = "South" | "North" | "Both";
export type FnMode = "day" | "month";
export interface DayRow { day: string; site: "South" | "North"; projected: number | null; received: number | null; processed: number | null;
  issues: number | null; presentHeads: number | null; overlay: number | null; overlayBase?: number | null } // overlay: SLA % or merchandising SLA %, function-specific; overlayBase: its denominator (units judged), so Both / months weight it
export type Cause = "plan_peak" | "volume" | "held_up" | "adhoc" | "below_ipp" | "absenteeism" | "cross_zone" | "dearer_wh" | "courier_rate" | "other";
export interface GapPart { cause: Cause; rupees: number | null; note: string }
export interface Point { key: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
  idealHeads: number | null; actualHeads: number | null; idealCost: number | null; actualCost: number | null;
  costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null;
  /** units the actual ₹ per unit divides by: month = Processing's volume over the days the actual ₹ covers; day = processed */
  actualUnits: number | null }
export interface FunctionView { fn: FnKey; site: FnSite; mode: FnMode; points: Point[]; manpowerGap: GapPart[]; logisticsGap: GapPart[] | null;
  summary: string[]; grey: string[];
  /** What explains the gap: event notes and ad-hoc work outside BAU (justification workbook) in the window, and for B2B the shared team's pattern. */
  explain: { notes: { month: string; site: string; note: string }[]; adhoc: AdhocRow[]; sharedTeam: string | null };
  scenario: { points: Point[]; needed: Needed[];
    /** saving parts over the same periods (+ = less): staffing, cross-zone freight (null when a month lacks it, named in freightMissing); total only when both exist */
    deltaManpower: number | null; manpowerPerUnit: number | null; deltaFreight: number | null; freightMissing: string | null; deltaRupees: number | null; deltaPerUnit: number | null } | null }
/** One ad-hoc task: ₹ = man-days × the month's salary ÷ 23; covers = its share of that site-month's gap left after volume and plan
 *  (output per head + ad-hoc), % — null when the month has no gap to set it against. */
export interface AdhocRow { month: string; site: string; task: string; dates: string | null; manDays: number; rupees: number | null; covers: number | null; note: string | null }
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

/** Non-apparel long tail (categories as CAT folds them; FOOTWEAR → SHOES). SKU prefixes: SHOES SH…, PERFUMES 4MSFR, SUNGLASSES SN…,
 *  ACCESSORIES 4MAC / 4MBD / 4MCP / 4MHT / 4MSCK / 4MSFC / 4MSFL, BELTS 4MBL0, BAGS BP…, TROLLEY 4MTL0. */
export const LONG_TAIL = ["SHOES", "PERFUMES", "SUNGLASSES", "ACCESSORIES", "BELTS", "BAGS", "TROLLEY"];
export const LONG_TAIL_KEY = "(long tail)";
