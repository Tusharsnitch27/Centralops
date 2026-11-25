import "server-only";
import { q } from "../db";
import { addDays, addMonths, monthStart, today } from "@/lib/dates";
import { activeIpps } from "../wcm/daily";
import { passShare } from "../aop/processingMath";
import { unitsPerHead } from "./math";
import { FN, memo } from "./sources";
import { fnWindow } from "./view";
import { dayCells, eventTotal, OVERVIEW_FN, perTxn, poolShare, salaryPerHead, workloadShare, type Cell, type HeadRow, type Site, type StageRow } from "./overviewMath";
import type { FnKey, FnMode, FnSite } from "./types";

/**
 * Functions › Overview. Heads = attendance present (mp_daily, day × site × department, each department counted once); items handled = pieces
 * put away, items dispatched, inventory pieces moved (OVERVIEW_FN). Manpower cost per site-month = booked payroll (Cost Master → AOP "Monthly
 * Manpower Cost" + "Monthly OT") where booked, else the salary calculation (head-days present × salary master ÷ 23, no OT) — marked as calculated.
 * The month's cost is spread over its head-days present (a rate per head-day), so a function's cost = its head-days × the rate, and functions +
 * support add back to the total. ₹ per item = cost ÷ items over the same covered days (attendance and the items feed both in). B2B Forward is split
 * between Retail and Marketplace by each month's workload (items ÷ units per head). Window as the detail views (IST, to yesterday).
 */
