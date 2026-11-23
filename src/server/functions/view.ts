import "server-only";
import { q } from "../db";
import { addDays, addMonths, monthStart, today } from "@/lib/dates";
import { activeIpps } from "../wcm/daily";
import { courierOf } from "../wcm/dayCost";
import { passShare } from "../aop/processingMath";
import type { Wh } from "../aop/processingTypes";
import { courierSplit, spans, windowGap, toDayPoints, toMonthPoints, unitShare, type Actuals, type ByMonth } from "./aggregate";
import { unitsPerHead } from "./math";
import { crossZone, rulebookScenario } from "./retail";
import { dailyRows, FN, inwardFallbackDays, pmonth, SITES } from "./sources";
import type { DayRow, FnKey, FnMode, FnSite, FunctionView, GapPart, Point } from "./types";

/**
 * One function's view: last 30 days to yesterday (IST), day on day, or the financial year to date, month on month.
 * Ideal heads per site × month = the month's peak projected day ÷ units per head (active updated IPPs, as Processing): on the floor in
 * the day view; on roll in the month view (× days in month ÷ working days for weekly offs, × 1.1 absenteeism);
 * actual heads and ₹ are Processing's (attendance split by the rule split; sheet months from the sheet).
 */
const LEGACY_SALARY = 21983;
const mk = (m: string) => m.slice(0, 7);
const fyStart = (d: string) => `${+d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1}-04-01`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const sumN = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

/** Norms per site × month: units per head (stages of the function's streams, weighted by Processing's stream volume), salary, Processing's actuals. */
export async function norms(fn: FnKey, months: string[], sites: Wh[]) {
  const f = FN[fn], now = today(), uph: ByMonth = {}, salary: ByMonth = {}, wd: ByMonth = {}, actuals: Actuals = {}, legacy: string[] = [];
  await Promise.all(months.flatMap((m) => sites.map(async (s) => {
    const key = `${s}|${mk(m)}`;
    const [pm, ipps] = await Promise.all([pmonth(m, s), activeIpps(m === monthStart(now) ? now : addDays(addMonths(m, 1), -1), s)]); // Processing's IPP day
    const blocks = f.streams.map((st) => pm.streams.find((b) => b.stream === st));
    const per = f.streams.map((st, i) => ({ w: blocks[i]?.finalOutput ?? blocks[i]?.sopProj ?? 0,
      u: unitsPerHead(ipps.filter((p) => p.stream === st).map((p) => ({ ipp: p.ipp, unit: p.unit, pass: passShare(p.stage) }))) }));
    const wTot = per.reduce((a, p) => a + p.w, 0);
    uph[key] = per.some((p) => !p.u) ? null : (wTot || per.length) / per.reduce((a, p) => a + (wTot ? p.w : 1) / p.u!, 0);
    const rows = blocks.flatMap((b) => b?.rows ?? []), paid = rows.filter((r) => r.actualMp && r.avgSalary != null);
    const mp = paid.reduce((a, r) => a + r.actualMp!, 0);
    salary[key] = mp ? paid.reduce((a, r) => a + r.actualMp! * r.avgSalary!, 0) / mp : rows.find((r) => r.avgSalary != null)?.avgSalary ?? null;
    if (salary[key] == null) { salary[key] = LEGACY_SALARY; legacy.push(key); }
    wd[key] = pm.streams[0]?.rows[0]?.workingDays ?? 23; // Processing's working days for the month (weekly-off cover in on-roll ideal heads)
    if (blocks.every((b) => b && b.actualExp != null && b.actualMp != null)) actuals[key] = { heads: sumN(blocks.map((b) => b!.actualMp)), cost: sumN(blocks.map((b) => b!.actualExp)) };
  })));
  return { uph, salary, wd, actuals, legacy };
}

type Norms = Awaited<ReturnType<typeof norms>>;
/** Rows (whole months) → chart points for [from, to]. Exported so a scenario (Task 5) can re-run it on re-timed rows. */
export const pointsOf = (mode: FnMode, rows: DayRow[], n: Norms, from: string, to: string): Point[] =>
  mode === "day" ? toDayPoints(rows, n.uph, n.salary, from, to, n.wd) : toMonthPoints(rows, n.uph, n.salary, from, to, n.actuals, n.wd);


