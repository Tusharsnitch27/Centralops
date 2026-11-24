import "server-only";
import { q } from "../db";
import { addDays, addMonths, fmtDate, monthStart, today } from "@/lib/dates";
import { inr } from "@/lib/format";
import { activeIpps as activeIppsRaw } from "../wcm/daily";
import { courierOf } from "../wcm/dayCost";
import { passShare } from "../aop/processingMath";
import type { Wh } from "../aop/processingTypes";
import { courierSplit, retimeOrders, scenarioDelta, spans, windowGap, toDayPoints, toMonthPoints, unitShare, type Actuals, type ByMonth } from "./aggregate";
import { unitsPerHead } from "./math";
import { crossZone, rulebookScenario } from "./retail";
import { adhocRows, dailyRows, FN, inwardEvenMonths, inwardFallbackDays, lastOrderDay, memo, pmonth, sharedTeam, SITES } from "./sources";
const activeIpps = memo(activeIppsRaw);
import type { DayRow, FnKey, FnMode, FnSite, FunctionView, GapPart, Point } from "./types";
import { workbookMonthVolumes } from "./workbookHistory";

/**
 * One function's view: last 30 days to yesterday (IST), day on day, or the financial year to date, month on month.
 * Ideal heads per site × month = the month's planned day (average + PEAK_SHARE of the gap to the peak projected day) ÷ units per head (active updated IPPs, as Processing): on the floor in
 * the day view; on roll in the month view (× days in month ÷ working days for weekly offs, × 1.1 absenteeism);
 * actual heads and ₹ are Processing's (attendance split by the rule split; sheet months from the sheet).
 */
const LEGACY_SALARY = 21983;
const mk = (m: string) => m.slice(0, 7);
const fyStart = (d: string) => `${+d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1}-04-01`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-IN");
const sumN = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

/** Norms per site × month: units per head (stages of the function's streams, weighted by Processing's stream volume), salary, Processing's actuals
 *  with the share of the month their ₹ covers, and units (Σ the streams' final output: sheet, else S&OP actual — the month ₹/unit base; null
 *  when any stream lacks it). No salary from Processing → the salary master (wcm_mp_rate) in force at month end, else the legacy default. */
export async function norms(fn: FnKey, months: string[], sites: Wh[]) {
  const f = FN[fn], now = today(), uph: ByMonth = {}, salary: ByMonth = {}, wd: ByMonth = {}, volume: ByMonth = {}, actuals: Actuals = {}, legacy: string[] = [], master: string[] = [], partial: string[] = [];
  const rates = await q<{ site: string; from: string; salary: number }>(`select site, effective_from::text as from, monthly_salary::float8 as salary from wcm_mp_rate order by effective_from`);
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
    if (salary[key] == null) {
      const r = rates.filter((x) => x.site === s && x.from <= addDays(addMonths(m, 1), -1)).at(-1);
      salary[key] = r?.salary ?? LEGACY_SALARY; (r ? master : legacy).push(key);
    }
    wd[key] = pm.streams[0]?.rows[0]?.workingDays ?? 23; // Processing's working days for the month (weekly-off cover in on-roll ideal heads)
    volume[key] = blocks.every((b) => b?.finalOutput != null) ? blocks.reduce((a, b) => a + b!.finalOutput!, 0) : null;
    if (blocks.every((b) => b && b.actualExp != null && b.actualMp != null)) {
      // share of the month the ₹ covers: attendance lines run at Processing's attendance days ÷ days in month, sheet lines the whole month
      // (₹-weighted when mixed). The running month's volume is month to date already, so its ₹ and units cover the same days as they are.
      const att = (r: (typeof rows)[number]) => (r.actualMpSource === "attendance" || r.actualMpSource === "proposed") && pm.actualDays ? pm.actualDays.days / pm.actualDays.of : 1;
      const cost = sumN(blocks.map((b) => b!.actualExp)), full = rows.reduce((a, r) => a + (r.actualExp ?? 0) / att(r), 0);
      actuals[key] = { heads: sumN(blocks.map((b) => b!.actualMp)), cost, share: m === monthStart(now) || !full || cost == null ? 1 : cost / full };
      // a line with neither attendance nor sheet heads drops out of Processing's sum: the month's ₹ is understated, not whole
      for (const r of rows) if (r.actualMp == null) partial.push(`${s}|${mk(m)}|${r.department ?? r.stream}`);
    }
  })));
  return { uph, salary, wd, volume, actuals, legacy, master, partial, masterRates: [...new Set(master.map((k) => salary[k]!))] };
}

