import "server-only";
import { q } from "../db";
import { FN } from "./sources";
import { longTailPremium } from "./math";
import { LONG_TAIL, LONG_TAIL_KEY, type FnKey, type FnSite } from "./types";

/** Package groups in lg_b2c_cat (scripts/courier-category.mjs); Winterwear is apparel, shown as a heavier-apparel control. */
const GROUPS = ["Apparel only", "Winterwear", "Shoes", "Perfume", "Accessories / belts / sunglasses", "Bags / trolley"];
const LT_GROUPS = ["Shoes", "Perfume", "Accessories / belts / sunglasses", "Bags / trolley"];

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
  /** Inwards: factory issue quantity per 100 units put away, by category (issues_factory_sorted, Mar–Oct 2026; WAM issues after). */
  issues: { category: string; values: (number | null)[] }[] | null;
  /** B2C only, months with courier bills loaded (lg_b2c_cat): ₹ per forward shipment and kg by what the package holds; the long tail's premium
   *  over apparel-only at the same courier. Bills carry no site, so this is both sites. */
  courier: { months: string[]; rows: { grp: string; ships: (number | null)[]; perShip: (number | null)[]; kg: (number | null)[] }[];
    premium: (number | null)[]; premiumShips: (number | null)[]; unpriced: number } | null;
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
  let issues: CategoryView["issues"] = null;
  if (fn === "inwards" && rows.some((r) => r.metric === "issue_qty")) {
    const iq = new Map<string, number>();
    for (const r of rows.filter((x) => x.metric === "issue_qty")) iq.set(r.category, (iq.get(r.category) ?? 0) + r.value);
    const per = (c: string | null, m: string) => { const i = c ? val("issue_qty", c, m) : rows.filter((r) => r.metric === "issue_qty" && r.month === m).reduce((a, r) => a + r.value, 0);
      const u = c ? val("units", c, m) : total[months.indexOf(m)]; return i && u ? (100 * i) / u : null; };
    issues = [{ category: "All categories", values: months.map((m) => per(null, m)) },
      ...[...iq].filter(([c]) => c !== "(NO CATEGORY)").sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([c]) => ({ category: c, values: months.map((m) => per(c, m)) }))];
  }
  let courier: CategoryView["courier"] = null;
  if (fn === "b2c_shopify" || fn === "b2c_marketplace") {
    const cr = await q<{ month: string; courier: string; grp: string; ships: number; cost: number; kg: number | null }>(
      `select month::text as month, courier, grp, ships, cost::float8 as cost, kg::float8 as kg from lg_b2c_cat where channel = $1 and month = any($2::date[])`, [FN[fn].label, months]);
    const cm = months.filter((m) => cr.some((r) => r.month === m));
    if (cm.length) {
      const at = (m: string, g: string) => cr.filter((r) => r.month === m && r.grp === g);
      const prem = cm.map((m) => longTailPremium(cr.filter((r) => r.month === m), LT_GROUPS));
      courier = { months: cm, unpriced: prem.reduce((a, p) => a + p.unpriced, 0),
        premium: prem.map((p) => (p.ships ? p.rupees : null)), premiumShips: prem.map((p) => p.ships || null),
        rows: GROUPS.filter((g) => cr.some((r) => r.grp === g)).map((g) => {
          const per = cm.map((m) => { const xs = at(m, g), n = xs.reduce((a, r) => a + r.ships, 0); return { n, cost: xs.reduce((a, r) => a + r.cost, 0), kg: xs.reduce((a, r) => a + (r.kg ?? 0), 0) }; });
          return { grp: g, ships: per.map((p) => p.n || null), perShip: per.map((p) => (p.n ? p.cost / p.n : null)), kg: per.map((p) => (p.n && p.kg ? p.kg / p.n : null)) };
        }) };
    }
  }
  return { months, units, total, shipments, hours, issues, courier };
}
