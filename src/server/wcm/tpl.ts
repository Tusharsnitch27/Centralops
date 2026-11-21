// 3PL comparison — pure maths (no server imports; used by the page and scripts/check-wcm.mjs).
// Snitch volumes per stage are priced through each 3PL tariff in its native unit. A stage with no rate, or a rate whose unit
// isn't confirmed, is flagged — never priced as 0 and never silently converted.

export type TplSite = "South" | "North";
export interface RateRow {
  vendor: "Emiza" | "Shiprocket"; service: string; stage: TplStage | null; unit: string; rate: number;
  region: "Rest of India" | "Gurgaon" | "All"; effective: string; status: "current" | "unverified unit" | "reference"; source: string;
}
/** Volume drivers the model prices (one per Snitch stage group). */
export type TplStage = "inward" | "b2c_out" | "b2c_orders" | "b2b_out" | "b2c_returns" | "b2b_returns" | "storage_unit_days";

const EMIZA = "Commercial proposal for Warehouse_Snitch.pdf (Emiza); rates confirmed current 21 Nov 2026";
const SR = "Sheet 'WH Cost_3PL Vs Snitch' › 3PL Cost Vs WH Cost, comments F4 / F8 (Manish C, 19 Nov 2026); confirmed current 21 Nov 2026";
/**
 * Rate card. ponytail: a constant, not a table — move to a dated table when rates start changing in-app.
 * Emiza North (Tauru) is billed at its Gurgaon column. Shiprocket gives one rate for all regions.
 */
export const RATE_CARD: RateRow[] = [
  { vendor: "Emiza", service: "Inward (count, visual QC, GRN, putaway)", stage: "inward", unit: "unit", rate: 3.5, region: "Rest of India", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Inward (count, visual QC, GRN, putaway)", stage: "inward", unit: "unit", rate: 4.0, region: "Gurgaon", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Outward B2C (pick, pack, manifest)", stage: "b2c_out", unit: "unit", rate: 7.5, region: "Rest of India", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Outward B2C (pick, pack, manifest)", stage: "b2c_out", unit: "unit", rate: 9.0, region: "Gurgaon", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Stationery", stage: "b2c_orders", unit: "order", rate: 2.0, region: "All", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Customer returns (DTO) — RTO and DTO can't be separated in putaway, so DTO is used", stage: "b2c_returns", unit: "unit", rate: 7.0, region: "Rest of India", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Customer returns (DTO) — RTO and DTO can't be separated in putaway, so DTO is used", stage: "b2c_returns", unit: "unit", rate: 7.2, region: "Gurgaon", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Emiza", service: "Storage (t-shirts; sweatshirts / hoodies / denims ₹0.13) — category mix not applied", stage: "storage_unit_days", unit: "unit-day", rate: 0.10, region: "All", effective: "2026-11-20", status: "current", source: EMIZA },
  { vendor: "Shiprocket", service: "Inward", stage: "inward", unit: "unit (assumed)", rate: 2.25, region: "All", effective: "2026-11-19", status: "unverified unit", source: SR },
  { vendor: "Shiprocket", service: "B2C processing ₹6.50 + VMS ₹1.75", stage: "b2c_out", unit: "unit", rate: 8.25, region: "All", effective: "2026-11-19", status: "current", source: SR },
  { vendor: "Shiprocket", service: "B2B processing", stage: "b2b_out", unit: "unit", rate: 4.0, region: "All", effective: "2026-11-19", status: "current", source: SR },
  { vendor: "Shiprocket", service: "Returns (incl. ₹1.75 VMS)", stage: "b2c_returns", unit: "unit", rate: 6.75, region: "All", effective: "2026-11-19", status: "current", source: SR },
  { vendor: "Shiprocket", service: "Returns (incl. ₹1.75 VMS)", stage: "b2b_returns", unit: "unit", rate: 6.75, region: "All", effective: "2026-11-19", status: "current", source: SR },
  { vendor: "Shiprocket", service: "Storage — sheet gives ₹3.30 with no unit (per unit per month assumed)", stage: "storage_unit_days", unit: "unit-month (assumed)", rate: 3.30, region: "All", effective: "2026-11-19", status: "unverified unit", source: SR },
];
/** Terms that change the bill but can't be priced from the data we hold — shown beside the result, never folded in. */
export const TERMS: { vendor: string; term: string }[] = [
  { vendor: "Emiza", term: "Minimum guarantee (inward + outward): ₹50,000 / month per location or 80% of projections, whichever is higher (waived month 1)" },
  { vendor: "Emiza", term: "Annual escalation 7% YoY — year-1 rates shown" },
  { vendor: "Emiza", term: "Outward +25% on peak days where processing exceeds daily capacity by 50% — daily capacity not stated, not modelled" },
  { vendor: "Emiza", term: "Loading / unloading ₹4 per box, OT ₹150–405 / hour, VAS (labels, inserts, ironing ₹8 / unit) — no box / VAS counts, not modelled" },
  { vendor: "Emiza", term: "Storage billed on the average of weekly maximum stock — the model uses the daily average (understates)" },
  { vendor: "Emiza", term: "No B2B outward or B2B returns rate in the proposal — those stages are unpriced" },
  { vendor: "Shiprocket", term: "Loading ₹3 per box — no box counts, not modelled" },
  { vendor: "Both", term: "Freight, packaging material and GST are excluded on both sides (GST treatment of the 3PL rates not stated)" },
];

/** Charges a vendor's tariff simply doesn't have (a real ₹0, unlike a missing rate). */
const NOT_CHARGED: Partial<Record<RateRow["vendor"], TplStage[]>> = { Shiprocket: ["b2c_orders"] };

export const regionOf = (s: TplSite): RateRow["region"] => (s === "North" ? "Gurgaon" : "Rest of India");
export function rateFor(vendor: RateRow["vendor"], stage: TplStage, site: TplSite) {
  const rows = RATE_CARD.filter((r) => r.vendor === vendor && r.stage === stage);
  return rows.find((r) => r.region === regionOf(site)) ?? rows.find((r) => r.region === "All") ?? null;
}

export interface TplLine { stage: TplStage; qty: number | null; rate: RateRow | null; amount: number | null; flag: string | null }
/**
 * Price one site-month of volumes through a vendor. storage_unit_days is avg units × days; a unit-month rate is applied to
 * avg units (qty ÷ days). Missing volume or missing rate ⇒ amount null with the reason; priced = Σ known amounts only.
 */
export function priceMonth(vendor: RateRow["vendor"], site: TplSite, vol: Partial<Record<TplStage, number | null>>, days: number) {
  const lines: TplLine[] = (Object.keys(vol) as TplStage[]).map((stage) => {
    const qty = vol[stage] ?? null, rate = rateFor(vendor, stage, site);
    if (!rate && NOT_CHARGED[vendor]?.includes(stage)) return { stage, qty, rate, amount: 0, flag: "not charged" };
    if (!rate) return { stage, qty, rate, amount: null, flag: "no rate in the tariff" };
    if (qty == null) return { stage, qty, rate, amount: null, flag: "volume missing" };
    const units = stage === "storage_unit_days" && rate.unit.startsWith("unit-month") ? qty / days : qty;
    return { stage, qty, rate, amount: Math.round(units * rate.rate * 100) / 100, flag: rate.status === "current" ? null : rate.status };
  });
  const priced = lines.reduce((a, l) => a + (l.amount ?? 0), 0);
  return { lines, priced: Math.round(priced * 100) / 100, complete: lines.every((l) => l.amount != null) };
}
