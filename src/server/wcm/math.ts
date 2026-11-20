// Warehouse Cost Master — pure allocation maths (no server imports; used by queries, actions and scripts/check-wcm.mjs).
//
// One booked rupee, one place: every source line is cut into mutually exclusive slices so that, to the paise,
//   source ₹ = channel-assigned ₹ + approved shared ₹ + unallocated ₹
// Only APPROVED rules post. A draft never changes a result. No rule ⇒ the whole line is Unallocated.
// Model / scenario amounts (heads × salary, IPP estimates) are not source lines and can never enter this sum.

export const SITES = ["South", "North", "Both"] as const;
export type Site = (typeof SITES)[number];
export const BASES = ["budget", "provision", "actual"] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABEL: Record<Basis, string> = { budget: "Budget", provision: "Provision", actual: "Actuals / invoices" };
export const FAMILIES = ["warehousing", "manpower", "ot", "packaging"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = { warehousing: "Warehousing", manpower: "Manpower", ot: "Overtime", packaging: "Packaging" };

/** Warehouse function buckets (space / overhead kept apart from operational handling). */
export const FUNCTIONS = [
  "Storage & space", "Residual overhead", "Inward", "Forward processing", "Returns", "Inventory control", "Ad-hoc handling",
  "VAS (ironing, washing, relabelling)", "Packaging",
] as const;
/** Warehouse / customer channels. "Q-Com" only where evidence supports it. */
export const CHANNELS = ["B2C Shopify", "B2C Marketplace", "B2B Retail", "B2B Marketplace", "Q-Com"] as const;

export interface SourceLine {
  id: string; period: string; basis: Basis; site: Site; family: Family; head: string;
  channel: string | null;            // known from the source itself (e.g. packaging channel lines)
  amount: number | null;             // null = missing input; 0 = booked zero
  cell: string;
}
export interface RuleSlice { fn: string | null; channel: string | null; shared: boolean; share: number } // share of the line, 0 < share ≤ 1
export interface Rule {
  id: string; family: Family; head: string; site: Site | "*"; from: string; to: string | null; // [from, to)
  slices: RuleSlice[]; status: "draft" | "approved" | "rejected" | "reversed" | "superseded";
}
export type SliceKind = "assigned" | "shared" | "unallocated";
export interface Slice { lineId: string; fn: string | null; channel: string | null; kind: SliceKind; paise: number; ruleId: string | null; why: string }

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const rupees = (paise: number) => paise / 100;

/** Validate a rule's slices before it is saved: positive shares, no duplicate target, total ≤ 100%. */
export function checkSlices(slices: RuleSlice[]): string | null {
  if (!slices.length) return "Add at least one slice";
  const seen = new Set<string>();
  let total = 0;
  for (const s of slices) {
    if (!(s.share > 0 && s.share <= 1)) return "Each share must be above 0% and at most 100%";
    if (s.shared && s.channel) return "A shared slice has no channel";
    if (!s.fn && !s.channel) return "Each slice needs a function or a channel";
    const k = `${s.fn}|${s.channel}|${s.shared}`;
    if (seen.has(k)) return "The same function × channel appears twice";
    seen.add(k);
    total += s.share;
  }
  if (total > 1 + 1e-9) return `Shares add up to ${(total * 100).toFixed(2)}% — at most 100%`;
  return null;
}

/** The approved rule that governs a line: same family + head, exact site beats "*", latest start wins. */
export function ruleFor(line: Pick<SourceLine, "family" | "head" | "site" | "period">, rules: Rule[]): Rule | null {
  const hits = rules.filter((r) => r.status === "approved" && r.family === line.family && r.head === line.head
    && (r.site === line.site || r.site === "*") && r.from <= line.period && (r.to == null || line.period < r.to));
  hits.sort((a, b) => Number(b.site !== "*") - Number(a.site !== "*") || b.from.localeCompare(a.from));
  return hits[0] ?? null;
}

/**
 * Split `total` paise by `shares` (Σ ≤ 1). The allocated part is round(total × Σshares), distributed by largest remainder so the
 * pieces add up exactly; the rest is the residual. Works for signed totals (credits).
 */
export function splitPaise(total: number, shares: number[]): { parts: number[]; residual: number } {
  const sign = total < 0 ? -1 : 1, abs = Math.abs(total);
  const sumShares = shares.reduce((a, s) => a + s, 0);
  const target = Math.round(abs * Math.min(sumShares, 1));
  const raw = shares.map((s) => (sumShares ? (target * s) / sumShares : 0));
  const parts = raw.map(Math.floor);
  let left = target - parts.reduce((a, p) => a + p, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) parts[order[k % order.length]!.i]! += 1;
  return { parts: parts.map((p) => p * sign || 0), residual: (abs - target) * sign || 0 }; // || 0: no −0
}

/** Cut one source line into slices. Missing inputs produce no slices (they are coverage gaps, not money). */
export function sliceLine(line: SourceLine, rules: Rule[]): Slice[] {
  if (line.amount == null) return [];
  const total = toPaise(line.amount);
  const rule = ruleFor(line, rules);
  if (!rule) {
    // verified direct coding: the source line itself names the channel (packaging channel lines)
    if (line.channel) return [{ lineId: line.id, fn: line.family === "packaging" ? "Packaging" : null, channel: line.channel, kind: "assigned", paise: total, ruleId: null, why: "channel named on the source line" }];
    return [{ lineId: line.id, fn: null, channel: null, kind: "unallocated", paise: total, ruleId: null, why: "no approved rule" }];
  }
  const { parts, residual } = splitPaise(total, rule.slices.map((s) => s.share));
  const out: Slice[] = rule.slices.map((s, i) => ({
    lineId: line.id, fn: s.fn, channel: s.shared ? null : s.channel ?? line.channel, ruleId: rule.id, paise: parts[i]!,
    kind: s.shared ? "shared" : (s.channel ?? line.channel) ? "assigned" : "unallocated",
    why: s.shared ? "approved shared cost" : (s.channel ?? line.channel) ? "approved rule" : "function confirmed, channel open",
  }));
  if (residual) out.push({ lineId: line.id, fn: null, channel: null, kind: "unallocated", paise: residual, ruleId: rule.id, why: "rule covers part of the line" });
  return out.filter((s) => s.paise !== 0 || total === 0);
}

export interface Totals { source: number; assigned: number; shared: number; unallocated: number; missing: number; lines: number } // paise; missing = count
export const emptyTotals = (): Totals => ({ source: 0, assigned: 0, shared: 0, unallocated: 0, missing: 0, lines: 0 });

/** Roll lines + their slices into totals; throws if any line fails source = assigned + shared + unallocated. */
export function rollup(lines: SourceLine[], slices: Slice[]): Totals {
  const t = emptyTotals();
  const byLine = new Map<string, Slice[]>();
  for (const s of slices) byLine.set(s.lineId, [...(byLine.get(s.lineId) ?? []), s]);
  for (const l of lines) {
    t.lines++;
    if (l.amount == null) { t.missing++; continue; }
    const src = toPaise(l.amount), ss = byLine.get(l.id) ?? [];
    const got = ss.reduce((a, s) => a + s.paise, 0);
    if (got !== src) throw new Error(`Line ${l.cell} does not reconcile: source ${src} paise, slices ${got}`);
    t.source += src;
    for (const s of ss) t[s.kind] += s.paise;
  }
  return t;
}

/**
 * Unit-safe rate: Σ cost ÷ Σ quantity over parts that share one unit. Unavailable (with the reason) when any quantity is missing or
 * zero, or the units differ — never a max, never an average of rates. Cost stays visible either way.
 */
export function rate(parts: { paise: number; qty: number | null; unit: string | null }[]): { value: number | null; unit: string | null; reason: string | null } {
  const units = [...new Set(parts.map((p) => p.unit))];
  if (parts.some((p) => p.qty == null || p.unit == null)) return { value: null, unit: null, reason: "output missing for part of the cost" };
  if (units.length !== 1) return { value: null, unit: null, reason: `units differ (${units.join(", ")})` };
  const qty = parts.reduce((a, p) => a + p.qty!, 0);
  if (!qty) return { value: null, unit: units[0]!, reason: "no output in the window" };
  return { value: rupees(parts.reduce((a, p) => a + p.paise, 0)) / qty, unit: units[0]!, reason: null };
}
