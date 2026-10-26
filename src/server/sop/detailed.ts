import "server-only";
import { q } from "../db";
import { viewOf } from "./sync";
import { weekOfMonth } from "@/lib/sopWeeks";

/**
 * Day-on-day plan vs actual for one function and one month, South / North, optionally per channel.
 * Everything is computed per day; weeks are only summaries of those days.
 */
export const DETAIL_VIEWS = [
  { key: "b2c", flow: "outbound", title: "B2C · items", src: "b2c", byLabel: true, unit: "items" },
  { key: "b2c_orders", flow: "outbound", title: "B2C · orders", src: "b2c_orders", byLabel: true, unit: "orders" },
  { key: "b2b_mp", flow: "outbound", title: "B2B marketplace", src: "b2b_mp", byLabel: true, unit: "units" },
  { key: "retail_fwd", flow: "outbound", title: "B2B retail stores", src: "retail_fwd", byLabel: false, unit: "units" },
  { key: "liquidation", flow: "outbound", title: "Liquidation", src: "liquidation", byLabel: false, unit: "units" },
  { key: "category_inward", flow: "inward", title: "Category inward", src: "category_inward", byLabel: false, unit: "units" },
  { key: "prepack", flow: "inward", title: "Pre-pack inward", src: "prepack", byLabel: false, unit: "units" },
  { key: "category_view", flow: "inward", title: "Category-wise inward", src: "category_view", byLabel: true, unit: "units" },
] as const;
export type DetailKey = (typeof DETAIL_VIEWS)[number]["key"];

export interface DayCell { sp: number; sa: number; np: number; na: number }
export interface DetailDay extends DayCell { day: string; week: string; future: boolean }
export type PlanBasis = "daily" | "weekly spread" | "monthly spread" | "none";

const days = (p: string) => Array.from({ length: new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate() }, (_, i) => `${p.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
const clean = (l: string) => l.replace(/\s*\(items\)$/i, "");

export async function detailedDaily(key: DetailKey, period: string, label: string | null) {
  const v = DETAIL_VIEWS.find((x) => x.key === key)!;
  const list = days(period);
  const [facts, plans, review, known, through] = await Promise.all([
    q<{ day: string; feed: string; label: string; region: string; units: number; orders: number | null }>(
      `select day::text as day, feed, label, region, units::float8 as units, orders::float8 as orders from sop_actuals_daily where date_trunc('month', day)::date = $1::date`, [period]),
    q<{ day: string; row_label: string; south: number; north: number }>(
      `select day::text as day, row_label, south::float8 as south, north::float8 as north from sop_plan_daily where view_key = $1 and date_trunc('month', day)::date = $2::date`, [v.src, period]),
    q<{ row_label: string; sp: number; np: number }>(
      `select row_label, coalesce(south_plan,0)::float8 as sp, coalesce(north_plan,0)::float8 as np from sop_review_rows where view_key = $1 and period = $2`, [v.key === "b2c_orders" ? "__none" : v.key, period]),
    q<{ row_label: string }>(`select distinct row_label from sop_review_rows where view_key = 'b2b_mp'`),
    q<{ through_day: number }>(`select through_day from sop_review_periods where period = $1`, [period]),
  ]);
  const knownB2B = known.map((k) => k.row_label);
  const weekly = !v.byLabel; // retail, liquidation, inward and pre-pack keep week rows in the review

  // actuals: per label|day, South / North
  const act = new Map<string, { s: number; n: number }>();
  const put = (m: Map<string, { s: number; n: number }>, k: string, region: string, val: number) => {
    const a = m.get(k) ?? { s: 0, n: 0 }; if (region === "south") a.s += val; else if (region === "north") a.n += val; m.set(k, a);
  };
  for (const f of facts) {
    if (f.region === "other") continue;
    if (v.key === "b2c_orders") {
      if (f.feed !== "b2c" || f.orders == null) continue;
      const m = viewOf("b2c", f.label, f.day, knownB2B)!;
      put(act, `${clean(m.label)}|${f.day}`, f.region, Number(f.orders));
      continue;
    }
    const m = viewOf(f.feed, f.label, f.day, knownB2B);
    if (!m || m.view !== v.src) continue;
    put(act, `${v.byLabel ? m.label : ""}|${f.day}`, f.region, Number(f.units));
  }

  // plans: the day plan where it exists, else the week's / month's plan spread over its days
  const plan = new Map<string, { s: number; n: number }>();
  let basis: PlanBasis = "none";
  if (plans.length) {
    basis = "daily";
    for (const p of plans) { const k = `${v.byLabel ? p.row_label : ""}|${p.day}`; const a = plan.get(k) ?? { s: 0, n: 0 }; a.s += p.south; a.n += p.north; plan.set(k, a); }
  } else if (review.length) {
    if (weekly) {
      basis = "weekly spread";
      for (const r of review) {
        const wd = list.filter((d) => weekOfMonth(d) === r.row_label);
        for (const d of wd) plan.set(`|${d}`, { s: (plan.get(`|${d}`)?.s ?? 0) + r.sp / wd.length, n: (plan.get(`|${d}`)?.n ?? 0) + r.np / wd.length });
      }
    } else {
      basis = "monthly spread";
      for (const r of review) for (const d of list) {
        const k = `${v.byLabel ? r.row_label : ""}|${d}`;
        plan.set(k, { s: (plan.get(k)?.s ?? 0) + r.sp / list.length, n: (plan.get(k)?.n ?? 0) + r.np / list.length });
      }
    }
  }

  const labels = v.byLabel ? [...new Set([...plan.keys(), ...act.keys()].map((k) => k.split("|")[0]!))].filter(Boolean).sort() : [];
  const lastActual = [...act.keys()].map((k) => k.split("|")[1]!).sort().at(-1) ?? null;
  const thru = through[0]?.through_day ?? (lastActual ? Number(lastActual.slice(8)) : 0);
  const build = (lbl: string | null): DetailDay[] => list.map((d) => {
    const keys = v.byLabel ? (lbl ? [lbl] : labels) : [""];
    const c = keys.reduce((a, l) => { const p = plan.get(`${l}|${d}`), x = act.get(`${l}|${d}`); return { sp: a.sp + (p?.s ?? 0), np: a.np + (p?.n ?? 0), sa: a.sa + (x?.s ?? 0), na: a.na + (x?.n ?? 0) }; }, { sp: 0, sa: 0, np: 0, na: 0 });
    return { day: d, week: weekOfMonth(d), future: Number(d.slice(8)) > thru, ...c };
  });
  const sel = label && labels.includes(label) ? label : null;
  // per-channel summary for the month (actual days only)
  const byLabel = labels.map((l) => {
    const ds = build(l).filter((d) => !d.future);
    const t = ds.reduce((a, d) => ({ p: a.p + d.sp + d.np, a: a.a + d.sa + d.na }), { p: 0, a: 0 });
    const off = ds.filter((d) => { const p = d.sp + d.np; return p > 0 && Math.abs((d.sa + d.na) / p - 1) > 0.2; }).length;
    return { label: l, plan: t.p, actual: t.a, off, judged: ds.filter((d) => d.sp + d.np > 0).length };
  });
  // every row's own days (one entry "" for views without channel rows) — the review tables expand into these
  const perLabel: Record<string, DetailDay[]> = v.byLabel ? Object.fromEntries(labels.map((l) => [l, build(l)])) : { "": build(null) };
  return { view: v, period, basis, through: thru, labels, label: sel, days: build(sel), byLabel, perLabel, hasActuals: act.size > 0 };
}
export type Detailed = Awaited<ReturnType<typeof detailedDaily>>;
