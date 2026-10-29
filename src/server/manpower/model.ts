import "server-only";
import { q } from "../db";
import { isB2BReturn } from "../sop/sync";

export const WHS = ["South", "North"] as const;
export type Wh = (typeof WHS)[number];
/** Same ±20% band as the rest of S&OP: a day below 80% achieved = under-used heads, above 120% = stretched beyond the standard. */
export const ACH_BAND = 0.2;

/**
 * Productivity is measured at the attendance app's function level (its departments), which is coarser than capacity
 * planning's 10 departments: each function rolls up the capacity departments it covers (for plan required) and the S&OP
 * daily actuals it produces (for output). "Support" (Admin / Ops / Logistics) is overhead — heads only, not in achieved %.
 */
export interface Func { name: string; output: string | null; match: ((feed: string, label: string) => boolean) | null; covers: (capDept: string) => boolean }
export const SUPPORT = "Support";
export const FUNCS: Func[] = [
  { name: "Inward", output: "Category inward (putaway)", match: (f) => f === "category_inward", covers: (d) => /inward|put.?away/i.test(d) },
  { name: "B2C Forward", output: "B2C dispatch (Shopify + marketplaces)", match: (f) => f === "b2c", covers: (d) => /forward/i.test(d) && !/b2b/i.test(d) },
  { name: "B2B Forward", output: "B2B marketplace + retail dispatch", match: (f) => f === "b2b_mp" || f === "retail", covers: (d) => /forward/i.test(d) && /b2b/i.test(d) },
  { name: "B2C Return", output: "B2C returns", match: (f, l) => f === "returns" && !isB2BReturn(l), covers: (d) => /return/i.test(d) && !/b2b|store/i.test(d) },
  { name: "B2B Return", output: "B2B / store returns", match: (f, l) => f === "returns" && isB2BReturn(l), covers: (d) => /return/i.test(d) && /b2b|store/i.test(d) },
  { name: "Inventory", output: null, match: null, covers: (d) => /inventory|audit|\bcc\b/i.test(d) },
  { name: SUPPORT, output: null, match: null, covers: () => false },
];
export const FUNC_NAMES = FUNCS.map((f) => f.name);
/** A new name from the attendance app → our function, when it is obvious. */
export function guessFunc(name: string): string | null {
  const n = name.trim().toLowerCase();
  const exact = FUNCS.find((f) => f.name.toLowerCase() === n);
  if (exact) return exact.name;
  if (/^(admin|ops|operations|logistics|security|housekeeping|hr|supervisor)/.test(n)) return SUPPORT;
  return null;
}

export interface MpDay { day: string; heads: number; rate: number | null; cap: number | null; out: number | null; ach: number | null }
export interface MpLine {
  department: string; warehouse: Wh; source: string | null; covers: string[];
  headsAvg: number | null; rateNow: number | null; capDay: number | null; outDay: number | null; ach: number | null; uph: number | null;
  required: number | null; available: number | null; cover: number | null;
  under: number; over: number; judged: number; days: MpDay[];
}
export interface RateRow { department: string; warehouse: Wh; effective_from: string; units_per_head: number; note: string | null; by: string | null }

export const listRates = () => q<RateRow>(
  `select r.department, r.warehouse, r.effective_from::text, r.units_per_head::float8 as units_per_head, r.note, u.name as by
     from mp_rates r left join users u on u.id = r.created_by order by r.department, r.warehouse, r.effective_from`);

const rateOn = (rates: RateRow[], dept: string, wh: Wh, day: string) =>
  rates.filter((r) => r.department === dept && r.warehouse === wh && r.effective_from <= day).at(-1)?.units_per_head ?? null;

const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const monthEnd = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Functions that carry a standard (Support has none). */
export const departments = async () => FUNC_NAMES.filter((n) => n !== SUPPORT);

