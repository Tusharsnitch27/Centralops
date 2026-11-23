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

/** Splits (actual head-days − ideal head-days) × ₹/head-day into causes; `other` is the remainder so parts always sum to the total. */
export function manpowerGap(i: { salary: number; workDays: number; uph: number; proj: { peak: number; avg: number }; act: { peak: number; avg: number };
  processed: number; heldUpUnits: number | null; actualHeadDays: number; idealFloor: number }): GapPart[] {
  const r = i.salary / 23, W = i.workDays;
  const volume = ((i.act.avg - i.proj.avg) / i.uph) * W;
  const erratic = ((i.act.peak - i.act.avg) - (i.proj.peak - i.proj.avg)) / i.uph * W;
  const held = i.heldUpUnits == null ? null : i.heldUpUnits / i.uph;
  const below = i.actualHeadDays - i.processed / i.uph - (held ?? 0);
  const other = (i.actualHeadDays - i.idealFloor * W) - (volume + erratic + (held ?? 0) + below);
  const R = (d: number | null) => (d == null ? null : d * r);
  return [
    { cause: "volume", rupees: R(volume), note: "actual average volume vs projected" },
    { cause: "erratic", rupees: R(erratic), note: "peak-to-average spread wider than planned" },
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
