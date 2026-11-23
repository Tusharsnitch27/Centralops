// Pure aggregation for the AOP Functions view: day rows → chart points (no server imports; scripts/check-functions.mjs runs it).
import { idealHeads, manpowerGap, monthStats, perUnit } from "./math.ts";
import type { Cause, DayRow, GapPart, Point } from "./types";

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

/** The day of `orderDate`'s ISO week (Mon–Sun) that falls on `weekday`; an unknown weekday leaves the date as it is. */
export function retimeToWeekday(orderDate: string, weekday: string): string {
  const i = DAYS.findIndex((d) => d.toLowerCase() === weekday.trim().toLowerCase());
  if (i < 0) return orderDate;
  const d = new Date(`${orderDate}T00:00:00Z`), mon = (x: number) => (x + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() + mon(i) - mon(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

/** A month's ₹ shared to part of the month by units: ₹ × window units ÷ month units; null when either is unknown or the month has none. */
export const unitShare = (rupees: number | null, monthUnits: number | null, windowUnits: number | null) =>
  rupees == null || !monthUnits || windowUnits == null ? null : (rupees * windowUnits) / monthUnits;

const monthKey = (day: string) => day.slice(0, 7);
const at = (r: number | ByMonth, site: string, month: string) => (typeof r === "number" ? r : r[`${site}|${month}`] ?? r[month] ?? null);
const sumN = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
/** Σ only when every part is known (one site with no norm makes the Both figure missing, not half). */
const sumAll = (xs: (number | null)[]) => (xs.length && xs.every((x) => x != null) ? xs.reduce<number>((a, x) => a + x!, 0) : null);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };

/**
 * On-roll heads a month needs: the peak day's on-the-floor heads with weekly-off cover (days in month ÷ working days) and the 10 %
 * absenteeism allowance: ⌈ peak ÷ uph × days ÷ wd × 1.1 ⌉ (idealHeads' roll on the scaled peak).
 */
export const onRoll = (peak: number | null, uph: number | null, days: number, wd = 23) => idealHeads(peak == null ? null : (peak * days) / wd, uph)?.roll ?? null;

/** Ideal heads per site × month from the month's literal peak projected day: on the floor (day view) and on roll (month view, ₹). */
function idealBySiteMonth(rows: DayRow[], uph: ByMonth, wd?: ByMonth) {
  const groups = new Map<string, (number | null)[]>();
  for (const r of rows) { const k = `${r.site}|${monthKey(r.day)}`; groups.set(k, [...(groups.get(k) ?? []), r.projected]); }
  const out = new Map<string, { floor: number; roll: number } | null>();
  for (const [k, v] of groups) {
    const [site, month] = k.split("|") as [string, string], peak = monthStats(v)?.peak ?? null, u = at(uph, site, month);
    const floor = idealHeads(peak, u)?.floor, roll = onRoll(peak, u, daysIn(month), (wd && at(wd, site, month)) || 23);
    out.set(k, floor == null || roll == null ? null : { floor, roll });
  }
  return out;
}

/**
 * Rows → points. Actual ₹ per day = present heads × salary ÷ 23 (Processing's basis); ideal ₹ per day = on-roll ideal × salary ÷ days in
 * the month. Heads: day = present heads that day; month = present per captured day × days in month ÷ 23 (Processing's roster heads).
 * `rows` must cover whole months (the peak is the month's); only days in [from, to] become points.
 */
function toPoints(mode: "day" | "month", rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from = "0000", to = "9999", actuals?: Actuals, wd?: ByMonth, keep?: (r: DayRow) => boolean): Point[] {
  const ideal = idealBySiteMonth(rows, uph, wd);
  const win = rows.filter((r) => r.day >= from && r.day <= to && (!keep || keep(r))); // peaks still use every row
  const groups = new Map<string, DayRow[]>();
  for (const r of win) { const k = mode === "day" ? r.day : monthKey(r.day); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const pts = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rs]) => {
    const sites = [...new Set(rs.map((r) => r.site))];
    const month = monthKey(rs[0]!.day), sal = (site: string) => at(salary, site, month);
    const idl = sites.map((s) => ideal.get(`${s}|${month}`) ?? null);
    const fixed = (s: string) => (mode === "month" ? actuals?.[`${s}|${month}`] : undefined);
    // across sites a part missing on either site is missing for Both (never half the cost or volume)
    const bySite = (s: string, v: (r: DayRow) => number | null) => sumN(rs.filter((r) => r.site === s).map(v));
    const actualCost = sumAll(sites.map((s) => fixed(s)?.cost ?? bySite(s, (r) => (r.presentHeads == null || sal(s) == null ? null : (r.presentHeads * sal(s)!) / 23))));
    const idealCost = sumAll(rs.map((r) => { const i = ideal.get(`${r.site}|${month}`), s = sal(r.site); return i && s != null ? (i.roll * s) / daysIn(month) : null; }));
    const actualHeads = mode === "day" ? sumAll(sites.map((s) => bySite(s, (r) => r.presentHeads))) : sumAll(sites.map((s) => {
      const h = rs.filter((r) => r.site === s && r.presentHeads != null);
      return fixed(s)?.heads ?? (h.length ? (h.reduce((a, r) => a + r.presentHeads!, 0) / h.length) * (daysIn(month) / 23) : null);
    }));
    const base = rs.filter((r) => r.overlay != null && (r.overlayBase ?? 0) > 0), baseSum = base.reduce((a, r) => a + r.overlayBase!, 0);
    return {
      key, projected: sumN(rs.map((r) => r.projected)), received: sumN(rs.map((r) => r.received)), processed: sumAll(sites.map((s) => bySite(s, (r) => r.processed))),
      issues: sumN(rs.map((r) => r.issues)), idealHeads: sumAll(idl.map((i) => (i == null ? null : mode === "day" ? i.floor : i.roll))), actualHeads, idealCost, actualCost,
      costPerUnit: null as number | null, idealCostPerUnit: null as number | null,
      overlay: baseSum ? base.reduce((a, r) => a + r.overlay! * r.overlayBase!, 0) / baseSum : null,
    };
  });
  const med = median(pts.map((p) => p.processed).filter((x): x is number => x != null));
  for (const p of pts) { p.costPerUnit = perUnit(p.actualCost, p.processed, med); p.idealCostPerUnit = perUnit(p.idealCost, p.processed, med); }
  return pts;
}

