// Shared types for the AOP Functions view (pure; no server imports).
export type FnKey = "inwards" | "b2c_shopify" | "b2c_marketplace" | "b2b_retail" | "b2b_marketplace" | "returns";
export type FnSite = "South" | "North" | "Both";
export type FnMode = "day" | "month";
export interface DayRow { day: string; site: "South" | "North"; projected: number | null; received: number | null; processed: number | null;
  issues: number | null; presentHeads: number | null; overlay: number | null; overlayBase?: number | null } // overlay: SLA % or merchandising SLA %, function-specific; overlayBase: its denominator (units judged), so Both / months weight it
export type Cause = "volume" | "erratic" | "held_up" | "below_ipp" | "absenteeism" | "cross_zone" | "courier_rate" | "other";
export interface GapPart { cause: Cause; rupees: number | null; note: string }
export interface Point { key: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
  idealHeads: number | null; actualHeads: number | null; idealCost: number | null; actualCost: number | null;
  costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null }
export interface FunctionView { fn: FnKey; site: FnSite; mode: FnMode; points: Point[]; manpowerGap: GapPart[]; logisticsGap: GapPart[] | null;
  summary: string[]; grey: string[]; scenario: { label: string; points: Point[]; needed: Needed[]; deltaRupees: number | null; deltaPerUnit: number | null } | null }
/** Heads (and their ₹, costed as ideal) needed for the actual store orders' peak, as placed and on rulebook days; one per point key. */
export interface Needed { key: string; asIsHeads: number | null; asIsCost: number | null; heads: number | null; cost: number | null }
