// Pure aggregation for the AOP Functions view: day rows → chart points (no server imports; scripts/check-functions.mjs runs it).
import { idealHeads, monthStats, perUnit } from "./math.ts";
import type { DayRow, Point } from "./types";

/** Per-month value, site-specific first: keys "South|2026-11" or "2026-11". */
export type ByMonth = Record<string, number | null | undefined>;
export type Actuals = Record<string, { heads: number | null; cost: number | null } | undefined>;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (day: string) => DAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
export const daysIn = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();

/** Rulebook handover slot → the day the warehouse does the work: "<W> 6 PM" → W, "<W> 5 AM" → the day before W. */
export function processingWeekday(tat: string | null): string | null {
  const m = /^(\w+day) (5 AM|6 PM)$/i.exec(tat?.trim() ?? "");
  const i = m ? DAYS.findIndex((d) => d.toLowerCase() === m[1]!.toLowerCase()) : -1;
  if (i < 0) return null;
  return /AM/i.test(m![2]!) ? DAYS[(i + 6) % 7]! : DAYS[i]!;
}

const monthKey = (day: string) => day.slice(0, 7);
const at = (r: number | ByMonth, site: string, month: string) => (typeof r === "number" ? r : r[`${site}|${month}`] ?? r[month] ?? null);
const sumN = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
/** Σ only when every part is known (one site with no norm makes the Both figure missing, not half). */
const sumAll = (xs: (number | null)[]) => (xs.length && xs.every((x) => x != null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };

/** Ideal heads per site × month: the month's literal peak projected day ÷ units per head (floor and on-roll). */
function idealBySiteMonth(rows: DayRow[], uph: ByMonth) {
  const groups = new Map<string, (number | null)[]>();
  for (const r of rows) { const k = `${r.site}|${monthKey(r.day)}`; groups.set(k, [...(groups.get(k) ?? []), r.projected]); }
  const out = new Map<string, { floor: number; roll: number } | null>();
  for (const [k, v] of groups) { const [site, month] = k.split("|") as [string, string]; out.set(k, idealHeads(monthStats(v)?.peak ?? null, at(uph, site, month))); }
  return out;
}

/**
 * Rows → points. Actual ₹ per day = present heads × salary ÷ 23 (Processing's basis); ideal ₹ per day = on-roll ideal × salary ÷ days in
 * the month. Heads: day = present heads that day; month = present per captured day × days in month ÷ 23 (Processing's roster heads).
 * `rows` must cover whole months (the peak is the month's); only days in [from, to] become points.
 */
function toPoints(mode: "day" | "month", rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from = "0000", to = "9999", actuals?: Actuals): Point[] {
  const ideal = idealBySiteMonth(rows, uph);
  const win = rows.filter((r) => r.day >= from && r.day <= to);
  const groups = new Map<string, DayRow[]>();
  for (const r of win) { const k = mode === "day" ? r.day : monthKey(r.day); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const pts = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rs]) => {
    const sites = [...new Set(rs.map((r) => r.site))];
    const month = monthKey(rs[0]!.day), sal = (site: string) => at(salary, site, month);
    const idl = sites.map((s) => ideal.get(`${s}|${month}`) ?? null);
    const fixed = (s: string) => (mode === "month" ? actuals?.[`${s}|${month}`] : undefined);
    const actualCost = sumN(sites.map((s) => fixed(s)?.cost ?? sumN(rs.filter((r) => r.site === s).map((r) => (r.presentHeads == null || sal(s) == null ? null : (r.presentHeads * sal(s)!) / 23)))));
    const idealCost = sumAll(rs.map((r) => { const i = ideal.get(`${r.site}|${month}`), s = sal(r.site); return i && s != null ? (i.roll * s) / daysIn(month) : null; }));
    const actualHeads = mode === "day" ? sumN(rs.map((r) => r.presentHeads)) : sumN(sites.map((s) => {
      const h = rs.filter((r) => r.site === s && r.presentHeads != null);
      return fixed(s)?.heads ?? (h.length ? (h.reduce((a, r) => a + r.presentHeads!, 0) / h.length) * (daysIn(month) / 23) : null);
    }));
    const base = rs.filter((r) => r.overlay != null && (r.overlayBase ?? 0) > 0), baseSum = base.reduce((a, r) => a + r.overlayBase!, 0);
    return {
      key, projected: sumN(rs.map((r) => r.projected)), received: sumN(rs.map((r) => r.received)), processed: sumN(rs.map((r) => r.processed)),
      issues: sumN(rs.map((r) => r.issues)), idealHeads: sumAll(idl.map((i) => i?.floor ?? null)), actualHeads, idealCost, actualCost,
      costPerUnit: null as number | null, idealCostPerUnit: null as number | null,
      overlay: baseSum ? base.reduce((a, r) => a + r.overlay! * r.overlayBase!, 0) / baseSum : null,
    };
  });
  const med = median(pts.map((p) => p.processed).filter((x): x is number => x != null));
  for (const p of pts) { p.costPerUnit = perUnit(p.actualCost, p.processed, med); p.idealCostPerUnit = perUnit(p.idealCost, p.processed, med); }
  return pts;
}

export const toDayPoints = (rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from?: string, to?: string) => toPoints("day", rows, uph, salary, from, to);
/** `actuals` ("South|2026-10" → Processing's heads and ₹ for the month) replace the attendance figure, so months tie to AOP › Processing. */
export const toMonthPoints = (rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from?: string, to?: string, actuals?: Actuals) => toPoints("month", rows, uph, salary, from, to, actuals);