/** Day view: ideal heads on the floor (against present heads); ideal ₹ is the month's on-roll cost per day. */
export const toDayPoints = (rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from?: string, to?: string, wd?: ByMonth) => toPoints("day", rows, uph, salary, from, to, undefined, wd);
/** `actuals` ("South|2026-10" → Processing's heads and ₹ for the month) replace the attendance figure, so months tie to AOP › Processing. */
export const toMonthPoints = (rows: DayRow[], uph: ByMonth, salary: number | ByMonth, from?: string, to?: string, actuals?: Actuals, wd?: ByMonth) => toPoints("month", rows, uph, salary, from, to, actuals, wd);

/**
 * Manpower gap for the window, per site × month segment, summed by cause. Only periods whose chart point has both actual and ideal ₹
 * count (the summary's pairing), so Σ causes = Σ paired (actual − ideal). `dropped` = the points left out; `left` = site-months with no
 * norm, salary, projection or processed volume.
 */
export function windowGap(mode: "day" | "month", rows: DayRow[], uph: ByMonth, salary: number | ByMonth, sites: string[], from: string, to: string,
  o: { actuals?: Actuals; wd?: ByMonth; heldUp?: boolean } = {}) {
  const acts = mode === "month" ? o.actuals : undefined;
  const pts = toPoints(mode, rows, uph, salary, from, to, acts, o.wd);
  const paired = new Set(pts.filter((p) => p.actualCost != null && p.idealCost != null).map((p) => p.key));
  const inWin = (d: string) => d >= from && d <= to, keyOf = (d: string) => (mode === "day" ? d : monthKey(d));
  const parts: GapPart[][] = [], left: string[] = [];
  for (const s of sites) {
    const mine = rows.filter((r) => r.site === s);
    for (const seg of toPoints("month", mine, uph, salary, from, to, acts, o.wd, (r) => paired.has(keyOf(r.day)))) {
      const u = at(uph, s, seg.key), sal = at(salary, s, seg.key);
      const win = mine.filter((r) => monthKey(r.day) === seg.key && inWin(r.day) && paired.has(keyOf(r.day)));
      const proj = monthStats(rows.filter((r) => r.site === s && monthKey(r.day) === seg.key).map((r) => r.projected)), days = win.filter((r) => r.processed != null).length;
      if (!u || !sal || !proj || !days || seg.idealCost == null || seg.actualCost == null || seg.processed == null) { left.push(`${s}|${seg.key}`); continue; }
      const issueDays = win.filter((r) => r.issues != null);
      const held = o.heldUp && issueDays.length ? issueDays.filter((r) => r.issues! > 0).reduce((a, r) => a + Math.max(0, (r.received ?? 0) - (r.processed ?? 0)), 0) : null;
      // head-days at ₹ salary ÷ 23: ideal and actual exactly as the chart costs them
      parts.push(manpowerGap({ salary: sal, uph: u, projAvg: proj.avg, days, processed: seg.processed, heldUpUnits: held,
        actualHeadDays: (seg.actualCost * 23) / sal, idealHeadDays: (seg.idealCost * 23) / sal }));
    }
  }
  const causes = [...new Set(parts.flatMap((p) => p.map((x) => x.cause)))] as Cause[];
  const gap = causes.map((c) => {
    const xs = parts.map((p) => p.find((x) => x.cause === c)!);
    return { cause: c, rupees: sumN(xs.map((x) => x.rupees)), note: (xs.find((x) => x.rupees != null) ?? xs[0]!).note };
  });
  return { gap, left, dropped: pts.filter((p) => !paired.has(p.key)).map((p) => p.key) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const nextMonth = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7);
/** "South|2026-04" keys → one short phrase: "Apr–Sep 2026 (both sites), North Oct 2026" (runs of consecutive months per site set). */
export function spans(keys: string[], sites: string[]) {
  const months = [...new Set(keys.map((k) => monthKey(k.split("|")[1]!)))].sort();
  const who = (m: string) => { const ss = sites.filter((s) => keys.some((k) => k === `${s}|${m}` || k === `${s}|${m}-01`)); return ss.length === sites.length ? (sites.length > 1 ? "both" : "") : ss.join(" and "); };
  const runs: { who: string; from: string; to: string }[] = [];
  for (const m of months) { const w = who(m), last = runs.at(-1); if (last && last.who === w && nextMonth(last.to) === m) last.to = m; else runs.push({ who: w, from: m, to: m }); }
  const range = (a: string, b: string) => (a === b ? monthName(a) : a.slice(0, 4) === b.slice(0, 4) ? `${monthName(a).split(" ")[0]}–${monthName(b)}` : `${monthName(a)}–${monthName(b)}`);
  return runs.map((r) => (r.who === "both" ? `${range(r.from, r.to)} (both sites)` : `${r.who ? `${r.who} ` : ""}${range(r.from, r.to)}`)).join(", ");
}

/**
 * B2C Shopify courier gap, each courier against its own Jul–Sep all-in cost per forward shipment (Σ cost ÷ Σ FWD AWBs over `base` months).
 * Rate on a shipment = the courier's latest month ≤ the shipment's month. Shipments whose courier lacks either are returned as unpriced
 * (named, by count); then `other` is null since part of the cost can't be attributed. No priced shipment → parts null.
 */
export function courierSplit(ships: { month: string; courier: string; n: number }[], months: { courier: string; month: string; cost: number | null; fwd: number | null }[], base: string[]) {
  const ok = months.filter((m) => m.cost != null && m.fwd);
  const baseline = new Map<string, number>();
  for (const c of new Set(ok.map((m) => m.courier))) {
    const b = ok.filter((m) => m.courier === c && base.includes(monthKey(m.month)));
    if (b.length) baseline.set(c, b.reduce((a, m) => a + m.cost!, 0) / b.reduce((a, m) => a + m.fwd!, 0));
  }
  let actual = 0, atBase = 0, rate = 0, priced = 0;
  const unpriced = new Map<string, number>();
  for (const s of ships) {
    const r = ok.filter((m) => m.courier === s.courier && monthKey(m.month) <= monthKey(s.month)).sort((a, b) => a.month.localeCompare(b.month)).at(-1), b = baseline.get(s.courier);
    if (!r || b == null) { unpriced.set(s.courier, (unpriced.get(s.courier) ?? 0) + s.n); continue; }
    const cps = r.cost! / r.fwd!;
    actual += s.n * cps; atBase += s.n * b; rate += s.n * (cps - b); priced += s.n;
  }
  const parts: GapPart[] | null = priced ? [
    { cause: "courier_rate", rupees: rate, note: "courier rates against each courier's own Jul–Sep cost per shipment" },
    { cause: "other", rupees: unpriced.size ? null : actual - atBase - rate, note: unpriced.size ? "couriers without a Jul–Sep rate" : "what the courier rates don't explain" },
  ] : null;
  return { parts, unpriced: [...unpriced].map(([courier, n]) => ({ courier, n })) };
}