/** B2C Shopify forward shipments (South + North) priced per courier against that courier's own Jul–Sep cost per shipment (courierSplit). */
async function courierGap(from: string, to: string, site: FnSite) {
  const fy = fyStart(to).slice(0, 4), jas = [`${fy}-07`, `${fy}-08`, `${fy}-09`];
  const [ships, months] = await Promise.all([
    q<{ day: string; vendor: string; n: number }>(`select day::text as day, substr(metric, 11) as vendor, sum(qty)::float8 as n from aop_channel_volume
       where family = 'logistics' and metric like 'shipments:%' and channel = 'B2C Shopify' and day between $1 and $2 and warehouse = any($3::text[]) group by 1, 2`, [from, to, site === "Both" ? ["South", "North"] : [site]]),
    q<{ courier: string; month: string; cost: number | null; fwd: number | null }>(
      `select courier, month::text as month, sum(cost)::float8 as cost, (sum(awbs) filter (where type = 'FWD'))::float8 as fwd from lg_b2c_month group by 1, 2`),
  ]);
  return courierSplit(ships.map((r) => ({ month: r.day, courier: courierOf(r.vendor) ?? r.vendor, n: r.n })), months, jas);
}

export async function functionView(fn: FnKey, site: FnSite, mode: FnMode): Promise<FunctionView> {
  const f = FN[fn], sites: Wh[] = site === "Both" ? SITES : [site];
  const to = addDays(today(), -1), from = mode === "day" ? addDays(to, -29) : fyStart(to);
  const rowsTo = addDays(addMonths(monthStart(to), 1), -1); // whole months: the peak is the month's
  const months: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) months.push(m);
  const [rows, n, fallback, logistics, retail] = await Promise.all([
    dailyRows(fn, monthStart(from), rowsTo, sites), norms(fn, months, sites),
    fn === "inwards" ? inwardFallbackDays(from, to, sites) : Promise.resolve(0),
    fn === "b2c_shopify" ? courierGap(from, to, site) : Promise.resolve(null),
    fn === "b2b_retail" ? Promise.all([rulebookScenario(site, monthStart(from), rowsTo), crossZone(site, months)]) : Promise.resolve(null),
  ]);
  const points = pointsOf(mode, rows, n, from, to);
  const { gap, left, dropped } = windowGap(mode, rows, n.uph, n.salary, sites, from, to, { actuals: n.actuals, wd: n.wd, heldUp: fn === "inwards" });
  const win = rows.filter((r) => r.day >= from && r.day <= to);

  const grey: string[] = [];
  if (fn === "b2b_marketplace" || fn === "returns") grey.push("The projection is the monthly plan spread evenly over the days of the month.");
  if (fn === "b2b_retail") grey.push("The projection is the rulebook's daily processing plan, store by store.");
  if (fn === "b2b_retail" && win.some((r) => r.received == null)) grey.push("Store orders start on 23 Sep 2026, so received is blank before then.");
  if (fallback) grey.push(`On ${fallback} site-days the WAM feed has no inward, so received is the PO quantity received, dated by the PO's last update, and issues are unknown.`);
  const noProj = months.flatMap((m) => sites.filter((s) => !rows.some((r) => r.site === s && mk(r.day) === mk(m) && r.projected != null)).map((s) => `${s}|${mk(m)}`));
  if (noProj.length) grey.push(`No projection is loaded for ${spans(noProj, sites)}, so projected volume and ideal heads are blank there.`);
  const noNorm = months.flatMap((m) => sites.filter((s) => !n.uph[`${s}|${mk(m)}`]).map((s) => `${s}|${mk(m)}`));
  if (noNorm.length) grey.push(`There is no productivity norm for ${spans(noNorm, sites)}, so ideal heads are blank there.`);
  if (mode === "day") { const d = new Set(win.filter((r) => r.presentHeads == null).map((r) => r.day)).size; if (d) grey.push(`Attendance is missing on ${d} of the ${new Set(win.map((r) => r.day)).size} days, so actual heads and cost are blank on those days.`); }
  else { const m = points.filter((p) => p.actualCost == null).flatMap((p) => sites.map((s) => `${s}|${p.key}`)); if (m.length) grey.push(`There are no actual heads for ${spans(m, sites)}.`); }
  { const d = new Set(win.filter((r) => r.processed == null).map((r) => r.day)).size; if (d) grey.push(`Processed volume is missing for ${d} of the ${new Set(win.map((r) => r.day)).size} days shown.`); }
  if (fn === "b2b_retail" || fn === "b2b_marketplace") grey.push("Loading, bagging, encoding and dispatch have no scan feed, so they are not counted in processed volume.");
  if (n.legacy.length) grey.push(`Salary is the legacy ₹${n0(LEGACY_SALARY)} per head where no sheet salary exists (${spans(n.legacy, sites)}).`);
  grey.push("Absenteeism is an assumed 10 %, not measured. Attrition is not modelled.");
  if (fn !== "inwards") grey.push("Work held up by issues is not recorded for this function.");
  if (left.length || dropped.length) grey.push(`The manpower gap leaves out ${[left.length ? spans(left, sites) : "", dropped.length ? (mode === "day" ? `${dropped.length} days` : spans(dropped.flatMap((k) => sites.map((s) => `${s}|${k}`)), sites)) : ""].filter(Boolean).join(" and ")}, which lack a norm, a projection, attendance or processed volume.`);
  if (fn === "b2c_shopify") {
    grey.push(logistics?.parts ? "Courier cost is as billed, before credit notes." : "No courier has both a rate and a Jul–Sep history for these shipments, so the logistics gap is blank.");
    grey.push("The courier cost file has no channel split, so each courier's rate is its cost per shipment across all its B2C shipments.");
    if (logistics?.unpriced.length) grey.push(`${logistics.unpriced.map((u) => `${n0(u.n)} ${u.courier}`).join(", ")} shipments have no Jul–Sep rate for their courier, so they are not priced.`);
  }

  // summary: plain sentences with numbers
  const where = site === "Both" ? "South and North" : site, done = fn === "inwards" || fn === "returns" ? "put away" : "dispatched";
  const procDays = [...new Set(win.filter((r) => r.processed != null).map((r) => r.day))];
  const proc = sumN(win.map((r) => r.processed)), rec = sumN(win.map((r) => r.received)), iss = sumN(win.map((r) => r.issues));
  const summary: string[] = [];
  if (proc != null) summary.push(`${where} ${site === "Both" ? "handle" : "handles"} about ${n0(proc / procDays.length)} units a day; received ${rec == null ? "is not known" : n0(rec)}, ${done} ${n0(proc)}${fn === "inwards" && iss != null ? `, ${n0(iss)} issues` : ""}.`);
  const held = gap.find((g) => g.cause === "held_up");
  if (fn === "inwards" && proc != null && held?.rupees) {
    const units = win.filter((r) => (r.issues ?? 0) > 0).reduce((a, r) => a + Math.max(0, (r.received ?? 0) - (r.processed ?? 0)), 0);
    if (units > 0) summary.push(`Without the issues putaway would be ${n0(proc + units)}.`);
  }
  const both = points.filter((p) => p.actualCost != null && p.idealCost != null);
  if (both.length) {
    const a = both.reduce((x, p) => x + p.actualCost!, 0), i = both.reduce((x, p) => x + p.idealCost!, 0);
    summary.push(`Manpower cost ₹${n0(a)} against ₹${n0(i)} at ideal heads, ₹${n0(Math.abs(a - i))} ${a >= i ? "more" : "less"}.`);
    const units = both.filter((p) => p.processed);
    const u = units.reduce((x, p) => x + p.processed!, 0);
    if (u) summary.push(`That is ₹${(units.reduce((x, p) => x + p.actualCost!, 0) / u).toFixed(2)} per unit against ₹${(units.reduce((x, p) => x + p.idealCost!, 0) / u).toFixed(2)} at ideal heads.`);
  }

  // B2B Retail: "Rulebook followed" (store orders on their rulebook days; ideal stays on the plan) and cross-zone freight
  let scenario: FunctionView["scenario"] = null, logisticsGap: GapPart[] | null = fn === "b2c_shopify" ? logistics?.parts ?? null : null;
  if (retail) {
    const [rb, cz] = retail;
    const moved = new Map(rb.days.map((r) => [`${r.site}|${r.day}`, r.received]));
    const retimed = rows.map((r) => ({ ...r, received: moved.get(`${r.site}|${r.day}`) ?? (r.received == null ? null : 0) }));
    // heads needed for the actual orders = ideal maths on the order peak (as placed vs re-timed)
    const asIs = pointsOf(mode, rows.map((r) => ({ ...r, projected: r.received })), n, from, to);
    const reNeed = pointsOf(mode, retimed.map((r) => ({ ...r, projected: r.received })), n, from, to);
    const needed = reNeed.map((p, i) => ({ key: p.key, asIsHeads: asIs[i]!.idealHeads, asIsCost: asIs[i]!.idealCost, heads: p.idealHeads, cost: p.idealCost }));
    const paired = reNeed.map((p, i) => [asIs[i]!, p] as const).filter(([a, b]) => a.idealCost != null && b.idealCost != null);
    const manpower = paired.length ? paired.reduce((x, [a, b]) => x + a.idealCost! - b.idealCost!, 0) : null;
    // cross-zone ₹ over the same periods: whole paired months (month view), or each month's ₹ shared by the window's processed units (day view)
    const pm = [...new Set(paired.map(([a]) => mk(a.key)))], units = sumN(paired.map(([a]) => a.processed));
    const czParts = pm.map((m) => {
      const r = cz.byMonth[`${m}-01`] ?? null;
      if (mode === "month") return r;
      const whole = sumN(rows.filter((x) => mk(x.day) === m).map((x) => x.processed));
      return unitShare(r, whole, sumN(paired.filter(([a]) => mk(a.key) === m).map(([a]) => a.processed)));
    });
    const czNull = pm.filter((_, i) => czParts[i] == null);
    const deltaRupees = manpower == null || czNull.length ? null : manpower + czParts.reduce<number>((a, x) => a + x!, 0);
    scenario = { label: "Rulebook followed", points: pointsOf(mode, retimed, n, from, to), needed, deltaRupees, deltaPerUnit: deltaRupees == null || !units ? null : deltaRupees / units };
    logisticsGap = [
      { cause: "cross_zone", rupees: cz.rupees, note: cz.crossUnits == null ? "no LR file for these months" : cz.rupees == null ? `${n0(cz.crossUnits)} units sent to stores in the other warehouse's zone`
        : `${n0(cz.crossUnits)} units sent to stores in the other warehouse's zone cost ₹${n0(Math.abs(cz.rupees))} ${cz.rupees >= 0 ? "more" : "less"} than the home lanes` },
      { cause: "other", rupees: null, note: "there is no ideal retail freight to set the rest against" },
    ];
    const out = reNeed.filter((p, i) => p.idealCost == null || asIs[i]!.idealCost == null).map((p) => p.key);
    if (!paired.length) grey.push("The rulebook scenario is blank: no period here has store orders with a norm and salary.");
    else if (out.length) grey.push(`The rulebook scenario leaves out ${mode === "day" ? `${out.length} days` : spans(out.flatMap((k) => sites.map((s) => `${s}|${k}`)), sites)} with no store orders, norm or salary.`);
    if (cz.unpriced.length) grey.push(`Cross-zone freight leaves out ${cz.unpriced.join(", ")}, which have no rate in the LR file.`);
    if (cz.unmappedUnits) grey.push(`${n0(cz.unmappedUnits)} units went to stores outside the North and South zones or with no zone; they are neither home nor cross-zone.`);
    if (czNull.length) grey.push(`The rulebook scenario's saving is blank: there is no cross-zone freight for ${spans(czNull.flatMap((m) => sites.map((s) => `${s}|${m}`)), sites)}.`);
    if (mode === "day" && cz.rupees != null) grey.push("Cross-zone freight in the freight gap covers the whole months shown; the scenario's saving takes the shown days' share by units.");
    if (deltaRupees != null) summary.splice(3, 0, `If stores ordered on their rulebook days and were shipped from their home-zone warehouse, cost would be ₹${n0(Math.abs(deltaRupees))} ${deltaRupees >= 0 ? "less" : "more"}${scenario.deltaPerUnit == null ? "" : ` (₹${Math.abs(scenario.deltaPerUnit).toFixed(2)} per unit)`}.`);
  }
  return { fn, site, mode, points, manpowerGap: gap, logisticsGap, summary: summary.slice(0, 4), grey, scenario };
}
