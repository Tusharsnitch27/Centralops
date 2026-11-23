// Warehouse daily operations — pure maths (no server imports; used by queries, actions, the planner UI and scripts/check-wcm.mjs).
// Units: labour in day-equivalents (DE: full present = 1, half day = 0.5, from attendance); output in each stage's native unit.

export type OpsSite = "South" | "North";
/** Attendance home functions (attendance app departments). */
export const HOME_FNS = ["Inward", "B2C Forward", "B2B Forward", "B2C Return", "B2B Return", "Inventory", "Ops & Logistics"] as const;
export const IDLE_REASONS = ["No demand", "Upstream block", "Downtime", "Training / briefing", "Other (see note)"] as const;

/**
 * Revised IPP targets (sheet "WH Cost_3PL Vs Snitch › IPP - Targets", 19–20 Nov 2026), South / North, per day-equivalent.
 * feed = the Snowflake stage event that measures the stage; null = no source yet (output must come from elsewhere).
 * All targets are in units (pieces) per day-equivalent, as the sheet states — confirmed by Malhar M, 21 Nov 2026.
 */
export const REVISED_IPP: { stream: string; stage: string; home: string | null; south: number | null; north: number | null; unit: string; feed: string | null }[] = [
  { stream: "B2C Shopify", stage: "Picker", home: "B2C Forward", south: 700, north: 650, unit: "unit", feed: "picked" },
  { stream: "B2C Shopify", stage: "Packer", home: "B2C Forward", south: 700, north: 600, unit: "unit", feed: "packed" },
  { stream: "B2C Shopify", stage: "Manifest", home: "B2C Forward", south: 2500, north: 2500, unit: "unit", feed: "manifested" },
  { stream: "B2C Marketplace", stage: "Picker", home: "B2C Forward", south: 700, north: 650, unit: "unit", feed: "picked" },
  { stream: "B2C Marketplace", stage: "Packer", home: "B2C Forward", south: 600, north: 500, unit: "unit", feed: "packed" },
  { stream: "B2C Marketplace", stage: "Manifest", home: "B2C Forward", south: 2500, north: 2500, unit: "unit", feed: "manifested" },
  { stream: "B2B Retail", stage: "Picker", home: "B2B Forward", south: 850, north: 800, unit: "unit", feed: "picked" },
  { stream: "B2B Retail", stage: "Packer", home: "B2B Forward", south: 1250, north: 1150, unit: "unit", feed: "packed" },
  { stream: "B2B Retail", stage: "Loader", home: "B2B Forward", south: 750, north: 750, unit: "unit", feed: null },
  { stream: "B2B Marketplace", stage: "Picker", home: "B2B Forward", south: 850, north: 800, unit: "unit", feed: "picked" },
  { stream: "B2B Marketplace", stage: "Packer", home: "B2B Forward", south: 1000, north: 1000, unit: "unit", feed: "packed" },
  { stream: "B2B Marketplace", stage: "Loader", home: "B2B Forward", south: 250, north: 250, unit: "unit", feed: null },
  { stream: "B2C Returns Shopify", stage: "Receiving", home: "B2C Return", south: 2000, north: 2000, unit: "unit", feed: null },
  { stream: "B2C Returns Shopify", stage: "Processing & QC", home: "B2C Return", south: 250, north: 250, unit: "unit", feed: null },
  { stream: "B2C Returns Shopify", stage: "SPF", home: "B2C Return", south: 50, north: 50, unit: "unit", feed: null },
  { stream: "B2C Returns Marketplace", stage: "Receiving", home: "B2C Return", south: 2000, north: 2000, unit: "unit", feed: null },
  { stream: "B2C Returns Marketplace", stage: "Processing", home: "B2C Return", south: 250, north: 250, unit: "unit", feed: null },
  { stream: "B2C Returns Marketplace", stage: "SPF", home: "B2C Return", south: 30, north: 30, unit: "unit", feed: null },
  ...["B2B Returns Retail", "B2B Returns Marketplace"].flatMap((stream) => [
    { stream, stage: "Receiving", home: "B2B Return", south: 2000, north: 2000, unit: "unit", feed: null },
    { stream, stage: "Processing", home: "B2B Return", south: 1500, north: 1500, unit: "unit", feed: null },
    { stream, stage: "QC+Repack", home: "B2B Return", south: 500, north: 500, unit: "unit", feed: null },
    { stream, stage: "WPR", home: "B2B Return", south: 100, north: 100, unit: "unit", feed: null },
  ]),
  { stream: "Inward", stage: "Ratio", home: "Inward", south: 3000, north: 3000, unit: "unit", feed: null },
  { stream: "Inward", stage: "Putaway", home: "Inward", south: 2500, north: 2500, unit: "unit", feed: "putaway" },
  { stream: "Inward", stage: "Unloader", home: "Inward", south: 2500, north: 2500, unit: "unit", feed: null },
  { stream: "Inventory", stage: "Capacity", home: "Inventory", south: null, north: null, unit: "unit", feed: null },
  { stream: "Inventory", stage: "CC", home: "Inventory", south: 2500, north: 2500, unit: "unit", feed: null },
  { stream: "Inventory", stage: "Audit", home: "Inventory", south: 2500, north: 2500, unit: "unit", feed: null },
  { stream: "Inventory", stage: "Mismatch/NF", home: "Inventory", south: 500, north: 500, unit: "unit", feed: null },
  { stream: "Inventory", stage: "Consolidation", home: "Inventory", south: 500, north: 500, unit: "unit", feed: null },
  { stream: "Ad-hoc", stage: "Re-stickering & re-tagging", home: null, south: 200, north: 200, unit: "unit", feed: null },
  { stream: "Ad-hoc", stage: "Category-wise segregation", home: null, south: 200, north: 200, unit: "unit", feed: null },
  { stream: "Ad-hoc", stage: "Liquidation", home: null, south: 200, north: 200, unit: "unit", feed: null },
];
export const REVISED_VERSION = "ipp-targets-2026-11-20";