export type Key = FnKey | "support" | "total";
export const ROWS: Key[] = [...(Object.keys(OVERVIEW_FN) as FnKey[]), "support", "total"];
const SITES: Site[] = ["South", "North"];
const MP_LINES = ["Monthly Manpower Cost", "Monthly OT"];
const WD = 23; // working days per head per month (Processing's norm): heads on roll = head-days present ÷ 23
const LEGACY_SALARY = 21983;
const ipps = memo(activeIpps);

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
  const firstMonth = months[0]!, lastDay = to;
  const [heads, stage, booked, prov, rates, monthHeads] = await Promise.all([
    q<HeadRow>(`select d.day::text as day, sm.warehouse as site, coalesce(fm.department, d.func) as dept, sum(d.heads)::float8 as heads
       from mp_daily d join mp_site_map sm on sm.site = d.site left join mp_func_map fm on fm.func = d.func
       where d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2, 3`, [from, to, sites]),
    q<StageRow>(`select day::text as day, site, stream, event, source, sum(qty)::float8 as qty from wcm_stage_output
       where day between $1 and $2 and site = any($3::text[]) and event = any($4::text[]) group by 1, 2, 3, 4, 5`,
      [firstMonth, to, sites, ["shipments", "dispatched", "putaway_lines", "putaway", "audit_move", "ordered"]]), // ordered: UC items' daily row, B2B Marketplace's coverage
    q<{ site: string; month: string; item: string; actual: number }>(
      `select case when s.name ilike '%north%' then 'North' else 'South' end as site, v.period::text as month, i.name as item, v.actual::float8 as actual
       from aop_items i join aop_sections s on s.id = i.section_id join aop_sections p on p.id = s.parent_id
       join aop_cycles c on c.id = p.cycle_id and c.status = 'active' join aop_period_values v on v.item_id = i.id
       where p.name ilike 'warehous%' and i.name = any($1::text[]) and v.period = any($2::date[]) and v.actual is not null`, [MP_LINES, months]),
    // South Oct 2026's manpower cell holds a provisional figure (seed.wcm_prov_2611: 288 heads × ₹21,983), not payroll: the salary calculation is used
    q<{ value: unknown }>(`select value from app_settings where key = 'seed.wcm_prov_2611'`),
    q<{ site: string; from: string; salary: number }>(`select site, effective_from::text as from, monthly_salary::float8 as salary from wcm_mp_rate order by effective_from`),
    // whole months' head-days present (the rate's denominator), through yesterday
    q<{ site: string; month: string; hd: number }>(`select sm.warehouse as site, to_char(d.day, 'YYYY-MM') || '-01' as month, sum(d.heads)::float8 as hd
       from mp_daily d join mp_site_map sm on sm.site = d.site where d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2`, [firstMonth, lastDay, sites]),
  ]);
  const provisional = (s: Site, m: string) => prov.length > 0 && s === "South" && m === "2026-10-01";
  const book = (s: Site, m: string, item: string) => (provisional(s, m) ? null : booked.find((b) => b.site === s && b.month === m && b.item === item)?.actual ?? null);
  const salaryOf = (s: Site, m: string) => rates.filter((r) => r.site === s && r.from <= addDays(addMonths(m, 1), -1)).at(-1)?.salary ?? LEGACY_SALARY;
  // ₹ per head-day present for a site-month: booked (manpower + OT) ÷ the month's head-days, else salary ÷ 23 (the salary calculation)
  const monthCost = new Map<string, { basis: "booked" | "calculated" | null; cost: number | null; ot: number | null; mp: number | null; headDays: number | null; rate: number | null }>();
  for (const s of sites) for (const m of months) {
    const hd = monthHeads.find((x) => x.site === s && x.month === m)?.hd ?? null, mp = book(s, m, "Monthly Manpower Cost"), ot = book(s, m, "Monthly OT");
    if (mp != null && hd) monthCost.set(`${s}|${m}`, { basis: "booked", cost: mp + (ot ?? 0), ot, mp, headDays: hd, rate: (mp + (ot ?? 0)) / hd });
    else if (hd) { const r = salaryOf(s, m) / WD; monthCost.set(`${s}|${m}`, { basis: "calculated", cost: hd * r, ot: null, mp: hd * r, headDays: hd, rate: r }); }
    else monthCost.set(`${s}|${m}`, { basis: null, cost: null, ot: null, mp: null, headDays: null, rate: null });
  }
  const mOf = (d: string) => `${d.slice(0, 7)}-01`;

  // B2B Forward split by each month's workload: items dispatched ÷ units per head (IPP stages at month end), per site; fixed weights where unknown
  const sBy = new Map<string, StageRow[]>(), hBy = new Map<string, HeadRow[]>();
  for (const r of stage) sBy.set(`${r.site}|${r.day}`, [...(sBy.get(`${r.site}|${r.day}`) ?? []), r]);
  for (const h of heads) hBy.set(`${h.site}|${h.day}`, [...(hBy.get(`${h.site}|${h.day}`) ?? []), h]);
  const now = today(), b2bShare = new Map<string, Partial<Record<FnKey, number>>>();
  await Promise.all(sites.flatMap((s) => months.map(async (m) => {
    const end = m === monthStart(now) ? addDays(now, -1) : addDays(addMonths(m, 1), -1), ip = await ipps(end, s);
    const uph = (stream: string) => unitsPerHead(ip.filter((p) => p.stream === stream).map((p) => ({ ipp: p.ipp, unit: p.unit, pass: passShare(p.stage) })));
    const items = (stream: string) => { let t: number | null = null; for (let d = m; d <= end && d.slice(0, 7) === m.slice(0, 7); d = addDays(d, 1)) { const v = eventTotal(sBy.get(`${s}|${d}`) ?? [], "dispatched", [stream]); if (v != null) t = (t ?? 0) + v; } return t; };
    const sh = workloadShare([{ items: items("B2B Retail"), uph: uph("B2B Retail") }, { items: items("B2B Marketplace"), uph: uph("B2B Marketplace") }]);
    if (sh) b2bShare.set(`${s}|${m}`, { b2b_retail: sh[0], b2b_marketplace: sh[1] });
  })));

  // one cell per site × day (pure: overviewMath.dayCells)
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const cell = new Map<string, Record<Key, Cell>>();
  for (const s of sites) for (const d of days) cell.set(`${s}|${d}`, dayCells(s, hBy.get(`${s}|${d}`) ?? [], sBy.get(`${s}|${d}`) ?? [], b2bShare.get(`${s}|${mOf(d)}`)));
  const at = (s: Site, d: string) => cell.get(`${s}|${d}`)!;

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
