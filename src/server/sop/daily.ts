import "server-only";
import { q } from "../db";
import { viewOf } from "./sync";
import { weekOfMonth } from "@/lib/sopWeeks";

/** A day is "off plan" when actual is more than this far from that day's plan. */
export const DAY_BAND = 0.15;
export type Basis = "daily" | "weekly" | "monthly";
export interface DayPoint { day: string; plan: number; actual: number; dev: number | null }
export interface DaySeries { days: DayPoint[]; judged: number; up: number; down: number; ok: number; unplanned: number; basis: Basis; worstUp: DayPoint | null; worstDown: DayPoint | null }
export interface DailyView { key: string; title: string; flow: "Outwards" | "Inwards"; total: DaySeries; rows: { label: string; series: DaySeries }[] }

const shopify = (l: string) => /^shopify/i.test(l);
const VIEWS: { key: string; src?: string; match?: (label: string) => boolean; title: string; flow: "Outwards" | "Inwards"; weekly: boolean; byLabel: boolean }[] = [
  { key: "b2c_sf", src: "b2c", match: shopify, title: "B2C · Shopify", flow: "Outwards", weekly: false, byLabel: true },
  { key: "b2c_mp", src: "b2c", match: (l) => !shopify(l), title: "B2C · Marketplaces", flow: "Outwards", weekly: false, byLabel: true },
  { key: "b2b_mp", title: "B2B · Marketplace", flow: "Outwards", weekly: false, byLabel: true },
  { key: "retail_fwd", title: "B2B · Retail stores", flow: "Outwards", weekly: true, byLabel: false },
  { key: "category_inward", title: "Category inward", flow: "Inwards", weekly: true, byLabel: false },
  { key: "prepack", title: "Pre-pack inward", flow: "Inwards", weekly: true, byLabel: false },
];
const daysIn = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
const dayList = (p: string, through: number) => Array.from({ length: through }, (_, i) => `${p.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);

function summarise(days: DayPoint[], basis: Basis): DaySeries {
  let up = 0, down = 0, ok = 0, unplanned = 0, judged = 0;
  let worstUp: DayPoint | null = null, worstDown: DayPoint | null = null;
  for (const d of days) {
    if (d.plan <= 0) { if (d.actual > 0) { unplanned++; up++; judged++; } continue; }
    judged++;
    const dev = d.dev!;
    if (dev > DAY_BAND) { up++; if (!worstUp || dev > worstUp.dev!) worstUp = d; }
    else if (dev < -DAY_BAND) { down++; if (!worstDown || dev < worstDown.dev!) worstDown = d; }
    else ok++;
  }
  return { days, judged, up, down, ok, unplanned, basis, worstUp, worstDown };
}

/**
 * Day-by-day plan vs actual for the given months (actuals from the Snowflake daily feed). Plan per day: the workbook's
 * daily plan where it exists, else the week's plan spread over its days, else the month's plan spread evenly.
 */
export async function dailyDeviation(months: string[]): Promise<{ hasActuals: boolean; through: Record<string, number>; views: DailyView[] }> {
  const [facts, plansDaily, review, periods, known] = await Promise.all([
    q<{ day: string; feed: string; label: string; region: string; units: number }>(`select day::text as day, feed, label, region, units::float8 as units from sop_actuals_daily where date_trunc('month', day)::date = any($1::date[])`, [months]),
    q<{ day: string; view_key: string; row_label: string; south: number; north: number }>(`select day::text as day, view_key, row_label, south::float8 as south, north::float8 as north from sop_plan_daily where date_trunc('month', day)::date = any($1::date[])`, [months]),
    q<{ period: string; view_key: string; row_label: string; sp: number; np: number }>(`select period::text as period, view_key, row_label, coalesce(south_plan,0)::float8 as sp, coalesce(north_plan,0)::float8 as np from sop_review_rows where period = any($1::date[])`, [months]),
    q<{ period: string; through_day: number }>(`select period::text as period, through_day from sop_review_periods where period = any($1::date[])`, [months]),
    q<{ row_label: string }>(`select distinct row_label from sop_review_rows where view_key = 'b2b_mp'`),
  ]);
  const knownB2B = known.map((k) => k.row_label);
  // actual per view|label|day (South + North)
  const act = new Map<string, number>();
  const lastFact = new Map<string, string>();
  for (const f of facts) {
    const m = viewOf(f.feed, f.label, f.day, knownB2B);
    if (!m || f.region === "other") continue;
    const label = VIEWS.find((v) => (v.src ?? v.key) === m.view)?.byLabel ? m.label : "";
    act.set(`${m.view}|${label}|${f.day}`, (act.get(`${m.view}|${label}|${f.day}`) ?? 0) + Number(f.units));
    const p = `${f.day.slice(0, 7)}-01`;
    if (!lastFact.get(p) || f.day > lastFact.get(p)!) lastFact.set(p, f.day);
  }
  const through: Record<string, number> = {};
  for (const p of months) through[p] = lastFact.get(p) ? Number(lastFact.get(p)!.slice(8, 10)) : 0;
  void periods;
  const dailyPlan = new Map(plansDaily.map((r) => [`${r.view_key}|${r.row_label}|${r.day}`, r.south + r.north]));
  const hasDaily = (view: string, p: string) => plansDaily.some((r) => r.view_key === view && r.day.startsWith(p.slice(0, 7)));

  // only judge views that actually have day-level actuals in these months
  const viewsWithFacts = new Set([...act.keys()].map((k) => k.split("|")[0]));
  // a B2C half only counts when it has its own facts (Shopify vs marketplaces)
  const out: DailyView[] = [];
  for (const v of VIEWS) {
    const src = v.src ?? v.key;
    if (!viewsWithFacts.has(src)) continue;
    const labels = v.byLabel ? [...new Set(review.filter((r) => r.view_key === src).map((r) => r.row_label)
      .concat([...act.keys()].filter((k) => k.startsWith(`${src}|`)).map((k) => k.split("|")[1])))].filter((l) => !v.match || v.match(l)).sort() : [""];
    const rows: { label: string; series: DaySeries }[] = [];
    let basis: Basis = "monthly";
    const totals = new Map<string, DayPoint>();
    for (const label of labels) {
      const pts: DayPoint[] = [];
      for (const p of months) {
        const n = through[p];
        if (!n) continue;
        const monthPlan = (lbl: string) => review.filter((r) => r.view_key === src && r.period === p && (v.byLabel ? r.row_label === lbl : true)).reduce((a, r) => a + r.sp + r.np, 0);
        const weekPlan = (wk: string) => { const r = review.find((x) => x.view_key === src && x.period === p && x.row_label === wk); return r ? r.sp + r.np : null; };
        const wkDays = (wk: string) => Array.from({ length: daysIn(p) }, (_, i) => `${p.slice(0, 8)}${String(i + 1).padStart(2, "0")}`).filter((d) => weekOfMonth(d) === wk).length;
        const useDaily = hasDaily(src, p);
        basis = useDaily ? "daily" : v.weekly ? "weekly" : "monthly";
        for (const d of dayList(p, n)) {
          let plan: number;
          if (useDaily) plan = dailyPlan.get(`${src}|${v.byLabel ? label : ""}|${d}`) ?? 0;
          else if (v.weekly) { const wk = weekOfMonth(d); const w = weekPlan(wk); plan = w != null ? w / Math.max(1, wkDays(wk)) : 0; }
          else plan = monthPlan(label) / daysIn(p);
          const actual = act.get(`${src}|${label}|${d}`) ?? 0;
          pts.push({ day: d, plan, actual, dev: plan > 0 ? (actual - plan) / plan : null });
          const t = totals.get(d) ?? { day: d, plan: 0, actual: 0, dev: null };
          t.plan += plan; t.actual += actual; totals.set(d, t);
        }
      }
      if (v.byLabel && pts.some((x) => x.plan > 0 || x.actual > 0)) rows.push({ label, series: summarise(pts, basis) });
    }
    const tot = [...totals.values()].sort((a, b) => a.day.localeCompare(b.day)).map((t) => ({ ...t, dev: t.plan > 0 ? (t.actual - t.plan) / t.plan : null }));
    if (tot.length) out.push({ key: v.key, title: v.title, flow: v.flow, total: summarise(tot, basis), rows: rows.sort((a, b) => (b.series.up + b.series.down) - (a.series.up + a.series.down)) });
  }
  return { hasActuals: facts.length > 0, through, views: out };
}
