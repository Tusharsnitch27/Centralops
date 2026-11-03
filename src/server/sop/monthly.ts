import "server-only";
import { q } from "../db";
import { categoryName } from "@/lib/whAreas";
import { VIEWS, overallTable, flowCalc, flowInsights, latestUtil, returnsInsights, tableRows, trendTable, viewInsights, whInsights, whSeries, type FlowRow, type RawRow, type ReturnsRow, type WhCap } from "@/components/sop/reviewMath";

export async function reviewPeriods() {
  // a month is reviewable once channel / inward actuals exist for it (future liquidation plans alone don't count)
  return (await q<{ p: string }>(`select distinct period::text as p from sop_review_rows where view_key <> 'liquidation' order by 1 desc`)).map((r) => r.p);
}

/** Months covered only partly so far (MTD), keyed by period → last day included. */
export async function partialPeriods() {
  const rows = await q<{ p: string; through_day: number }>(`select period::text as p, through_day from sop_review_periods`);
  return Object.fromEntries(rows.filter((r) => r.through_day < new Date(Date.UTC(Number(r.p.slice(0, 4)), Number(r.p.slice(5, 7)), 0)).getUTCDate()).map((r) => [r.p, r.through_day]));
}

/* ---------- period selection: month / FY quarter / FY ---------- */
export type Grain = "month" | "quarter" | "year";
const fyStart = (m: string) => (Number(m.slice(5, 7)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1);
const fyQuarter = (m: string) => Math.floor(((Number(m.slice(5, 7)) + 8) % 12) / 3) + 1; // Apr–Jun = Q1
const fyLabel = (y: number) => `FY${String(y + 1).slice(2)}`;
const MON = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
export interface PeriodOption { key: string; label: string; months: string[] }
/** Month / quarter / year options built from the months that have review data (newest first). */
export function periodOptions(months: string[], grain: Grain): PeriodOption[] {
  if (grain === "month") return months.map((m) => ({ key: m, label: new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), months: [m] }));
  const groups = new Map<string, string[]>();
  for (const m of months) {
    const k = grain === "quarter" ? `${fyStart(m)}-Q${fyQuarter(m)}` : `${fyStart(m)}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, ms]) => {
    const sorted = ms.sort(), y = Number(k.slice(0, 4));
    const span = sorted.length > 1 ? `${MON(sorted[0])}–${MON(sorted.at(-1)!)}` : MON(sorted[0]);
    return { key: k, months: sorted, label: grain === "quarter" ? `${k.slice(5)} ${fyLabel(y)} · ${span}` : `${fyLabel(y)} · ${span}` };
  });
}

/** Returns plan rows (sop_review_rows) get their actuals from sop_returns (return putaway: B2C / B2B by warehouse). */
type PlanRow = { period: string; view_key: string; row_label: string; row_group: string | null; sort: number; south_plan: number | null; south_actual: number | null; north_plan: number | null; north_actual: number | null };
function withReturnActuals<T extends Omit<PlanRow, "row_group" | "sort"> & Partial<PlanRow>>(rows: T[], ret: ReturnsRow[]): T[] {
  const out = rows.map((r) => (r.view_key === "returns" ? { ...r, south_actual: null, north_actual: null } : r));
  for (const x of ret) for (const [label, v] of [["B2C returns", x.b2c], ["B2B returns", x.b2b]] as const) {
    if (v == null) continue;
    let r = out.find((y) => y.view_key === "returns" && y.period === x.period && y.row_label === label);
    if (!r) { r = { period: x.period, view_key: "returns", row_label: label, row_group: null, sort: label.startsWith("B2C") ? 1 : 2, south_plan: null, south_actual: null, north_plan: null, north_actual: null } as unknown as T; out.push(r); }
    if (x.warehouse === "South") r.south_actual = Number(v); else r.north_actual = Number(v);
  }
  return out;
}

export async function monthlyReview(input: string | string[], label?: string) {
  const months = (Array.isArray(input) ? input : [input]).slice().sort();
  const period = months.at(-1)!; // latest month in the range drives warehouse context and inventory flow
  const multi = months.length > 1;
  const [rowsDb, caps, retAct] = await Promise.all([
    q<{ period: string; view_key: string; row_label: string; row_group: string | null; sort: number; south_plan: number | null; south_actual: number | null; north_plan: number | null; north_actual: number | null }>(
      `select period::text as period, view_key, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual from sop_review_rows where period = any($1::date[]) order by period, view_key, sort, row_label`, [months]),
    q<{ period: string; warehouse: "South" | "North"; capacity: number; inventory: number | null; good: number | null; bad: number | null; other: number | null; prepack_units: number | null; special_capacity: number | null; special: number | null; prepack_pcs: number | null }>(
      `select period::text as period, warehouse, capacity::float8 as capacity, inventory::float8 as inventory, good_units::float8 as good, bad_units::float8 as bad, other_units::float8 as other, prepack_units::float8 as prepack_units,
              special_capacity::float8 as special_capacity, special_units::float8 as special, prepack_units::float8 as prepack_pcs
       from sop_wh_capacity order by period`),
    q<ReturnsRow>(`select period::text as period, warehouse, b2c::float8 as b2c, b2b::float8 as b2b, fwd_b2c, fwd_retail from sop_returns where period = any($1::date[])`, [months]),
  ]);
  const rowsRaw = withReturnActuals(rowsDb, retAct);
  const wh = whSeries(caps as WhCap[]);
  const prepack: Record<string, { South?: number; North?: number }> = {};
  for (const c of caps) if (c.prepack_units != null) (prepack[c.period] ??= {})[c.warehouse] = Number(c.prepack_units);
  const at = (w: "South" | "North") => wh[w].find((p) => p.period === period && p.util != null) ?? latestUtil(wh[w]);
  const ctx = { South: at("South"), North: at("North") };
  const views = VIEWS.map((v) => {
    // across several months: channel/category views add up by row; week views become one row per month
    const acc = new Map<string, RawRow>();
    for (const r of rowsRaw.filter((x) => x.view_key === v.key)) {
      // Amazon and Cocoblu are one B2C channel
      const label = multi && v.weekly ? MON(r.period) : v.key === "b2c" && /^cocoblu$/i.test(r.row_label) ? "Amazon" : v.key === "category_view" ? categoryName(r.row_label) : r.row_label;
      const cur = acc.get(label) ?? { label, group: r.row_group, sp: 0, sa: 0, np: 0, na: 0 };
      cur.sp += r.south_plan ?? 0; cur.sa += r.south_actual ?? 0; cur.np += r.north_plan ?? 0; cur.na += r.north_actual ?? 0;
      acc.set(label, cur);
    }
    // categories read A → Z
    const raw = v.key === "category_view" ? [...acc.values()].sort((a, b) => a.label.localeCompare(b.label)) : [...acc.values()];
    const def = multi && v.weekly ? { ...v, rowLabel: "Month", weekly: false } : v;
    return { def, rows: tableRows(def, raw), insights: viewInsights(def, raw, ctx) };
  }).filter((v) => v.rows.length > 1);
  const [meta, trendRows, flowRows, returns, notes, owners] = await Promise.all([
    q<{ through_day: number }>(`select through_day from sop_review_periods where period = $1`, [period]),
    q<{ view_key: string; row_label: string; period: string; sp: number; sa: number; np: number; na: number }>(
      `select view_key, row_label, period::text as period, coalesce(south_plan,0) as sp, coalesce(south_actual,0) as sa, coalesce(north_plan,0) as np, coalesce(north_actual,0) as na
       from sop_review_rows where period in (select period from sop_review_rows where view_key <> 'liquidation')`),
    q<FlowRow>(`select period::text as period, warehouse, capacity, coalesce(opening,0) as opening, coalesce(inward_category,0) as inward_category, coalesce(inward_returns,0) as inward_returns, coalesce(outward,0) as outward, coalesce(closing,0) as closing from sop_inventory_flow order by period, warehouse desc`),
    q<ReturnsRow>(`select period::text as period, warehouse, b2c, b2b, fwd_b2c, fwd_retail from sop_returns order by period, warehouse desc`),
    // owners' remarks on these months (commentary with projections, variance reasons, corrective actions)
    q<{ code: string; kind: string; body: string; author: string | null; at: string }>(
      `select s.code, n.kind, n.body, u.name as author, n.created_at::text as at from sop_notes n join sop_streams s on s.id = n.stream_id
       left join users u on u.id = n.author_id where n.period = any($1::date[]) order by n.created_at desc`, [months]),
    q<{ code: string; poc: string | null }>(`select s.code, coalesce(u.name, s.poc_label) as poc from sop_streams s left join users u on u.id = s.poc_id where s.active`),
  ]);
  // opening / closing hold both areas, so capacity = warehouse + floor space (pre-pack area) where it is set
  const floorCap = (p: string, w: string) => Number(caps.find((c) => c.period === p && c.warehouse === w)?.special_capacity ?? 0);
  const flow = flowRows.map((r) => flowCalc({ ...r, capacity: Number(r.capacity) + floorCap(r.period, r.warehouse) }));
  const flowNow = flow.filter((f) => f.period === period);
  const days = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const through = meta[0]?.through_day ?? days;
  // single month with Snowflake days: each view's rows carry their days so the tables can expand row → week → day
  const daySplit: Record<string, { through: number; basis: string; perLabel: Record<string, { day: string; week: string; future: boolean; sp: number; sa: number; np: number; na: number }[]> }> = {};
  if (!multi) {
    const { DETAIL_VIEWS, detailedDaily } = await import("./detailed");
    for (const v of views) {
      if (!DETAIL_VIEWS.some((x) => x.key === v.def.key)) continue;
      const d = await detailedDaily(v.def.key as Parameters<typeof detailedDaily>[0], period, null).catch(() => null);
      if (d?.hasActuals) daySplit[v.def.key] = { through: d.through, basis: d.basis, perLabel: d.perLabel };
    }
  }
  return {
    daySplit,
    period, months, label: label ?? MON(period), multi, prepack, through, mtd: through < days, days, wh, whInsights: whInsights(wh), views, overall: overallTable(views),
    trend: trendTable(withReturnActuals(trendRows.map((r) => ({ period: r.period, view_key: r.view_key, row_label: r.row_label, south_plan: Number(r.sp), south_actual: Number(r.sa), north_plan: Number(r.np), north_actual: Number(r.na) })), returns)
      .map((r) => ({ view_key: r.view_key, row_label: r.row_label, period: r.period, sp: r.south_plan ?? 0, sa: r.south_actual ?? 0, np: r.north_plan ?? 0, na: r.north_actual ?? 0 }))), flow, flowNow, flowInsights: flowInsights(flowNow.length ? flowNow : flow.filter((f) => f.period === flow.at(-1)?.period)),
    returns, returnsInsights: returnsInsights(returns), notes, owners: Object.fromEntries(owners.map((o) => [o.code, o.poc])) as Record<string, string | null>,
  };
}
export type MonthlyReview = Awaited<ReturnType<typeof monthlyReview>>;
