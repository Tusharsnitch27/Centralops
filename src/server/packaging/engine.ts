import "server-only";
import { one, q, type RunQ } from "../db";
import { sfQuery } from "../snowflake";
import { today } from "@/lib/dates";
import { AOP_LINES, aopLineOf, normType, rateOn, type AopLine, type RateRow } from "./model";

/**
 * AOP · Packaging.
 *  - before Sep 2026: month totals from "pakcaging month on month.xlsx" (pkg_monthly, source 'file')
 *  - from Sep 2026: packages dispatched per day × package type × marketplace from Snowflake (pkg_usage_daily), priced with the
 *    rate in force on that day (pkg_rates, effective-dated) → live month progress against the AOP plan
 *  - month end: the month is frozen into pkg_monthly (with year) and written as the AOP actual of the Packaging lines
 */
export const PKG_FROM = "2026-09-01";
const SOURCE = "snitch_db.maplemonk.warehouse_sla_performance";
export const PKG_QUERY = (from: string) => `SELECT TO_VARCHAR(TRY_TO_DATE(LEFT(TO_VARCHAR(dispatch_date), 10)), 'YYYY-MM-DD') AS day,
  UPPER(TRIM(COALESCE(shipping_package_type, 'DEFAULT'))) AS package_type, UPPER(TRIM(COALESCE(marketplace_mapped, 'UNKNOWN'))) AS marketplace,
  COUNT(DISTINCT shippingpackagecode) AS packages
FROM ${SOURCE}
WHERE dispatched_timestamp IS NOT NULL AND TRY_TO_DATE(LEFT(TO_VARCHAR(dispatch_date), 10)) >= '${from}'
GROUP BY 1, 2, 3`;

const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
export const loadRates = () => q<RateRow>(`select package_type, effective_from::text, rate::float8 as rate from pkg_rates order by package_type, effective_from`);

