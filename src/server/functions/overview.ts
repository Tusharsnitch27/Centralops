import "server-only";
import { q } from "../db";
import { addDays, addMonths, monthStart, today } from "@/lib/dates";
import { daysIn } from "./aggregate";
import { FN } from "./sources";
import { fnWindow } from "./view";
import { dayCells, OVERVIEW_FN, perTxn, poolShare, salaryPerHead, type Cell, type HeadRow, type Site, type StageRow } from "./overviewMath";
import type { FnKey, FnMode, FnSite } from "./types";

/**
 * Functions › Overview: actuals only. Heads = attendance present (mp_daily, day × site × department, each department counted once);
 * transactions = completed events from the stage feed (per function, OVERVIEW_FN); manpower cost = booked payroll (Cost Master → AOP
 * "Monthly Manpower Cost" + "Monthly OT", site × month). Function-level ₹ is not booked anywhere (Processing's ₹ is heads × a sheet / master
 * salary), so it is unavailable here. Window as the detail views (fnWindow: IST, to yesterday). Three light queries; no processingMonth.
 */
export type Key = FnKey | "support" | "total";
export const ROWS: Key[] = [...(Object.keys(OVERVIEW_FN) as FnKey[]), "support", "total"];
const SITES: Site[] = ["South", "North"];
const MP_LINES = ["Monthly Manpower Cost", "Monthly OT"];
const WD = 23; // working days per head per month (Processing's norm): heads on roll = head-days present ÷ 23

export interface Agg {
  heads: number | null;    // average daily heads present over the days every selected site has attendance (a day view: that day's)
  headDays: number | null; // Σ heads present over those days
  txn: number | null;      // Σ completed transactions over the days the feed covered
  units: number | null;    // Σ processed units over the days the feed covered
  days: number;            // days with attendance and the transaction feed for every selected site
  of: number;              // days in the period (through yesterday)
  cost: number | null;     // total row, month: booked manpower + OT for every selected site
  ot: number | null;
  salary: number | null;   // total row, month: booked manpower ÷ heads on roll (head-days ÷ 23); full attendance month only
  perTxn: number | null;   // total row, month: cost ÷ transactions, every day covered; else a dash
}
export interface OverviewData {
  mode: FnMode; site: FnSite; from: string; to: string; mtd: string | null; // the running month ("2026-11") when the window ends inside it
  periods: { key: string; cells: Record<Key, Agg> }[];
  window: Record<Key, Agg>;
  pools: { dept: string; heads: number | null; parts: { fn: FnKey; heads: number | null }[] }[];
  gaps: string[];
}