type Norms = Awaited<ReturnType<typeof norms>>;
/** Rows (whole months) → chart points for [from, to]. Exported so a scenario (Task 5) can re-run it on re-timed rows. */
export const pointsOf = (mode: FnMode, rows: DayRow[], n: Norms, from: string, to: string): Point[] =>
  mode === "day" ? toDayPoints(rows, n.uph, n.salary, from, to, n.wd) : toMonthPoints(rows, n.uph, n.salary, from, to, n.actuals, n.wd, n.volume);


/** B2C Shopify forward shipments (South + North) priced per courier against that courier's own cost per shipment in the latest completed Jul–Sep (courierSplit). */
async function courierGap(from: string, to: string, site: FnSite) {
  const y = to >= `${to.slice(0, 4)}-10-01` ? +to.slice(0, 4) : +to.slice(0, 4) - 1, jas = [`${y}-07`, `${y}-08`, `${y}-09`];
  const [ships, months] = await Promise.all([
    q<{ day: string; vendor: string; n: number }>(`select day::text as day, substr(metric, 11) as vendor, sum(qty)::float8 as n from aop_channel_volume
       where family = 'logistics' and metric like 'shipments:%' and channel = 'B2C Shopify' and day between $1 and $2 and warehouse = any($3::text[]) group by 1, 2`, [from, to, site === "Both" ? ["South", "North"] : [site]]),
    q<{ courier: string; month: string; cost: number | null; fwd: number | null }>(
      `select courier, month::text as month, sum(cost)::float8 as cost, (sum(awbs) filter (where type = 'FWD'))::float8 as fwd from lg_b2c_month group by 1, 2`),
  ]);
  return courierSplit(ships.map((r) => ({ month: r.day, courier: courierOf(r.vendor) ?? r.vendor, n: r.n })), months, jas);
}

/** The view's window (IST): last 30 days to yesterday (day), or the financial year to yesterday (month); months = every calendar month it
 *  touches (a 30-day window can span two). Shared with the page so By category loads the same months without waiting on functionView. */
export function fnWindow(mode: FnMode) {
  const to = addDays(today(), -1), from = mode === "day" ? addDays(to, -29) : fyStart(to);
  const months: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) months.push(m);
  return { from, to, months };
}

