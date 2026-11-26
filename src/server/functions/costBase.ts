import "server-only";
import { q } from "../db";
import { addDays, addMonths, monthStart, today } from "@/lib/dates";
import { activeIpps } from "../wcm/daily";
import { passShare } from "../aop/processingMath";
import { unitsPerHead } from "./math";
import { memo } from "./sources";
import { dayCells, eventTotal, workloadShare, type Cell, type HeadRow, type Site, type StageRow } from "./overviewMath";
import type { FnKey } from "./types";

const MP_LINES = ["Monthly Manpower Cost", "Monthly OT"];
export const WD = 23; // working days per head per month (Processing's norm): heads on roll = head-days present ÷ 23
export const LEGACY_SALARY = 21983;
const ipps = memo(activeIpps);
export type Key = FnKey | "support" | "total";
export type MonthCost = { basis: "booked" | "calculated" | null; cost: number | null; ot: number | null; mp: number | null; headDays: number | null; rate: number | null };

/**
 * The one manpower cost structure (Overview and every function page, Malhar M, 26 Nov 2026). Heads = attendance present per site × day ×
 * department (mp_daily), split to functions by dayCells (B2C Forward by AOP's channel weights, B2B Forward by each month's workload). ₹ per
 * head-day present for a site-month = booked payroll (Cost Master → AOP "Monthly Manpower Cost" + "Monthly OT") ÷ the month's head-days, else
 * the salary calculation (salary master ÷ 23, no OT). A function's cost = its head-days × that rate, so functions + support add to the total.
 */
export async function costBase(sites: Site[], from: string, to: string, months: string[]) {
  const firstMonth = months[0]!;
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
    // whole months' head-days present (the rate's denominator), through `to`
    q<{ site: string; month: string; hd: number }>(`select sm.warehouse as site, to_char(d.day, 'YYYY-MM') || '-01' as month, sum(d.heads)::float8 as hd
       from mp_daily d join mp_site_map sm on sm.site = d.site where d.day between $1 and $2 and sm.warehouse = any($3::text[]) group by 1, 2`, [firstMonth, to, sites]),
  ]);
  const provisional = (s: Site, m: string) => prov.length > 0 && s === "South" && m === "2026-10-01";
  const book = (s: Site, m: string, item: string) => (provisional(s, m) ? null : booked.find((b) => b.site === s && b.month === m && b.item === item)?.actual ?? null);
  const salaryOf = (s: Site, m: string) => rates.filter((r) => r.site === s && r.from <= addDays(addMonths(m, 1), -1)).at(-1)?.salary ?? LEGACY_SALARY;
  const monthCost = new Map<string, MonthCost>();
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
  const cell = new Map<string, Record<Key, Cell>>();
  for (const s of sites) for (let d = from; d <= to; d = addDays(d, 1)) cell.set(`${s}|${d}`, dayCells(s, hBy.get(`${s}|${d}`) ?? [], sBy.get(`${s}|${d}`) ?? [], b2bShare.get(`${s}|${mOf(d)}`)));
  const at = (s: Site, d: string) => cell.get(`${s}|${d}`)!;
  /** A function's (or row's) costed heads that site-day: heads with its items and a rate known — the Overview's covered-day rule. */
  const costedHeads = (k: Key, s: Site, d: string) => {
    const c = cell.get(`${s}|${d}`)?.[k];
    return c && c.heads != null && c.txn != null && (k !== "total" || c.complete === true) && monthCost.get(`${s}|${mOf(d)}`)?.rate != null ? c.heads : null;
  };
  return { at, costedHeads, monthCost, hBy, mOf, salaryOf, provisional };
}
