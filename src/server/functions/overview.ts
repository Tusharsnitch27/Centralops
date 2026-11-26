import "server-only";
import { addDays, addMonths, monthStart } from "@/lib/dates";
import { FN, slaDaily } from "./sources";
import { costBase, WD, type Key } from "./costBase";
import { fnWindow } from "./view";
import { slaShare } from "./slaMath";
import { OVERVIEW_FN, perTxn, poolShare, salaryPerHead, type Cell, type Site } from "./overviewMath";
import type { FnKey, FnMode, FnSite } from "./types";

/**
 * Functions › Overview. Heads = attendance present (mp_daily, day × site × department, each department counted once); items handled = pieces
 * put away, items dispatched, inventory pieces moved (OVERVIEW_FN). Manpower cost per site-month = booked payroll (Cost Master → AOP "Monthly
 * Manpower Cost" + "Monthly OT") where booked, else the salary calculation (head-days present × salary master ÷ 23, no OT) — marked as calculated.
 * The month's cost is spread over its head-days present (a rate per head-day), so a function's cost = its head-days × the rate, and functions +
 * support add back to the total. ₹ per item = cost ÷ items over the same covered days (attendance and the items feed both in). B2B Forward is split
 * between Retail and Marketplace by each month's workload (items ÷ units per head). Window as the detail views (IST, to yesterday).
 */
export type { Key };
export const ROWS: Key[] = [...(Object.keys(OVERVIEW_FN) as FnKey[]), "support", "total"];
const SITES: Site[] = ["South", "North"];

export type Basis = "booked" | "calculated" | "mixed";
export interface Agg {
  heads: number | null;    // average daily heads present over the days every selected site has attendance (a day view: that day's)
  headDays: number | null; // Σ heads present over those days
  txn: number | null;      // Σ items handled over the days the feed covered
  units: number | null;    // Σ packages / putaway lines over the days the feed covered (secondary)
  days: number;            // covered days: attendance and the items feed in for every selected site
  of: number;              // days in the period (through yesterday)
  cost: number | null;     // manpower cost over the covered days (head-days × the site-month rate); OT in booked months
  basis: Basis | null;     // booked payroll, salary calculation, or both across the period
  salary: number | null;   // total row: monthly cost per head on roll (cost excl. OT ÷ head-days × 23), booked or calculated
  perTxn: number | null;   // ₹ per item: cost ÷ items over the same covered days
  sla?: number | null;     // window only, functions only: on-time % against the function's SLA (slaDaily), null when not measured
}
export interface OverviewData {
  mode: FnMode; site: FnSite; from: string; to: string; mtd: string | null; // the running month ("2026-11") when the window ends inside it
  periods: { key: string; cells: Record<Key, Agg> }[];
  window: Record<Key, Agg>;
  pools: { dept: string; heads: number | null; parts: { fn: FnKey; heads: number | null }[] }[];
  months: { month: string; site: Site; basis: "booked" | "calculated" | null; cost: number | null; ot: number | null; headDays: number | null }[];
  gaps: string[];
}

