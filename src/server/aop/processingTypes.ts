// Shared contract for AOP › Processing / Analysis (server calc ⇄ UI). Pure types + constants, client-safe.
//
// Sheet formulas (Cost Master › YLK_ / TAURU_Processing Costs), reproduced exactly:
//   output per head / month = target_per_day × working_days            (sheet C1 = 23)
//   MP required             = ceil(S&OP projection ÷ output per head / month)
//   planned expense         = planned MP × avg salary
//   planned CPI             = planned expense ÷ S&OP projection
//   actual CPI              = actual expense ÷ final output             (sheet: planned expense ÷ final output)
//   ideal CPI               = avg salary ÷ output per head / month
//   volume adherence        = final output ÷ S&OP projection
//   stream CPI              = Σ process CPI

export type Wh = "South" | "North";

/** Streams = channels on the warehouse side, in sheet order. `dept` = attendance-app department heads come from. */
export const STREAMS = [
  { key: "B2C Shopify", dept: "B2C Forward", family: "forward", channel: "B2C Shopify" },
  { key: "B2C Marketplace", dept: "B2C Forward", family: "forward", channel: "B2C Marketplace" },
  { key: "B2B Retail", dept: "B2B Forward", family: "forward", channel: "B2B Retail" },
  { key: "B2B Marketplace", dept: "B2B Forward", family: "forward", channel: "B2B Marketplace" },
  { key: "B2C Returns Shopify", dept: "B2C Return", family: "returns", channel: "B2C Shopify" },
  { key: "B2C Returns Marketplace", dept: "B2C Return", family: "returns", channel: "B2C Marketplace" },
  { key: "B2B Returns Retail", dept: "B2B Return", family: "returns", channel: "B2B Retail" },
  { key: "B2B Returns Marketplace", dept: "B2B Return", family: "returns", channel: "B2B Marketplace" },
  { key: "Inward", dept: "Inward", family: "inventory", channel: "Shared" },
  { key: "Inventory", dept: "Inventory", family: "inventory", channel: "Shared" },
] as const;
export type StreamKey = (typeof STREAMS)[number]["key"];
/** Attendance departments that are not channel work → Storage & handling overhead (with rent, utilities, security …). */
export const OVERHEAD_DEPTS = ["Ops", "Logistics", "Admin", "Ops & Logistics"] as const;
/** Channels used for attribution, warehouse and logistics alike. */
export const CHANNELS = ["B2C Shopify", "B2C Marketplace", "Q-Com", "B2B Retail", "B2B Marketplace", "Shared"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ProcRow {
  stream: StreamKey; process: string; department: string | null;
  targetPerDay: number | null; workingDays: number; avgSalary: number | null; outputPerHead: number | null; // per month
  idealCpi: number | null;
  sopProj: number | null; mpRequired: number | null;
  needMp: number | null; needExp: number | null; // heads / ₹ the actual output needed at IPP (same days as actual MP)
  plannedMp: number | null; plannedExp: number | null; plannedCpi: number | null;
  actualMp: number | null; actualMpSource: "attendance" | "sheet" | "proposed" | null; // proposed = app split not yet confirmed by Manish
  actualExp: number | null; finalOutput: number | null; actualCpi: number | null;
  volumeAdherence: number | null; mpAdherence: number | null; // actualMp ÷ plannedMp
  costImpact: number | null; // plannedExp − actualExp scaled to output: (plannedCpi − actualCpi) × finalOutput; + = favourable
}
export interface StreamBlock {
  stream: StreamKey; channel: string; dept: string;
  rows: ProcRow[];
  sopProj: number | null; finalOutput: number | null; plannedMp: number; actualMp: number | null;
  needMp: number | null; needExp: number | null; actualExp: number | null;
  idealCpi: number | null; plannedCpi: number | null; actualCpi: number | null; volumeAdherence: number | null;
}
export interface ProcessingMonth {
  period: string; warehouse: Wh; streams: StreamBlock[];
  totals: { plannedExp: number; actualExp: number | null; plannedMp: number; actualMp: number | null; needMp: number | null; needExp: number | null };
  /** attendance days behind the actuals (through D-1) and the month's days; null = sheet month */
  actualDays: { days: number; of: number } | null;
  /** each stream's share of its attendance department's heads under the rule split (Σ over a department's streams = 1) */
  shares: Partial<Record<StreamKey, number>>;
}

/** Department heads from attendance for a month, and how much of it has been assigned to stream × process. */
export interface MpAssignment {
  period: string; warehouse: Wh; department: string; presentManDays: number; workingDays: number; avgHeads: number;
  lines: { stream: StreamKey; process: string; heads: number; status: "proposed" | "assigned" }[];
  unassigned: number; // avgHeads − Σ lines.heads (shown as "open — assign" for Manish Charan)
}

/** Cost attributed to a channel for a month. basis: direct = from source data; allocated = by a stated key; pending = waiting for the split tab. */
export interface AttributionRow {
  period: string; warehouse: Wh | "All"; family: "warehouse" | "logistics"; channel: string; process: string;
  amount: number; basis: "direct" | "allocated" | "pending"; key: string; // human-readable allocation key, e.g. "shipments share 42%"
  units: number | null; cpi: number | null;
}

/** Lever inputs for the client-side what-if (multipliers are 1 = as planned). */
export interface Levers { volume: number; productivity: number; adherence: number; salary: number; headcountDelta: number }
export const BASE_LEVERS: Levers = { volume: 1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 0 };