export async function functionView(fn: FnKey, site: FnSite, mode: FnMode): Promise<FunctionView> {
  const f = FN[fn], sites: Wh[] = site === "Both" ? SITES : [site];
  const { from, to, months } = fnWindow(mode);
  const rowsTo = addDays(addMonths(monthStart(to), 1), -1); // whole months: the peak is the month's
  const b2b = fn === "b2b_retail" || fn === "b2b_marketplace";
  const [rows, n, fallback, evenMonths, logistics, retail, lastOrder, [adhoc, notes], team] = await Promise.all([
    dailyRows(fn, monthStart(from), rowsTo, sites), norms(fn, months, sites),
    fn === "inwards" ? inwardFallbackDays(from, to, sites) : Promise.resolve(0),
    fn === "inwards" ? inwardEvenMonths(monthStart(from), to) : Promise.resolve([] as string[]),
    fn === "b2c_shopify" ? courierGap(from, to, site) : Promise.resolve(null),
    fn === "b2b_retail" ? Promise.all([rulebookScenario(site, monthStart(from), rowsTo), crossZone(site, months)]) : Promise.resolve(null),
    fn === "b2b_retail" ? lastOrderDay() : Promise.resolve(null),
    adhocRows(fn, sites, months),
    b2b ? sharedTeam(sites, mode === "day" ? from : addDays(to, -89), to) : Promise.resolve([]), // the month view reads the latest 90 days
  ]);
  const adhocDays: ByMonth = {};
  for (const a of adhoc) adhocDays[`${a.site}|${mk(a.month)}`] = (adhocDays[`${a.site}|${mk(a.month)}`] ?? 0) + a.man_days;
  const points = pointsOf(mode, rows, n, from, to);
  const { gap, left, dropped, segs } = windowGap(mode, rows, n.uph, n.salary, sites, from, to, { actuals: n.actuals, wd: n.wd, heldUp: fn === "inwards", adhoc: adhocDays });
  const win = rows.filter((r) => r.day >= from && r.day <= to);
  let hasWorkbookPlan = false, hasWorkbookOutput = false;
  if (mode === "month") {
    for (const point of points) {
      const history = workbookMonthVolumes(fn, point.key, sites, win);
      if (history.usedProjection) { point.projected = history.projected; hasWorkbookPlan = true; }
      if (history.usedProcessed) { point.processed = history.processed; hasWorkbookOutput = true; }
    }
  }

  const grey: string[] = [];
  if (hasWorkbookPlan || hasWorkbookOutput) grey.push("The monthly chart uses S&OP review totals where daily coverage is missing. Those workbook totals do not provide a daily peak or attendance.");
  if (fn === "b2b_marketplace" || fn === "b2c_returns" || fn === "b2b_returns") grey.push("The projection is the monthly plan spread evenly over the days of the month.");
  if (evenMonths.length) grey.push(`There is no daily inward plan for ${spans(evenMonths.flatMap((m) => sites.map((s) => `${s}|${m}`)), sites)}, so the projection there is the monthly plan spread evenly over the days of the month.`);
  if (fn === "b2c_shopify" || fn === "b2c_marketplace") {
    const first = win.find((r) => r.overlay != null)?.day;
    if (!first) grey.push("There is no SLA tracker data for this period, so Within SLA is blank.");
    else if (win[0]!.day < first) grey.push(`The SLA tracker's data starts on ${fmtDate(first, { year: true })}, so Within SLA is blank before then.`);
  }
  if (fn === "b2c_returns") grey.push("Returns received are packets from the returns app (about 1.05–1.2 units each); processed is units put away.");
  if (fn === "b2b_returns") grey.push("B2B returns have no receiving scan, so received is the putaway.");
  if (fn === "b2b_retail") grey.push("The projection is the rulebook's daily processing plan, store by store.");
  if (fn === "b2b_retail" && win.some((r) => r.received == null && r.day < "2026-09-23")) grey.push("Store orders start on 23 Sep 2026, so received is blank before then.");
  if (fn === "b2b_retail" && (lastOrder == null || lastOrder < to)) grey.push(lastOrder == null ? "No store orders are loaded yet, so received is blank." : `Store orders are loaded only to ${fmtDate(lastOrder, { year: true })}, so received is blank after it.`);
  if (fallback) grey.push(`On ${fallback} site-days the WAM feed has no inward, so received is the PO quantity received, dated by the PO's last update, and issues are unknown.`);
  const noProj = months.flatMap((m) => sites.filter((s) => !rows.some((r) => r.site === s && mk(r.day) === mk(m) && r.projected != null)).map((s) => `${s}|${mk(m)}`));
  if (noProj.length) grey.push(`No daily projection is loaded for ${spans(noProj, sites)}, so ideal heads are blank there.`);
  const noNorm = months.flatMap((m) => sites.filter((s) => !n.uph[`${s}|${mk(m)}`]).map((s) => `${s}|${mk(m)}`)).filter((x) => !noProj.includes(x)); // one line per blank
  if (noNorm.length) grey.push(`There is no productivity norm for ${spans(noNorm, sites)}, so ideal heads are blank there.`);
  if (mode === "day") { const d = new Set(win.filter((r) => r.presentHeads == null).map((r) => r.day)).size; if (d) grey.push(`Attendance is missing on ${d} of the ${new Set(win.map((r) => r.day)).size} days, so actual heads and cost are blank on those days.`); }
  else {
    const m = points.filter((p) => p.actualCost == null).flatMap((p) => sites.map((s) => `${s}|${p.key}`)); if (m.length) grey.push(`There are no actual heads for ${spans(m, sites)}, so cost and ₹ per unit are blank there.`);
    const nv = points.flatMap((p) => sites.filter((s) => n.volume[`${s}|${p.key}`] == null).map((s) => `${s}|${p.key}`)).filter((x) => !m.includes(x)); // ₹ per unit already named blank
    for (const d of [...new Set(n.partial.map((x) => x.split("|")[2]!))]) {
      const ks = [...new Set(n.partial.filter((x) => x.endsWith(`|${d}`)).map((x) => x.split("|").slice(0, 2).join("|")))];
      grey.push(`Actual cost for ${spans(ks, sites)} leaves out ${d} lines with neither attendance nor sheet heads, so it is understated there.`);
    }
    if (nv.length) grey.push(`AOP › Processing has no volume for ${spans(nv, sites)}, so ₹ per unit is blank there.`);
  }
  { const d = new Set(win.filter((r) => r.processed == null).map((r) => r.day)).size; if (d) grey.push(`Daily processed volume is missing for ${d} of the ${new Set(win.map((r) => r.day)).size} days in this period.`); }
  if (fn === "b2b_retail" || fn === "b2b_marketplace") grey.push("Loading, bagging, encoding and dispatch have no scan feed, so they are not counted in processed volume.");
  if (n.master.length) grey.push(`Salary is the salary master's ${n.masterRates.map((r) => `₹${n0(r)}`).join(" / ")} per head where no sheet salary exists (${spans(n.master, sites)}).`);
  if (n.legacy.length) grey.push(`Salary is the legacy ₹${n0(LEGACY_SALARY)} per head where neither a sheet salary nor a salary master rate exists (${spans(n.legacy, sites)}).`);
  if (mode === "month" && months.some((m) => mk(m) === "2026-04")) grey.push("April's first 24 days of attendance come from the site attendance workbooks, which count more heads than the attendance app used from 25 April.");
  grey.push("Absenteeism is an assumed 10 %, not measured. Attrition is not modelled.");
  if (fn !== "inwards") grey.push("Work held up by issues is not recorded for this function.");
  if (left.length || dropped.length) grey.push(`The manpower gap leaves out ${[left.length ? spans(left, sites) : "", dropped.length ? (mode === "day" ? `${dropped.length} days` : spans(dropped.flatMap((k) => sites.map((s) => `${s}|${k}`)), sites)) : ""].filter(Boolean).join(" and ")}, which lack a norm, a projection, attendance or processed volume.`);
  if (fn === "b2c_shopify") {
    grey.push(logistics?.parts ? "Courier cost is as billed, before credit notes." : "No courier has both a rate and a Jul–Sep history for these shipments, so the logistics gap is blank.");
    grey.push("The courier cost file has no channel split, so each courier's rate is its cost per shipment across all its B2C shipments.");
    if (logistics?.unpriced.length) grey.push(`${logistics.unpriced.map((u) => `${n0(u.n)} ${u.courier}`).join(", ")} shipments have no Jul–Sep rate for their courier, so they are not priced.`);
  }

  // summary: plain sentences with numbers
  const where = site === "Both" ? "South and North" : site, done = fn === "inwards" || fn === "b2c_returns" || fn === "b2b_returns" ? "put away" : "dispatched";
  const procDays = [...new Set(win.filter((r) => r.processed != null).map((r) => r.day))];
  const proc = sumN(hasWorkbookOutput ? points.map((p) => p.processed) : win.map((r) => r.processed)), rec = sumN(win.map((r) => r.received)), iss = sumN(win.map((r) => r.issues));
  const summary: string[] = [];
  if (proc != null) {
    if (hasWorkbookOutput) summary.push(`${where} ${done} ${n0(proc)} units across the months with reported volume.`);
    else summary.push(`${where} ${site === "Both" ? "handle" : "handles"} about ${n0(proc / procDays.length)} units a day; received ${rec == null ? "is not known" : n0(rec)}, ${done} ${n0(proc)}${fn === "inwards" && iss != null ? `, ${n0(iss)} issues` : ""}.`);
  }
  const held = gap.find((g) => g.cause === "held_up");
  if (fn === "inwards" && proc != null && held?.rupees) {
    const units = win.filter((r) => (r.issues ?? 0) > 0 && r.processed != null).reduce((a, r) => a + Math.max(0, (r.received ?? 0) - (r.processed ?? 0)), 0);
    if (units > 0) summary.push(`Without the issues putaway would be ${n0(proc + units)}.`);
  }
  const volOf = (key: string) => { const v = sites.map((s) => n.volume[`${s}|${key}`]); return v.every((x) => x != null) ? v.reduce<number>((a, x) => a + x!, 0) : null; };
  const both = points.filter((p) => p.actualCost != null && p.idealCost != null);
  if (both.length) {
    const a = both.reduce((x, p) => x + p.actualCost!, 0), i = both.reduce((x, p) => x + p.idealCost!, 0);
    summary.push(`Manpower cost ${inr(a)} against ${inr(i)} at ideal heads, ${inr(Math.abs(a - i))} ${a >= i ? "more" : "less"}.`);
    // ₹/unit: month on month over Processing's units (as AOP › Processing), day on day over scanned output
    const unitsOf = (p: Point) => (mode === "month" ? volOf(p.key) : p.processed);
    // actual ₹ over the units of the same days (Point.actualUnits); ideal ₹ covers every day, so over the whole volume
    const units = both.filter((p) => unitsOf(p) && p.actualUnits);
    const u = units.reduce((x, p) => x + unitsOf(p)!, 0), au = units.reduce((x, p) => x + p.actualUnits!, 0);
    if (u && au) summary.push(`That is ₹${(units.reduce((x, p) => x + p.actualCost!, 0) / au).toFixed(2)} per unit against ₹${(units.reduce((x, p) => x + p.idealCost!, 0) / u).toFixed(2)} at ideal heads.`);
  }

  // B2B Retail: "Rulebook followed" (store orders on their rulebook days; ideal stays on the plan) and cross-zone freight
  let scenario: FunctionView["scenario"] = null, logisticsGap: GapPart[] | null = fn === "b2c_shopify" ? logistics?.parts ?? null : null;
  if (retail) {
    const [orders, cz] = retail, rb = retimeOrders(orders, monthStart(from), rowsTo);
    const moved = new Map(rb.map((r) => [`${r.site}|${r.day}`, r.received]));
    const retimed = rows.map((r) => ({ ...r, received: moved.get(`${r.site}|${r.day}`) ?? (r.received == null ? null : 0) }));
    // heads needed for the actual orders = ideal maths on the order peak (as placed vs re-timed)
    const asIs = pointsOf(mode, rows.map((r) => ({ ...r, projected: r.received })), n, from, to);
    const reNeed = pointsOf(mode, retimed.map((r) => ({ ...r, projected: r.received })), n, from, to);
    const needed = reNeed.map((p, i) => ({ key: p.key, asIsHeads: asIs[i]!.idealHeads, asIsCost: asIs[i]!.idealCost, heads: p.idealHeads, cost: p.idealCost }));
    const paired = reNeed.map((p, i) => [asIs[i]!, p] as const).filter(([a, b]) => a.idealCost != null && b.idealCost != null);
    // cross-zone ₹ over the same periods: whole paired months (month view), or each month's ₹ shared by the window's processed units (day view)
    const pm = [...new Set(paired.map(([a]) => mk(a.key)))];
    const units = mode === "month" ? (paired.every(([a]) => volOf(a.key) != null) ? sumN(paired.map(([a]) => volOf(a.key))) : null) : sumN(paired.map(([a]) => a.processed));
    const czParts = pm.map((m) => {
      const r = cz.byMonth[`${m}-01`] ?? null;
      if (mode === "month") return r;
      const whole = sumN(rows.filter((x) => mk(x.day) === m).map((x) => x.processed));
      return unitShare(r, whole, sumN(paired.filter(([a]) => mk(a.key) === m).map(([a]) => a.processed)));
    });
    const czNull = pm.filter((_, i) => czParts[i] == null), freightMissing = czNull.length ? spans(czNull.map((m) => `${sites[0]}|${m}`), [sites[0]!]) : null;
    const d = scenarioDelta(paired.map(([a, b]) => ({ asIsCost: a.idealCost!, cost: b.idealCost! })), czParts, units);
    scenario = { points: pointsOf(mode, retimed, n, from, to), needed, ...d, freightMissing };
    logisticsGap = [
      { cause: "cross_zone", rupees: cz.rupees, note: cz.crossUnits == null ? "no LR file for these months" : cz.rupees == null ? `${n0(cz.crossUnits)} units sent to stores in the other warehouse's zone`
        : `${n0(cz.crossUnits)} units sent to stores in the other warehouse's zone cost ₹${n0(Math.abs(cz.rupees))} ${cz.rupees >= 0 ? "more" : "less"} than the home lanes` },
      { cause: "dearer_wh", rupees: cz.eastWest.rupees, note: cz.crossUnits == null ? "no LR file for these months" : cz.eastWest.rupees == null ? "no month has both warehouses' lanes to compare"
        : `${n0(cz.eastWest.units)} units to East / West stores went from the warehouse whose lane cost more that month` },
      { cause: "other", rupees: null, note: "there is no ideal retail freight to set the rest against" },
    ];
    const out = reNeed.filter((p, i) => p.idealCost == null || asIs[i]!.idealCost == null).map((p) => p.key);
    if (!paired.length) grey.push("The rulebook scenario is blank: no period here has store orders with a norm and salary.");
    else if (out.length) grey.push(`The rulebook scenario leaves out ${mode === "day" ? `${out.length} days` : spans(out.flatMap((k) => sites.map((s) => `${s}|${k}`)), sites)} with no store orders, norm or salary.`);
    if (cz.unpriced.length) grey.push(`Cross-zone freight leaves out ${cz.unpriced.join(", ")}, which have no rate in the LR file.`);
    if (cz.unmappedUnits) grey.push(`${n0(cz.unmappedUnits)} units went to stores with no zone (no spine match and no override); they are left out of the freight gap.`);
    if (cz.eastWest.unpriced.length) grey.push(`East / West freight leaves out ${cz.eastWest.unpriced.join(", ")}, where only one warehouse shipped that month.`);
    grey.push("East / West stores have no home warehouse: the ideal is whichever warehouse's lane cost less per unit that month. Warehouse transfers, HQ and marketplace loads are left out.");
    if (freightMissing) grey.push(`The rulebook scenario's freight part and total are blank: there is no cross-zone freight for ${freightMissing}.`);
    const unjudged = orders.filter((o) => o.sla == null && o.day >= from && o.day <= to).reduce((a, o) => a + o.qty, 0);
    if (unjudged) grey.push(`${n0(unjudged)} store-order units have no rulebook placement flag, so the rulebook scenario leaves them on their day and "Ordered in rulebook window" leaves them out.`);
    if (mode === "day" && cz.rupees != null) grey.push("Cross-zone freight in the freight gap covers the whole months shown; the scenario's saving takes the shown days' share by units.");
    const lm = (x: number) => `${inr(Math.abs(x))} ${x >= 0 ? "less" : "more"}`;
    if (d.deltaManpower != null) summary.splice(3, 0, `Staffing sized to the store-order peak would cost ${lm(d.deltaManpower)} if stores ordered on their rulebook days${d.manpowerPerUnit == null ? "" : ` (₹${Math.abs(d.manpowerPerUnit).toFixed(2)} per unit)`}${d.deltaFreight == null ? "" : `; shipping from the home-zone warehouse would cost ${lm(d.deltaFreight)} in freight`}.`);
  }
  // what explains the gap: each ad-hoc task's ₹ against its site-month's gap left after plan and volume (output per head + ad-hoc)
  const seg = new Map(segs.map((x) => [x.key, x.parts]));
  const explainAdhoc = adhoc.map((a) => {
    const key = `${a.site}|${mk(a.month)}`, sal = n.salary[key], parts = seg.get(key);
    const rupees = sal == null ? null : (a.man_days * sal) / 23;
    const left = parts ? (parts.find((p) => p.cause === "below_ipp")?.rupees ?? 0) + (parts.find((p) => p.cause === "adhoc")?.rupees ?? 0) : null;
    // the window holds the whole month only in the month view: share the task's ₹ as the gap does (days of the month in the window)
    const share = mode === "month" ? 1 : rows.filter((r) => r.site === a.site && mk(r.day) === mk(a.month) && r.day >= from && r.day <= to).length / (new Date(Date.UTC(+a.month.slice(0, 4), +a.month.slice(5, 7), 0)).getUTCDate());
    return { month: a.month, site: a.site, task: a.task, dates: a.dates, manDays: a.man_days, rupees, note: a.note,
      covers: rupees == null || left == null || left <= 0 ? null : Math.min(100, (100 * rupees * share) / left) };
  });
  const sharedLine = team.length ? `B2B Forward's present heads follow retail volume (${team.map((t) => `${t.site} r = ${(t.r ?? 0).toFixed(2)}`).join(", ")}) and not marketplace (${team.map((t) => `${t.site} r = ${(t.m ?? 0).toFixed(2)}`).join(", ")}): the same team takes marketplace orders on lighter retail days, so the fixed monthly head split between the two over-counts marketplace on heavy retail days and under-counts it on marketplace days.` : null;
  return { fn, site, mode, points, manpowerGap: gap, logisticsGap, summary: summary.slice(0, 4), grey, scenario, explain: { notes, adhoc: explainAdhoc, sharedTeam: sharedLine } };
}