export async function functionsOverview(site: FnSite, mode: FnMode): Promise<OverviewData> {
  const { from, to, months } = fnWindow(mode), sites = site === "Both" ? SITES : [site as Site];
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const { at, monthCost, hBy, mOf, salaryOf, provisional } = await costBase(sites, from, to, months);

  /** One rule for any set of days: additive metrics summed across sites and days; heads averaged over days every site has attendance; cost and
   *  ₹ per item over the covered days only (heads × the site-month rate); ratios from summed numerators and denominators, never averaged. */
  const agg = (k: Key, ds: string[]): Agg => {
    const full = ds.filter((d) => sites.every((s) => at(s, d)[k].heads != null));
    const headDays = full.length ? full.reduce((a, d) => a + sites.reduce((x, s) => x + at(s, d)[k].heads!, 0), 0) : null;
    const sum = (f: (c: Cell) => number | null) => { const xs = ds.flatMap((d) => sites.map((s) => f(at(s, d)[k]))); return xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null; };
    // a site-day counts when that site has heads, items (the total: every activity) and a cost rate — judged per site, so Both = South + North
    const ok = (s: Site, d: string) => { const c = at(s, d)[k]; return c.heads != null && c.txn != null && (k !== "total" || c.complete === true) && monthCost.get(`${s}|${mOf(d)}`)?.rate != null; };
    const covered = ds.filter((d) => sites.every((s) => ok(s, d)));
    let cost: number | null = null, items: number | null = null; const bases = new Set<string>();
    for (const d of ds) for (const s of sites) {
      if (!ok(s, d)) continue;
      const mc = monthCost.get(`${s}|${mOf(d)}`)!; cost = (cost ?? 0) + at(s, d)[k].heads! * mc.rate!; items = (items ?? 0) + at(s, d)[k].txn!; bases.add(mc.basis!);
    }
    const basis: Basis | null = !bases.size ? null : bases.size > 1 ? "mixed" : ([...bases][0] as Basis);
    // salary per head on roll (total row): manpower excl. OT over the covered days ÷ (head-days ÷ 23)
    let mpCost: number | null = null, hdCov: number | null = null;
    if (k === "total") for (const d of ds) for (const s of sites) { if (!ok(s, d)) continue; const mc = monthCost.get(`${s}|${mOf(d)}`)!; const h = at(s, d).total.heads!;
      mpCost = (mpCost ?? 0) + h * (mc.mp! / mc.headDays!); hdCov = (hdCov ?? 0) + h; }
    return { heads: headDays == null ? null : headDays / full.length, headDays, txn: sum((c) => c.txn), units: sum((c) => c.units), days: covered.length, of: ds.length,
      cost, basis, salary: k === "total" ? salaryPerHead(mpCost, hdCov, WD) : null, perTxn: perTxn(cost, items) };
  };

  const keys = [...new Set(days.map((d) => (mode === "day" ? d : d.slice(0, 7))))];
  const periods = keys.map((key) => {
    const ds = days.filter((d) => (mode === "day" ? d === key : d.slice(0, 7) === key));
    return { key, cells: Object.fromEntries(ROWS.map((k) => [k, agg(k, ds)])) as Record<Key, Agg> };
  });
  const window = Object.fromEntries(ROWS.map((k) => [k, agg(k, days)])) as Record<Key, Agg>;
  // each function's SLA over the window (same rule and sources as its page)
  const fns = Object.keys(OVERVIEW_FN) as FnKey[];
  const slas = await Promise.all(fns.map((f) => slaDaily(f, sites, from, to).catch(() => [])));
  fns.forEach((f, i) => { window[f].sla = slaShare(slas[i]!).pct; });

  // shared pools: the department's heads (counted once) and each function's part, which add back to it
  const full = days.filter((d) => sites.every((s) => at(s, d).total.heads != null));
  const deptAvg = (dept: string) => (full.length ? full.reduce((a, d) => a + sites.reduce((x, s) => x + (hBy.get(`${s}|${d}`) ?? []).filter((h) => h.dept === dept).reduce((y, h) => y + h.heads, 0), 0), 0) / full.length : null);
  const pools = ["B2C Forward", "B2B Forward"].map((dept) => ({ dept, heads: deptAvg(dept),
    parts: (Object.keys(OVERVIEW_FN) as FnKey[]).filter((f) => OVERVIEW_FN[f].dept === dept).map((fn) => ({ fn, heads: window[fn].heads })) }));

  const monthRows = months.flatMap((m) => sites.map((s) => { const mc = monthCost.get(`${s}|${m}`)!; return { month: m, site: s, basis: mc.basis, cost: mc.cost, ot: mc.ot, headDays: mc.headDays }; }));
  const calc = monthRows.filter((r) => r.basis === "calculated").map((r) => `${r.site} ${r.month.slice(0, 7)}`);
  const gaps: string[] = [];
  if (calc.length) gaps.push(`Payroll is not booked for ${calc.join(", ")}: cost there is the salary calculation (head-days present × the salary master, ₹${Math.round(salaryOf(sites[0]!, months.at(-1)!)).toLocaleString("en-IN")} a month, ÷ 23), without OT.`);
  if (months.some((m) => sites.some((s) => provisional(s, m)))) gaps.push("South Oct 2026's Cost Master manpower is a provisional 288 heads × ₹21,983, not payroll, so October uses the salary calculation there.");
  gaps.push("Payroll is booked per site and month: a function's cost is its share of the site's head-days at the month's rate per head-day, and a day's cost is its head-days at that rate.");
  gaps.push("B2B Forward's heads are split between Retail and Marketplace by each month's workload (items dispatched ÷ units per head); B2C Forward keeps AOP's channel weights.");
  gaps.push("Attendance arrives as counts per day and department, with no employee IDs, so a distinct employee count is not available.");
  const last = addDays(addMonths(monthStart(to), 1), -1);
  return { mode, site, from, to, mtd: to < last ? to.slice(0, 7) : null, periods, window, pools, months: monthRows, gaps };
}

export const FN_LABEL = (k: Key) => (k === "support" ? "Support (inventory, ops & logistics, admin)" : k === "total" ? "Warehouse total" : FN[k].label);
export { poolShare };