export const stageKey = (stream: string, stage: string) => `stage:${stream}|${stage}`;
export const idleKey = (reason: string) => `idle:${reason}`;
export const parseTarget = (t: string) =>
  t.startsWith("stage:") ? { kind: "stage" as const, stream: t.slice(6).split("|")[0]!, stage: t.slice(6).split("|").slice(1).join("|") }
    : t.startsWith("idle:") ? { kind: "idle" as const, reason: t.slice(5) } : null;

export interface DeployLine { target: string; de: number; reason?: string | null }
/** Validate a pool's full replacement: positive DE, no duplicate target, Σ confirmed (stage + idle) ≤ available. */
export function checkPool(available: number, lines: DeployLine[]): { assigned: number; idle: number; unassigned: number; error: string | null } {
  const seen = new Set<string>();
  let assigned = 0, idle = 0;
  for (const l of lines) {
    const t = parseTarget(l.target);
    if (!t) return { assigned, idle, unassigned: 0, error: `Unknown target "${l.target}"` };
    if (!(Number.isFinite(l.de) && l.de > 0)) return { assigned, idle, unassigned: 0, error: "Each line needs more than 0 day-equivalents" };
    if (seen.has(l.target)) return { assigned, idle, unassigned: 0, error: "The same target appears twice — one work hour can't land in two places" };
    seen.add(l.target);
    if (t.kind === "idle") { if (!(IDLE_REASONS as readonly string[]).includes(t.reason)) return { assigned, idle, unassigned: 0, error: `Unknown idle reason "${t.reason}"` }; idle += l.de; }
    else assigned += l.de;
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  if (r(assigned + idle) > r(available)) return { assigned, idle, unassigned: 0, error: `Confirmed ${r(assigned + idle)} DE but only ${r(available)} DE were present` };
  return { assigned: r(assigned), idle: r(idle), unassigned: r(available - assigned - idle), error: null };
}

export interface StageKpi { capacity: number | null; utilisation: number | null; unused: number | null; overNorm: number | null; required: number | null; why: string | null }
/**
 * capacity = assigned DE × IPP (same unit as output); utilisation = output ÷ capacity; unused = max(capacity − output, 0);
 * over-norm = max(output − capacity, 0); required DE = output ÷ IPP. Unknown output (no feed) ⇒ unavailable, never zero.
 * Unused capacity is not idle time: it can be no demand, upstream block, below-norm work or missing data.
 */
export function stageKpi(de: number, ipp: number | null, output: number | null): StageKpi {
  const none = (why: string, capacity: number | null = null): StageKpi => ({ capacity, utilisation: null, unused: null, overNorm: null, required: null, why });
  if (ipp == null) return none("no IPP for this stage");
  const capacity = de * ipp;
  if (output == null) return none("no output feed for this stage", de ? capacity : null);
  const required = output / ipp;
  if (!de) return { capacity: 0, utilisation: null, unused: null, overNorm: output, required, why: output ? "output with no confirmed labour" : null };
  return { capacity, utilisation: output / capacity, unused: Math.max(capacity - output, 0), overNorm: Math.max(output - capacity, 0), required, why: null };
}

/** Workload-led proposal for one pool: split available DE across its own stages in proportion to required DE (output ÷ IPP). */
export function proposeSplit(available: number, stages: { target: string; required: number | null }[]): DeployLine[] {
  const need = stages.filter((s) => s.required && s.required > 0);
  const total = need.reduce((a, s) => a + s.required!, 0);
  if (!total || !available) return [];
  const scale = Math.min(1, available / total); // never propose more than is present; any surplus stays unassigned for the lead
  return need.map((s) => ({ target: s.target, de: Math.floor(s.required! * scale * 100) / 100 })).filter((l) => l.de > 0); // floor: Σ never exceeds available
}

/**
 * Attendance role (sub_department) → the stage names it works. Matched only against the pool's own function's stages, so a
 * Dispatch person in B2C Forward lands on Manifest and in B2B Forward on Loader. Roles not listed (DEO, Security, Housekeeping,
 * Not captured) are support / overhead and are never auto-assigned.
 * ponytail: constant, not an editable table — move to a dated table when Ops starts changing it.
 */
export const ROLE_STAGES: Record<string, string[]> = {
  Picker: ["Picker"], Packer: ["Packer"], Manifest: ["Manifest"], Dispatch: ["Manifest", "Loader", "Dispatch"],
  QC: ["Processing & QC", "QC+Repack"], Checking: ["Processing", "Processing & QC"], "Return Processing": ["Processing", "Processing & QC"],
  Putaway: ["Putaway"], "Loading/Unloading": ["Unloader", "Loader"], Auditor: ["Audit", "CC", "CC/Audit"],
};
/** People whose attendance title is an HR grade, not a role: placed by workload instead (decision 21 Nov 2026). */
export const WORKLOAD_ROLE = "Unclassified";

/**
 * Auto split for one pool from attendance roles. stages = the pool's own stages, required DE already scaled to the pool's share.
 *  - a role with one matching stage → all of its DE there;
 *  - several matching stages (channels) → split by required DE; none measured ⇒ left unassigned (channel unknown, never guessed);
 *  - Unclassified → the remaining workload gap after role DE, by required DE (proposeSplit);
 *  - anything else → unassigned. Σ lines ≤ available (scaled down and floored to 0.01 if attendance moved between reads).
 */
export function autoSplit(available: number, roles: { role: string; de: number }[], stages: { target: string; stage: string; required: number | null }[]) {
  const put = new Map<string, number>();
  const add = (t: string, de: number) => put.set(t, (put.get(t) ?? 0) + de);
  let byRole = 0;
  for (const r of roles) {
    if (r.role === WORKLOAD_ROLE || !(r.de > 0)) continue;
    const c = stages.filter((s) => ROLE_STAGES[r.role]?.includes(s.stage));
    const measured = c.filter((s) => s.required && s.required > 0), tot = measured.reduce((a, s) => a + s.required!, 0);
    if (c.length === 1) add(c[0]!.target, r.de);
    else if (tot) for (const s of measured) add(s.target, (r.de * s.required!) / tot);
    else continue;
    byRole += r.de;
  }
  const unclassified = roles.filter((r) => r.role === WORKLOAD_ROLE).reduce((a, r) => a + r.de, 0);
  const gap = stages.map((s) => ({ target: s.target, required: s.required == null ? null : Math.max(s.required - (put.get(s.target) ?? 0), 0) }));
  const work = proposeSplit(unclassified, gap);
  for (const l of work) add(l.target, l.de);
  const total = [...put.values()].reduce((a, x) => a + x, 0), scale = total > available ? available / total : 1;
  const lines: DeployLine[] = [...put].map(([target, de]) => ({ target, de: Math.floor(de * scale * 100) / 100, reason: null })).filter((l) => l.de > 0);
  return { lines, byRole, byWorkload: work.reduce((a, l) => a + l.de, 0) };
}

/**
 * Updated IPP (answer sheets "South / North WH AD Hoc Task and Deployment Update" › Updated IPP, 21 Nov 2026), units per
 * day-equivalent, per site — each site's own stage list. 0 / blank in the sheet ⇒ no IPP (null). North's Putaway is done by its
 * Inventory department, so it sits there (still measured by the Inward putaway feed).
 */
type U = [stream: string, stage: string, home: string | null, ipp: number | null, feed?: string];
const fwd = (stream: string, home: string, rows: [string, number][]): U[] => rows.map(([s, v]) => [stream, s, home, v, ({ Picker: "picked", Packer: "packed", Manifest: "manifested" } as Record<string, string>)[s]]);
export const UPDATED_IPP_VERSION = "ipp-updated-2026-11-21";
export const UPDATED_IPP: Record<OpsSite, U[]> = {
  South: [
    ...fwd("B2C Shopify", "B2C Forward", [["Picker", 750], ["Packer", 1000], ["Manifest", 2500]]),
    ...fwd("B2C Marketplace", "B2C Forward", [["Picker", 750], ["Packer", 700], ["Manifest", 2500], ["Tagloop", 1200]]),
    ...fwd("B2B Retail", "B2B Forward", [["Picker", 1000], ["Packer", 1600], ["Bagging", 100], ["Encoding/Stickering", 300], ["Dispatch", 80]]),
    ...fwd("B2B Marketplace", "B2B Forward", [["Picker", 1000], ["Packer", 1600], ["Bagging", 100]]),
    ["B2C Returns Shopify", "Receiving", "B2C Return", 2000, "received"], ["B2C Returns Shopify", "Processing & QC", "B2C Return", 250, "qc"], ["B2C Returns Shopify", "SPF", "B2C Return", 40], ["B2C Returns Shopify", "WFR/CS escalation", "B2C Return", 55],
    ["B2C Returns Marketplace", "Receiving", "B2C Return", 1000, "received"], ["B2C Returns Marketplace", "Processing", "B2C Return", 250, "qc"], ["B2C Returns Marketplace", "SPF", "B2C Return", 40],
    ["B2B Returns Retail", "Receiving", "B2B Return", 10000], ["B2B Returns Retail", "Processing", "B2B Return", 4000], ["B2B Returns Retail", "QC+Repack", "B2B Return", 550], ["B2B Returns Retail", "WPR", "B2B Return", 150],
    ["B2B Returns Marketplace", "Receiving", "B2B Return", 4000], ["B2B Returns Marketplace", "Processing", "B2B Return", 600], ["B2B Returns Marketplace", "QC+Repack", "B2B Return", 600], ["B2B Returns Marketplace", "WPR", "B2B Return", null],
    ["Inward", "Receiving", "Inward", 30000], ["Inward", "Ratio", "Inward", 10000], ["Inward", "QC", "Inward", 5000], ["Inward", "Putaway", "Inward", 2700, "putaway"], ["Inward", "Unloader", "Inward", 200, "unloaded"],
    ["Inventory", "Capacity", "Inventory", null], ["Inventory", "CC", "Inventory", 4000], ["Inventory", "Audit", "Inventory", 4000], ["Inventory", "Mismatch/NF", "Inventory", 200], ["Inventory", "Consolidation", "Inventory", 1500],
    ["Ad-hoc", "Re-stickering & re-tagging", null, 400], ["Ad-hoc", "Category-wise segregation", null, 1500], ["Ad-hoc", "Liquidation", null, 300],
  ],
  North: [
    ...fwd("B2C Shopify", "B2C Forward", [["Picker", 650], ["Packer", 750], ["Manifest", 1500]]),
    ...fwd("B2C Marketplace", "B2C Forward", [["Picker", 650], ["Packer", 600], ["Manifest", 1500]]),
    ...fwd("B2B Retail", "B2B Forward", [["Picker", 650], ["Packer", 2000], ["Bagging", 150]]),
    ...fwd("B2B Marketplace", "B2B Forward", [["Picker", 650], ["Packer", 2000], ["Bagging", 150]]),
    ["B2C Returns Shopify", "Receiving", "B2C Return", 1200, "received"], ["B2C Returns Shopify", "Processing & QC", "B2C Return", 200, "qc"], ["B2C Returns Shopify", "SPF", "B2C Return", 50],
    ["B2C Returns Marketplace", "Receiving", "B2C Return", 800, "received"], ["B2C Returns Marketplace", "Processing", "B2C Return", 200, "qc"], ["B2C Returns Marketplace", "SPF", "B2C Return", 50],
    ["B2B Returns Retail", "Processing", "B2B Return", 1500], ["B2B Returns Retail", "QC+Repack", "B2B Return", 500], ["B2B Returns Retail", "WPR", "B2B Return", null],
    ["B2B Returns Marketplace", "Processing", "B2B Return", 1500], ["B2B Returns Marketplace", "QC+Repack", "B2B Return", 500],
    ["Inward", "Ratio", "Inward", 2500], ["Inward", "Unloader", "Inward", 100, "unloaded"], ["Inward", "Putaway", "Inventory", 2600, "putaway"],
    ["Inventory", "CC/Audit", "Inventory", 1650], ["Inventory", "Mismatch/NF (IRT)", "Inventory", 200], ["Inventory", "Consolidation", "Inventory", 2000],
    ["Ad-hoc", "Re-stickering & re-tagging", null, 1000], ["Ad-hoc", "Category-wise segregation", null, 2500], ["Ad-hoc", "Liquidation", null, 50000],
  ],
};