/** Heads → actual capacity (heads × standard) → output → achieved %, per department × warehouse, daily and for the month so far. */
export async function productivity(period: string) {
  const today = istToday();
  const to = [monthEnd(period), today].sort()[0]!; // today counts as it lands (MTD)
  const [heads, out, plan, rates] = await Promise.all([
    q<{ day: string; department: string; warehouse: Wh; heads: number }>(
      `select d.day::text as day, f.department, s.warehouse, sum(d.heads)::float8 as heads
         from mp_daily d join mp_func_map f on f.func = d.func and f.department is not null
         join mp_site_map s on s.site = d.site and s.warehouse <> 'ignore'
        where d.day between $1 and $2 group by 1,2,3`, [period, to]),
    q<{ day: string; feed: string; label: string; region: string; units: number }>(
      `select day::text as day, feed, label, region, sum(units)::float8 as units from sop_actuals_daily
        where day between $1 and $2 and region in ('south','north') and feed in ('b2c','b2b_mp','retail','category_inward','returns') group by 1,2,3,4`, [period, to]),
    q<{ department: string; warehouse: Wh; required: number | null; available: number | null }>(
      `select department, warehouse, required::float8, available::float8 from sop_capacity where period = $1`, [period]),
    listRates(),
  ]);
  const days: string[] = [];
  for (let t = Date.parse(`${period}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const hasOut = new Set(out.map((o) => o.day));

  const lines: MpLine[] = [];
  for (const wh of WHS) for (const fn of FUNCS) {
    const department = fn.name;
    const rule = fn.match ? { text: fn.output!, match: fn.match } : null;
    // plan required / available = the capacity departments this function covers
    const ps = plan.filter((x) => x.warehouse === wh && fn.covers(x.department));
    const covered = ps.map((x) => x.department);
    const p = ps.length ? { required: ps.some((x) => x.required != null) ? ps.reduce((a, x) => a + (x.required ?? 0), 0) : null, available: ps.some((x) => x.available != null) ? ps.reduce((a, x) => a + (x.available ?? 0), 0) : null } : null;
    const dl: MpDay[] = days.map((day) => {
      const h = heads.filter((x) => x.day === day && x.department === department && x.warehouse === wh).reduce((a, x) => a + x.heads, 0);
      const rate = rateOn(rates, department, wh, day);
      const o = rule && hasOut.has(day) ? out.filter((x) => x.day === day && x.region === wh.toLowerCase() && rule.match(x.feed, x.label)).reduce((a, x) => a + x.units, 0) : null;
      const cap = h > 0 && rate != null ? h * rate : null;
      return { day, heads: h, rate, cap, out: o, ach: cap && o != null ? o / cap : null };
    });
    const worked = dl.filter((d) => d.heads > 0);
    if (!worked.length && !p) continue;
    const judgedDays = dl.filter((d) => d.ach != null);
    const sCap = judgedDays.reduce((a, d) => a + d.cap!, 0), sOut = judgedDays.reduce((a, d) => a + d.out!, 0);
    const outDays = dl.filter((d) => d.out != null && d.heads > 0);
    const capDays = dl.filter((d) => d.cap != null);
    const capDay = capDays.length ? capDays.reduce((a, d) => a + d.cap!, 0) / capDays.length : null;
    lines.push({
      department, warehouse: wh, source: rule?.text ?? (department === SUPPORT ? "overhead — not in achieved %" : null), covers: covered,
      headsAvg: worked.length ? worked.reduce((a, d) => a + d.heads, 0) / worked.length : null,
      rateNow: rateOn(rates, department, wh, to),
      capDay,
      outDay: outDays.length ? outDays.reduce((a, d) => a + d.out!, 0) / outDays.length : null,
      ach: sCap > 0 ? sOut / sCap : null,
      uph: outDays.length ? outDays.reduce((a, d) => a + d.out!, 0) / outDays.reduce((a, d) => a + d.heads, 0) : null,
      required: p?.required ?? null, available: p?.available ?? null,
      cover: capDay != null && p?.required ? capDay / p.required : null,
      under: judgedDays.filter((d) => d.ach! < 1 - ACH_BAND).length, over: judgedDays.filter((d) => d.ach! > 1 + ACH_BAND).length, judged: judgedDays.length,
      days: dl,
    });
  }
  return { lines, from: period, to, hasHeads: heads.length > 0 };
}

export async function mappingState() {
  const [sites, funcs, recent] = await Promise.all([
    q<{ site: string; warehouse: string; days: number; heads: number }>(
      `select m.site, m.warehouse, count(distinct d.day)::int as days, coalesce(sum(d.heads) / nullif(count(distinct d.day),0),0)::float8 as heads
         from mp_site_map m left join mp_daily d on d.site = m.site and d.day > current_date - 31 group by 1,2 order by 1`),
    q<{ func: string; department: string | null; days: number; heads: number }>(
      `select m.func, m.department, count(distinct d.day)::int as days, coalesce(sum(d.heads) / nullif(count(distinct d.day),0),0)::float8 as heads
         from mp_func_map m left join mp_daily d on d.func = m.func and d.day > current_date - 31 group by 1,2 order by (m.department is null) desc, 1`),
    q<{ day: string | null }>(`select max(day)::text as day from mp_daily`),
  ]);
  return { sites, funcs, lastDay: recent[0]?.day ?? null };
}
