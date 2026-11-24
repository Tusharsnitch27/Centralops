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

/**
 * The projected day the ideal is sized for (Malhar, 24 Nov 2026): the average day plus PEAK_SHARE of the gap to the busiest day, so the peak counts
 * without one spike setting the whole month. 1 = the literal peak (as built 23 Nov), 0 = the average day.
 */
export const PEAK_SHARE = 0.5;
export const planDay = (s: { peak: number; avg: number } | null) => (s == null ? null : s.avg + PEAK_SHARE * (s.peak - s.avg));

export function monthStats(values: (number | null)[]): { peak: number; avg: number; days: number } | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? { peak: Math.max(...v), avg: v.reduce((a, x) => a + x, 0) / v.length, days: v.length } : null;
}

import type { GapPart } from "./types";

/**
 * Splits actual − ideal (head-days × ₹ salary ÷ 23) into causes that add up, walking ideal → plan average → processed → actual:
 *  plan_peak = Pavg − I (I = ideal head-days, Pavg = projected average day ÷ uph × days), volume = N − Pavg (N = processed ÷ uph),
 *  held_up = H (held-up units ÷ uph; null when unknown, then it sits in below_ipp), adhoc = D (man-days on ad-hoc work outside BAU, from
 *  the justification workbook; null when none is recorded), below_ipp = A − N − H − D − C. C = the minimum crew's head-days (teams.ts), in the ideal
 *  and in the actual alike: plan_peak compares workload with workload (Pavg − (I − C)) and the crew, who process nothing, leave output per head.
 */
export function manpowerGap(i: { salary: number; uph: number; projAvg: number; days: number; processed: number; heldUpUnits: number | null;
  actualHeadDays: number; idealHeadDays: number; adhocHeadDays?: number | null; crewHeadDays?: number | null }): GapPart[] {
  const r = i.salary / 23, A = i.actualHeadDays, I = i.idealHeadDays;
  const pavg = (i.projAvg / i.uph) * i.days, need = i.processed / i.uph;
  const held = i.heldUpUnits == null ? null : i.heldUpUnits / i.uph;
  const adhoc = i.adhocHeadDays ?? null;
  const crew = i.crewHeadDays ?? 0;
  const plan = pavg - (I - crew), volume = need - pavg, below = A - need - (held ?? 0) - (adhoc ?? 0) - crew;
  const other = (A - I) - (plan + volume + (held ?? 0) + (adhoc ?? 0) + below);
  const R = (d: number | null) => (d == null ? null : d * r);
  return [
    { cause: "plan_peak", rupees: R(plan), note: "the ideal staffs for the average projected day plus half the gap to the busiest one, with the 10 % and weekly-off cover; an average day needs fewer heads" },
    { cause: "volume", rupees: R(volume), note: "processed volume against the projected average" },
    { cause: "held_up", rupees: R(held), note: held == null ? "held-up units not available" : "heads idle on held-up units" },
    { cause: "adhoc", rupees: R(adhoc), note: adhoc == null ? "no ad-hoc work recorded" : "man-days on tasks outside BAU (re-tagging, re-stickering, physical counts …), from the justification workbook" },
    { cause: "below_ipp", rupees: R(below), note: "units each head processed against the norm (a plus means fewer units per head)" },
    { cause: "absenteeism", rupees: null, note: "not measured — 10 % allowance assumed" },
    { cause: "other", rupees: R(other), note: "what the causes above don't explain" },
  ];
}

/** Cost per unit; null on near-zero days (< 10 % of the median) so ratios don't explode. */
export function perUnit(rupees: number | null, units: number | null, medianUnits: number): number | null {
  if (rupees == null || !units || units < 0.1 * medianUnits) return null;
  return rupees / units;
}

/** North / South stores: home or cross-zone by the shipping site; East / West stores have no home site (cheaper lane wins); else unmapped. */
export function zoneClass(site: "South" | "North", zone: string | null): "home" | "cross" | "eastwest" | "unmapped" {
  const z = zone?.trim().toUpperCase();
  if (z === "EAST" || z === "WEST") return "eastwest";
  if (z !== "NORTH" && z !== "SOUTH") return "unmapped";
  return z === site.toUpperCase() ? "home" : "cross";
}

/** East / West zone in a month: the cheaper site's lane (₹ per unit) is the ideal; extra = units shipped from the dearer site × the rate gap.
 *  Null when either site has no rate for the zone that month (nothing to compare against). */
export function dearerWh(rate: { North: number | null; South: number | null }, qty: { North: number; South: number }) {
  if (rate.North == null || rate.South == null) return null;
  const dear = rate.North > rate.South ? "North" : "South", cheap = dear === "North" ? "South" : "North";
  return { cheaper: cheap as "North" | "South", units: qty[dear], rupees: qty[dear] * (rate[dear]! - rate[cheap]!) };
}

/** Courier cost the long tail adds over apparel: per courier, Σ long-tail groups' shipments × (their ₹ per shipment − that courier's apparel-only ₹ per
 *  shipment), so courier mix doesn't count. A courier with no apparel-only shipments can't be compared: its long-tail shipments are returned unpriced. */
export function longTailPremium(rows: { courier: string; grp: string; ships: number; cost: number }[], longTail: string[], base = "Apparel only") {
  let rupees = 0, ships = 0, unpriced = 0;
  for (const c of new Set(rows.map((r) => r.courier))) {
    const mine = rows.filter((r) => r.courier === c), b = mine.find((r) => r.grp === base);
    for (const r of mine.filter((x) => longTail.includes(x.grp))) {
      if (!b?.ships) { unpriced += r.ships; continue; }
      rupees += r.cost - (r.ships * b.cost) / b.ships; ships += r.ships;
    }
  }
  return { rupees, ships, unpriced };
}
