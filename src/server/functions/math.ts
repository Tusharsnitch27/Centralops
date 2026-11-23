// Pure maths for the AOP Functions view (no server imports).

/** Units one head clears per day across all stages: 1 ÷ Σ (pass ÷ IPP); box IPP counts 30 units. Stages with no IPP are skipped. */
export function unitsPerHead(stages: { ipp: number | null; unit: string; pass?: number }[]): number | null {
  const used = stages.filter((s) => s.ipp);
  if (!used.length) return null;
  return 1 / used.reduce((a, s) => a + (s.pass ?? 1) / (s.ipp! * (s.unit === "box" ? 30 : 1)), 0);
}

/** Heads needed for the peak day: floor = ⌈peak ÷ uph⌉, roll = same with a 10 % allowance. */
export function idealHeads(peak: number | null, uph: number | null): { floor: number; roll: number } | null {
  if (peak == null || !uph) return null;
  return { floor: Math.ceil(peak / uph), roll: Math.ceil((peak / uph) * 1.1) };
}

export function monthStats(values: (number | null)[]): { peak: number; avg: number; days: number } | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? { peak: Math.max(...v), avg: v.reduce((a, x) => a + x, 0) / v.length, days: v.length } : null;
}

import type { GapPart } from "./types";

/**
 * Splits actual − ideal (head-days × ₹ salary ÷ 23) into causes that add up, walking ideal → plan average → processed → actual:
 *  plan_peak = Pavg − I (I = ideal head-days, Pavg = projected average day ÷ uph × days), volume = N − Pavg (N = processed ÷ uph),
 *  held_up = H (held-up units ÷ uph; null when unknown, then it sits in below_ipp), below_ipp = A − N − H. `other` = the remainder (≈ 0).
 */
export function manpowerGap(i: { salary: number; uph: number; projAvg: number; days: number; processed: number; heldUpUnits: number | null;
  actualHeadDays: number; idealHeadDays: number }): GapPart[] {
  const r = i.salary / 23, A = i.actualHeadDays, I = i.idealHeadDays;
  const pavg = (i.projAvg / i.uph) * i.days, need = i.processed / i.uph;
  const held = i.heldUpUnits == null ? null : i.heldUpUnits / i.uph;
  const plan = pavg - I, volume = need - pavg, below = A - need - (held ?? 0);
  const other = (A - I) - (plan + volume + (held ?? 0) + below);
  const R = (d: number | null) => (d == null ? null : d * r);
  return [
    { cause: "plan_peak", rupees: R(plan), note: "heads the plan holds for its busiest day, beyond the average day" },
    { cause: "volume", rupees: R(volume), note: "processed volume against the projected average" },
    { cause: "held_up", rupees: R(held), note: held == null ? "held-up units not available" : "heads idle on held-up units" },
    { cause: "below_ipp", rupees: R(below), note: "output per head below IPP" },
    { cause: "absenteeism", rupees: null, note: "not measured — 10 % allowance assumed" },
    { cause: "other", rupees: R(other), note: "remainder" },
  ];
}

/** Cost per unit; null on near-zero days (< 10 % of the median) so ratios don't explode. */
export function perUnit(rupees: number | null, units: number | null, medianUnits: number): number | null {
  if (rupees == null || !units || units < 0.1 * medianUnits) return null;
  return rupees / units;
}

export function zoneClass(site: "South" | "North", zone: string | null): "home" | "cross" | "unmapped" {
  const z = zone?.trim().toUpperCase();
  if (z !== "NORTH" && z !== "SOUTH") return "unmapped";
  return z === site.toUpperCase() ? "home" : "cross";
}