/** Pull from Snowflake: every open month from Sep 2026 is re-read in full; closed months are never touched. */
export async function pullPackaging(): Promise<{ read: number; written: number; note: string }> {
  const closed = (await q<{ p: string }>(`select period::text as p from pkg_months where status = 'closed' and period >= $1`, [PKG_FROM])).map((r) => r.p);
  let from = PKG_FROM;
  while (closed.includes(monthOf(from))) { const d = new Date(`${from}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); from = d.toISOString().slice(0, 10); }
  const rows = await sfQuery<{ day: string | null; package_type: string; marketplace: string; packages: number }>(PKG_QUERY(from));
  const ok = rows.filter((r) => r.day);
  // the source keeps ~60 days: replace only from the first day it returned, so days that aged out of it are kept
  const first = ok.reduce((m, r) => (r.day! < m ? r.day! : m), "9999-12-31");
  if (ok.length) await q(`delete from pkg_usage_daily where day >= $1`, [first > from ? first : from]);
  for (let i = 0; i < ok.length; i += 1000) {
    const c = ok.slice(i, i + 1000);
    await q(`insert into pkg_usage_daily (day, marketplace, package_type, packages)
             select d::date, m, t, n from unnest($1::text[], $2::text[], $3::text[], $4::numeric[]) as x(d, m, t, n)
             on conflict (day, marketplace, package_type) do update set packages = excluded.packages`,
      [c.map((r) => r.day), c.map((r) => r.marketplace), c.map((r) => normType(r.package_type)), c.map((r) => Number(r.packages) || 0)]);
  }
  for (const p of [...new Set(ok.map((r) => monthOf(r.day!)))])
    await q(`insert into pkg_months (period, status, source) values ($1,'open','snowflake') on conflict (period) do nothing`, [p]);
  const closedNow = await closePastMonths();
  const rates = await loadRates();
  const unpriced = [...new Set(ok.map((r) => normType(r.package_type)).filter((t) => rateOn(rates, t, r0(ok, t)) == null))];
  return { read: rows.length, written: ok.length, note: [`from ${from}`, closedNow.length ? `closed ${closedNow.join(", ")}` : "", unpriced.length ? `no rate yet: ${unpriced.join(", ")}` : ""].filter(Boolean).join(" · ") };
}
const r0 = (rows: { day: string | null; package_type: string }[], t: string) => rows.find((r) => normType(r.package_type) === t)?.day ?? today();

/** Month figures from the daily counts, each day priced at that day's rate. */
async function liveMonth(period: string) {
  const [rows, rates] = await Promise.all([
    q<{ day: string; marketplace: string; package_type: string; packages: number }>(
      `select day::text, marketplace, package_type, packages::float8 as packages from pkg_usage_daily where date_trunc('month', day)::date = $1::date order by day`, [period]),
    loadRates(),
  ]);
  return rows.map((r) => { const rate = rateOn(rates, r.package_type, r.day); return { ...r, line: aopLineOf(r.marketplace), rate, amount: rate == null ? 0 : r.packages * rate }; });
}

/** Freeze every open month that has ended. */
export async function closePastMonths(actorId: string | null = null) {
  const cur = monthOf(today());
  const open = (await q<{ p: string }>(`select period::text as p from pkg_months where status = 'open' and period < $1 order by period`, [cur])).map((r) => r.p);
  for (const p of open) await closeMonth(p, actorId);
  return open.map((p) => p.slice(0, 7));
}

export async function closeMonth(period: string, actorId: string | null = null) {
  const live = await liveMonth(period);
  const agg = new Map<string, { marketplace: string; package_type: string; line: AopLine; qty: number; amount: number }>();
  for (const r of live) {
    const k = `${r.marketplace}|${r.package_type}`;
    const a = agg.get(k) ?? { marketplace: r.marketplace, package_type: r.package_type, line: r.line, qty: 0, amount: 0 };
    a.qty += r.packages; a.amount += r.amount; agg.set(k, a);
  }
  await q(`delete from pkg_monthly where period = $1 and source = 'snowflake'`, [period]);
  for (const a of agg.values())
    await q(`insert into pkg_monthly (period, marketplace, package_type, aop_line, qty, rate, amount, source) values ($1,$2,$3,$4,$5,$6,$7,'snowflake')
             on conflict (period, marketplace, package_type) do update set aop_line = excluded.aop_line, qty = excluded.qty, rate = excluded.rate, amount = excluded.amount, source = 'snowflake'`,
      [period, a.marketplace, a.package_type, a.line, a.qty, a.qty ? Math.round((a.amount / a.qty) * 10000) / 10000 : null, Math.round(a.amount * 100) / 100]);
  await q(`insert into pkg_months (period, status, source, closed_at) values ($1,'closed','snowflake',now())
           on conflict (period) do update set status = 'closed', closed_at = now()`, [period]);
  await writeAopActuals(q as RunQ, period, actorId);
}

/** Month totals per AOP line → actual of the Packaging lines in the AOP cycle covering that month. */
export async function writeAopActuals(run: RunQ, period: string, actorId: string | null) {
  const totals = await run<{ aop_line: string; amount: number }>(`select aop_line, sum(amount)::float8 as amount from pkg_monthly where period = $1 group by aop_line`, [period]);
  if (!totals.length) return 0;
  const items = await run<{ id: string; name: string }>(
    `with recursive pk(id) as (select s.id from aop_sections s join aop_cycles c on c.id = s.cycle_id
                                 where lower(s.name) = 'packaging' and $1::date >= c.fy_start and $1::date < (c.fy_start + make_interval(months => c.months))
                               union all select s.id from aop_sections s join pk on s.parent_id = pk.id)
     select i.id, i.name from aop_items i where i.section_id in (select id from pk)`, [period]);
  // the Warehouse Cost Master's packaging invoice is the control (11.4): a month it already books is never overwritten by this driver
  const booked = new Set((await run<{ head: string }>(
    `select lower(head) as head from wcm_source_line where snapshot_id = (select value #>> '{}' from app_settings where key = 'wcm.snapshot')
       and family = 'packaging' and basis = 'actual' and period = $1 and amount is not null`, [period])).map((r) => r.head));
  let n = 0;
  for (const line of AOP_LINES) {
    const it = items.find((i) => i.name.trim().toLowerCase() === line.toLowerCase());
    if (!it || booked.has(line.toLowerCase())) continue;
    const v = Math.round((totals.find((t) => t.aop_line === line)?.amount ?? 0) * 100) / 100;
    const old = (await run<{ actual: number | null }>(`select actual::float8 as actual from aop_period_values where item_id = $1 and period = $2`, [it.id, period]))[0]?.actual ?? null;
    if (old != null && Math.abs(old - v) < 0.005) continue;
    await run(`insert into aop_period_values (item_id, period, actual, updated_by, updated_at) values ($1,$2,$3,$4,now())
               on conflict (item_id, period) do update set actual = excluded.actual, updated_by = excluded.updated_by, updated_at = now()`, [it.id, period, v, actorId]);
    await run(`insert into aop_updates (item_id, period, field, old_value, new_value, author_id) values ($1,$2,'actual',$3,$4,$5)`,
      [it.id, period, old == null ? null : String(old), String(v), actorId]);
    n++;
  }
  await run(`update pkg_months set aop_written_at = now() where period = $1`, [period]);
  return n;
}

/* ---------------- views ---------------- */

async function aopPlans() {
  return q<{ period: string; line: string; plan: number | null; actual: number | null }>(
    `with recursive pk(id) as (select id from aop_sections where lower(name) = 'packaging' union all select s.id from aop_sections s join pk on s.parent_id = pk.id)
     select v.period::text as period, i.name as line, v.plan::float8 as plan, v.actual::float8 as actual
     from aop_items i join aop_period_values v on v.item_id = i.id where i.section_id in (select id from pk)`);
}

export async function packagingMonths() {
  return q<{ period: string; status: string; source: string; closed_at: string | null; aop_written_at: string | null }>(
    `select period::text, status, source, closed_at::text, aop_written_at::text from pkg_months order by period desc`);
}

/** One month: per AOP line plan vs actual (MTD + projection while open), day by day, and by package type. */
export async function packagingMonth(period: string) {
  const [m, plans, frozen] = await Promise.all([
    one<{ status: string; source: string; closed_at: string | null; aop_written_at: string | null }>(`select status, source, closed_at::text, aop_written_at::text from pkg_months where period = $1`, [period]),
    aopPlans(),
    q<{ marketplace: string; package_type: string; aop_line: AopLine; qty: number; rate: number | null; amount: number; source: string }>(
      `select marketplace, package_type, aop_line, qty::float8 as qty, rate::float8 as rate, amount::float8 as amount, source from pkg_monthly where period = $1`, [period]),
  ]);
  const closed = m?.status === "closed" || (frozen.length > 0 && !m);
  const live = closed ? [] : await liveMonth(period);
  const n = daysIn(period);
  const lastDay = live.length ? Number(live.at(-1)!.day.slice(8)) : closed ? n : 0;
  const plan = (line: string) => plans.find((p) => p.period === period && p.line.toLowerCase() === line.toLowerCase())?.plan ?? null;
  const lines = AOP_LINES.map((line) => {
    const actual = closed ? frozen.filter((f) => f.aop_line === line).reduce((a, f) => a + f.amount, 0) : live.filter((r) => r.line === line).reduce((a, r) => a + r.amount, 0);
    const qty = closed ? frozen.filter((f) => f.aop_line === line).reduce((a, f) => a + f.qty, 0) : live.filter((r) => r.line === line).reduce((a, r) => a + r.packages, 0);
    const p = plan(line);
    const projected = closed || !lastDay ? actual : (actual / lastDay) * n;
    const planToDate = p == null ? null : closed ? p : (p * lastDay) / n;
    return { line, plan: p, planToDate, actual, qty, projected };
  });
  // day by day (open months)
  const days = Array.from({ length: n }, (_, i) => `${period.slice(0, 8)}${String(i + 1).padStart(2, "0")}`).map((d) => {
    const r = live.filter((x) => x.day === d);
    return { day: d, packages: r.reduce((a, x) => a + x.packages, 0), amount: r.reduce((a, x) => a + x.amount, 0), byLine: Object.fromEntries(AOP_LINES.map((l) => [l, r.filter((x) => x.line === l).reduce((a, x) => a + x.amount, 0)])) as Record<AopLine, number> };
  });
  // by package type
  const types = new Map<string, { package_type: string; lines: Set<string>; qty: number; amount: number; rate: number | null; unpriced: number }>();
  for (const r of closed ? frozen.map((f) => ({ package_type: f.package_type, line: f.aop_line, packages: f.qty, amount: f.amount, rate: f.rate })) : live)
    { const t = types.get(r.package_type) ?? { package_type: r.package_type, lines: new Set<string>(), qty: 0, amount: 0, rate: r.rate, unpriced: 0 };
      t.lines.add(r.line); t.qty += r.packages; t.amount += r.amount; if (r.rate == null) t.unpriced += r.packages; t.rate = r.rate ?? t.rate; types.set(r.package_type, t); }
  return {
    period, status: closed ? "closed" : live.length ? "open" : "empty", source: m?.source ?? (frozen[0]?.source ?? null), closedAt: m?.closed_at ?? null, aopWrittenAt: m?.aop_written_at ?? null,
    lastDay, days: n, lines, daily: days.filter((d) => Number(d.day.slice(8)) <= Math.max(lastDay, 0)),
    types: [...types.values()].map((t) => ({ ...t, lines: [...t.lines] })).sort((a, b) => b.amount - a.amount),
  };
}
export type PackagingMonth = Awaited<ReturnType<typeof packagingMonth>>;

/** Month on month: every frozen / open month (with year) per AOP line, against the AOP plan. */
export async function packagingHistory() {
  const [rows, plans, months] = await Promise.all([
    q<{ period: string; aop_line: string; amount: number; qty: number; source: string }>(
      `select period::text, aop_line, sum(amount)::float8 as amount, sum(qty)::float8 as qty, min(source) as source from pkg_monthly group by 1, 2`),
    aopPlans(), packagingMonths(),
  ]);
  const open = months.filter((m) => m.status === "open").map((m) => m.period);
  const liveRows = (await Promise.all(open.map(async (p) => (await liveMonth(p)).map((r) => ({ period: p, aop_line: r.line, amount: r.amount, qty: r.packages }))))).flat();
  const periods = [...new Set([...rows.map((r) => r.period), ...open])].sort();
  return periods.map((p) => {
    const src = rows.find((r) => r.period === p)?.source ?? "snowflake";
    const isOpen = open.includes(p);
    const by = Object.fromEntries(AOP_LINES.map((l) => {
      const a = isOpen ? liveRows.filter((r) => r.period === p && r.aop_line === l).reduce((s, r) => s + r.amount, 0) : rows.filter((r) => r.period === p && r.aop_line === l).reduce((s, r) => s + r.amount, 0);
      return [l, { actual: a, plan: plans.find((x) => x.period === p && x.line.toLowerCase() === l.toLowerCase())?.plan ?? null }];
    })) as Record<AopLine, { actual: number; plan: number | null }>;
    return { period: p, source: isOpen ? "live" : src, by };
  });
}
