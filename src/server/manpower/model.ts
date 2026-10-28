import "server-only";
import { q } from "../db";
import { isB2BReturn } from "../sop/sync";
import { sortDepts } from "../sop/queries";

export const WHS = ["South", "North"] as const;
export type Wh = (typeof WHS)[number];
/** Same ±20% band as the rest of S&OP: a day below 80% achieved = under-used heads, above 120% = stretched beyond the standard. */
export const ACH_BAND = 0.2;

/**
 * Which S&OP daily actuals count as a department's output (units). Matched on the department name so a renamed / new
 * department still lands somewhere sensible; departments with no feed (e.g. Inventory / Audit / CC) show heads only.
 */
export function outputRule(dept: string): { text: string; match: (feed: string, label: string) => boolean } | null {
  const d = dept.toLowerCase();
  const shop = (l: string) => /shopify|website|d2c|own/i.test(l);
  const store = (l: string) => /store|retail|sor/i.test(l);
  if (d.includes("return")) {
    if (/b2b|store/.test(d)) {
      if (/store|retail/.test(d)) return { text: "Returns · store / retail", match: (f, l) => f === "returns" && isB2BReturn(l) && store(l) };
      return { text: "Returns · marketplace B2B", match: (f, l) => f === "returns" && isB2BReturn(l) && !store(l) };
    }
    if (d.includes("shopify")) return { text: "Returns · Shopify (B2C)", match: (f, l) => f === "returns" && !isB2BReturn(l) && shop(l) };
    return { text: "Returns · marketplace (B2C)", match: (f, l) => f === "returns" && !isB2BReturn(l) && !shop(l) };
  }
  if (d.includes("inward") || d.includes("put")) return { text: "Category inward (putaway)", match: (f) => f === "category_inward" };
  if (d.includes("forward") || d.includes("dispatch") || d.includes("outward")) {
    if (d.includes("b2b") && d.includes("retail")) return { text: "Retail dispatch", match: (f) => f === "retail" };
    if (d.includes("b2b")) return { text: "B2B marketplace dispatch", match: (f) => f === "b2b_mp" };
    if (d.includes("shopify")) return { text: "B2C dispatch · Shopify", match: (f, l) => f === "b2c" && /shopify/i.test(l) };
    return { text: "B2C dispatch · marketplaces", match: (f, l) => f === "b2c" && !/shopify/i.test(l) };
  }
  return null;
}

export interface MpDay { day: string; heads: number; rate: number | null; cap: number | null; out: number | null; ach: number | null }
export interface MpLine {
  department: string; warehouse: Wh; source: string | null;
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

export async function departments() {
  const rows = await q<{ department: string }>(`select distinct department from sop_capacity union select distinct department from mp_func_map where department is not null`);
  return sortDepts(rows.map((r) => r.department));
}

/** Heads → actual capacity (heads × standard) → output → achieved %, per department × warehouse, daily and for the month so far. */
export async function productivity(period: string) {
  const today = istToday();
  const to = [monthEnd(period), today].sort()[0]!; // today counts as it lands (MTD)
  const [heads, out, plan, rates, depts] = await Promise.all([
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
    departments(),
  ]);
  const days: string[] = [];
  for (let t = Date.parse(`${period}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const hasOut = new Set(out.map((o) => o.day));

  const lines: MpLine[] = [];
  for (const wh of WHS) for (const department of depts) {
    const rule = outputRule(department);
    const p = plan.find((x) => x.department === department && x.warehouse === wh);
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
      department, warehouse: wh, source: rule?.text ?? null,
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
