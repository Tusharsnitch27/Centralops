import "server-only";
import { q } from "../db";
import { FN } from "./sources";
import { LONG_TAIL, LONG_TAIL_KEY, type FnKey, type FnSite } from "./types";

/**
 * AOP › Functions "By category" (fn_category_month): per month, each category's share of the function's units; non-apparel (LONG_TAIL) listed
 * apart; forward functions add the share of shipments holding each long-tail category and any of them; Inwards adds median hours gate entry →
 * last putaway (per site — a median doesn't add across sites). Top apparel categories by units over the months shown; the rest is "Other".
 */
const TOP = 8;
export interface CategoryView {
  months: string[];
  units: { category: string; longTail: boolean; values: (number | null)[] }[]; // units per month; share = value ÷ total
  total: (number | null)[];
  shipments: { category: string; values: (number | null)[] }[] | null; // share of '(all)' shipments, % per month
  hours: { category: string; values: (string | null)[] }[] | null; // "1.5" or "S 1.5 · N 21.6"
}

export async function categoryView(fn: FnKey, site: FnSite, months: string[]): Promise<CategoryView | null> {
  const streams = FN[fn].processed.streams, sites = site === "Both" ? ["South", "North"] : [site];
  const rows = await q<{ month: string; site: string; category: string; metric: string; value: number }>(
    `select month::text as month, site, category, metric, sum(value)::float8 as value from fn_category_month
      where stream = any($1::text[]) and site = any($2::text[]) and month = any($3::date[]) group by 1, 2, 3, 4`, [streams, sites, months]);
  if (!rows.some((r) => r.metric === "units")) return null;
  const val = (metric: string, cat: string, m: string, s?: string) => {
    const xs = rows.filter((r) => r.metric === metric && r.category === cat && r.month === m && (!s || r.site === s));
    return xs.length ? xs.reduce((a, r) => a + r.value, 0) : null;
  };
  const unitRows = rows.filter((r) => r.metric === "units");
  const total = months.map((m) => { const xs = unitRows.filter((r) => r.month === m); return xs.length ? xs.reduce((a, r) => a + r.value, 0) : null; });
  const byCat = new Map<string, number>();
  for (const r of unitRows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.value);
  const apparel = [...byCat].filter(([c]) => !LONG_TAIL.includes(c)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const shown = apparel.slice(0, TOP), lt = LONG_TAIL.filter((c) => byCat.has(c));
  const units = [
    ...shown.map((c) => ({ category: c, longTail: false, values: months.map((m) => val("units", c, m) ?? 0) })),
    ...(apparel.length > TOP ? [{ category: "Other apparel", longTail: false, values: months.map((m) => apparel.slice(TOP).reduce((a, c) => a + (val("units", c, m) ?? 0), 0)) }] : []),
    ...lt.map((c) => ({ category: c, longTail: true, values: months.map((m) => val("units", c, m) ?? 0) })),
  ];

  const pct = (cat: string, m: string) => { const all = val("shipments", "(all)", m), n = val("shipments", cat, m); return all ? (100 * (n ?? 0)) / all : null; };
  const shipments = rows.some((r) => r.metric === "shipments")
    ? [{ category: "Any long-tail item", values: months.map((m) => pct(LONG_TAIL_KEY, m)) }, ...lt.map((c) => ({ category: c, values: months.map((m) => pct(c, m)) }))]
    : null;

  let hours: CategoryView["hours"] = null;
  if (fn === "inwards" && rows.some((r) => r.metric === "gate_put_h")) {
    const asns = new Map<string, number>();
    for (const r of rows.filter((x) => x.metric === "asns")) asns.set(r.category, (asns.get(r.category) ?? 0) + r.value);
    const f = (h: number | null) => (h == null ? null : h.toFixed(1));
    hours = [...asns].sort((a, b) => b[1] - a[1]).slice(0, TOP + lt.length).map(([c]) => ({ category: c, values: months.map((m) => {
      const per = sites.map((s) => f(val("gate_put_h", c, m, s)));
      return per.every((x) => x == null) ? null : sites.length === 1 ? per[0]! : sites.map((s, i) => `${s[0]} ${per[i] ?? "—"}`).join(" · ");
    }) }));
  }
  return { months, units, total, shipments, hours };
}