export async function functionsOverview(site: FnSite, mode: FnMode): Promise<OverviewData> {
  const { from, to, months } = fnWindow(mode), sites = site === "Both" ? SITES : [site as Site];
  const [heads, stage, booked, prov] = await Promise.all([
    q<HeadRow>(`select d.day::text as day, sm.warehouse as site, coalesce(fm.department, d.func) as dept, sum(d.heads)::float8 as heads
       from mp_daily d join mp_site_map sm on sm.site = d.site left join mp_func_map fm on fm.func = d.func
       where d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2, 3`, [from, to, sites]),
    q<StageRow>(`select day::text as day, site, stream, event, source, sum(qty)::float8 as qty from wcm_stage_output
       where day between $1 and $2 and site = any($3::text[]) and event = any($4::text[]) group by 1, 2, 3, 4, 5`,
      [from, to, sites, ["shipments", "dispatched", "putaway_lines", "putaway", "ordered"]]), // ordered: UC items' daily row, B2B Marketplace's coverage
    q<{ site: string; month: string; item: string; actual: number }>(
      `select case when s.name ilike '%north%' then 'North' else 'South' end as site, v.period::text as month, i.name as item, v.actual::float8 as actual
       from aop_items i join aop_sections s on s.id = i.section_id join aop_sections p on p.id = s.parent_id
       join aop_cycles c on c.id = p.cycle_id and c.status = 'active' join aop_period_values v on v.item_id = i.id
       where p.name ilike 'warehous%' and i.name = any($1::text[]) and v.period = any($2::date[]) and v.actual is not null`, [MP_LINES, months]),
    // South Oct 2026's manpower cell holds a provisional figure (seed.wcm_prov_2611: 288 heads × ₹21,983), not payroll
    q<{ value: unknown }>(`select value from app_settings where key = 'seed.wcm_prov_2611'`),
  ]);
  const provisional = (s: Site, m: string) => prov.length > 0 && s === "South" && m === "2026-10-01";
  const book = (s: Site, m: string, item: string) => (provisional(s, m) ? null : booked.find((b) => b.site === s && b.month === m && b.item === item)?.actual ?? null);

  // one cell per site × day (pure: overviewMath.dayCells)
  const hBy = new Map<string, HeadRow[]>(), sBy = new Map<string, StageRow[]>();
  for (const h of heads) hBy.set(`${h.site}|${h.day}`, [...(hBy.get(`${h.site}|${h.day}`) ?? []), h]);
  for (const r of stage) sBy.set(`${r.site}|${r.day}`, [...(sBy.get(`${r.site}|${r.day}`) ?? []), r]);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const cell = new Map<string, Record<Key, Cell>>();
  for (const s of sites) for (const d of days) cell.set(`${s}|${d}`, dayCells(s, hBy.get(`${s}|${d}`) ?? [], sBy.get(`${s}|${d}`) ?? []));
  const at = (s: Site, d: string) => cell.get(`${s}|${d}`)!;

  /** One rule for any set of days: additive metrics summed across sites and days; heads averaged over days every site has attendance;
   *  ratios from summed numerators and denominators. Month cost / salary / ₹ per transaction need every site's booked payroll. */
  const agg = (k: Key, ds: string[], month: string | null): Agg => {
    const full = ds.filter((d) => sites.every((s) => at(s, d)[k].heads != null));
    const headDays = full.length ? full.reduce((a, d) => a + sites.reduce((x, s) => x + at(s, d)[k].heads!, 0), 0) : null;
    const sum = (f: (c: Cell) => number | null) => { const xs = ds.flatMap((d) => sites.map((s) => f(at(s, d)[k]))); return xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null; };
    const covered = ds.filter((d) => sites.every((s) => at(s, d)[k].heads != null && (k === "support" || at(s, d)[k].txn != null))).length;
    const r: Agg = { heads: headDays == null ? null : headDays / full.length, headDays, txn: k === "support" ? null : sum((c) => c.txn), units: sum((c) => c.units),
      days: covered, of: ds.length, cost: null, ot: null, salary: null, perTxn: null };
    if (k === "total" && month) {
      const ms = [...new Set(ds.map((d) => `${d.slice(0, 7)}-01`))];
      const mp = sites.flatMap((s) => ms.map((m) => book(s, m, "Monthly Manpower Cost"))), ot = sites.flatMap((s) => ms.map((m) => book(s, m, "Monthly OT")));
      if (mp.every((x) => x != null)) {
        const bookedMp = mp.reduce((a, x) => a + x!, 0);
        r.ot = ot.reduce<number>((a, x) => a + (x ?? 0), 0); r.cost = bookedMp + r.ot;
        const wholeMonths = ms.every((m) => ds.filter((d) => d.slice(0, 7) === m.slice(0, 7)).length === daysIn(m));
        const sp = wholeMonths && full.length === ds.length ? salaryPerHead(bookedMp, headDays, WD) : null;
        r.salary = sp; // per head per month: head-months = head-days ÷ 23 over all the months, so booked ÷ head-months is already monthly
        r.perTxn = wholeMonths && covered === ds.length ? perTxn(r.cost, r.txn) : null;
      }
    }
    return r;
  };

  const keys = [...new Set(days.map((d) => (mode === "day" ? d : d.slice(0, 7))))];
  const periods = keys.map((key) => {
    const ds = days.filter((d) => (mode === "day" ? d === key : d.slice(0, 7) === key));
    return { key, cells: Object.fromEntries(ROWS.map((k) => [k, agg(k, ds, mode === "month" ? key : null)])) as Record<Key, Agg> };
  });
  const window = Object.fromEntries(ROWS.map((k) => [k, agg(k, days, mode === "month" ? "window" : null)])) as Record<Key, Agg>;

  // shared pools: the department's heads (counted once) and each function's part, which add back to it
  const full = days.filter((d) => sites.every((s) => at(s, d).total.heads != null));
  const deptAvg = (dept: string) => (full.length ? full.reduce((a, d) => a + sites.reduce((x, s) => x + (hBy.get(`${s}|${d}`) ?? []).filter((h) => h.dept === dept).reduce((y, h) => y + h.heads, 0), 0), 0) / full.length : null);
  const pools = ["B2C Forward", "B2B Forward"].map((dept) => ({ dept, heads: deptAvg(dept),
    parts: (Object.keys(OVERVIEW_FN) as FnKey[]).filter((f) => OVERVIEW_FN[f].dept === dept).map((fn) => ({ fn, heads: window[fn].heads })) }));

  const gaps: string[] = [];
  const noBook = months.flatMap((m) => sites.filter((s) => book(s, m, "Monthly Manpower Cost") == null && m < monthStart(today()) && !provisional(s, m)).map((s) => `${s} ${m.slice(0, 7)}`));
  if (noBook.length) gaps.push(`No booked payroll for ${noBook.join(", ")}: cost, salary per head and ₹ per transaction are blank there.`);
  if (months.some((m) => sites.some((s) => provisional(s, m)))) gaps.push("South Oct 2026 manpower in the Cost Master is a provisional 288 heads × ₹21,983, not payroll; it is left out until Manish confirms the booked figure.");
  gaps.push("Payroll is booked per site and month, so cost per function and per day has no actual. The function pages estimate it from attendance × salary.");
  gaps.push("B2C Returns counts completed putaway lines, not QC'd packets: North's returns app stamps QC in bulk (July 2026: 97,505 packets on 4 days), so QC dates do not show when the work was done.");
  gaps.push("Attendance arrives as counts per day and department, with no employee IDs, so a distinct employee count is not available.");
  const last = addDays(addMonths(monthStart(to), 1), -1);
  return { mode, site, from, to, mtd: to < last ? to.slice(0, 7) : null, periods, window, pools, gaps };
}

export const FN_LABEL = (k: Key) => (k === "support" ? "Support (inventory, ops & logistics, admin)" : k === "total" ? "Warehouse total" : FN[k].label);
export { poolShare };
