import "server-only";
import { q } from "../db";
import { weekOfMonth } from "@/lib/sopWeeks";
import { viewOf } from "./sync";

/**
 * Day-wise inputs → the plan side of the review. Each stream's submitted days become sop_plan_daily rows (day alerts)
 * and the South / North plan of its review rows (monthly / weekly views), replacing the workbook plan for that month.
 * Actuals are never touched.
 */
const FEED: Record<string, (line: { name: string; metric: string | null }) => { feed: string; label: string } | null> = {
  "b2c-sf": (l) => (l.metric === "items" ? { feed: "b2c", label: "shopify" } : null),
  "b2c-mp": (l) => (l.metric === "items" ? { feed: "b2c", label: l.name.split("·")[0]!.trim() } : null),
  "b2b-mp": (l) => ({ feed: "b2b_mp", label: l.name }),
  "retail-forward": (l) => (l.metric === "units" ? { feed: "retail", label: "" } : null),
  "inbound-category-wise": () => ({ feed: "category_inward", label: "" }),
  "pre-pack-category-wise": () => ({ feed: "prepack", label: "" }),
  liquidation: () => ({ feed: "liquidation", label: "" }),
};

export async function applyInputsToPlan(streamId: string, period: string) {
  const [s] = await q<{ code: string | null }>(`select code from sop_streams where id = $1`, [streamId]);
  const map = s?.code ? FEED[s.code] : undefined;
  if (!map) return;
  const vals = await q<{ name: string; metric: string | null; day: string; dimension: string; v: number }>(
    `select l.name, l.metric, v.period_label as day, v.dimension, coalesce(v.projection, v.revised_projection)::float8 as v
     from sop_values v join sop_lines l on l.id = v.line_id
     where l.stream_id = $1 and l.active and v.period = $2 and v.period_label ~ '^\\d{4}-\\d{2}-\\d{2}$'`, [streamId, period]);
  if (!vals.length) return;
  const known = (await q<{ row_label: string }>(`select distinct row_label from sop_review_rows where view_key = 'b2b_mp'`)).map((r) => r.row_label);
  const daily = new Map<string, { view: string; row: string; day: string; south: number; north: number }>();
  const review = new Map<string, { view: string; row: string; south: number; north: number }>();
  const bump = <T extends { south: number; north: number }>(m: Map<string, T>, k: string, init: () => T, region: "south" | "north", v: number) => {
    const a = m.get(k) ?? init(); a[region] += v; m.set(k, a);
  };
  for (const r of vals) {
    const f = map({ name: r.name, metric: r.metric });
    if (!f || !r.v) continue;
    const prepack = /^pre-?pack/i.test(r.dimension);
    const feed = prepack ? "prepack" : f.feed;
    const region = /north/i.test(r.dimension) ? "north" : "south";
    const target = feed === "liquidation" ? { view: "liquidation", label: weekOfMonth(r.day) } : viewOf(feed, f.label, r.day, known);
    if (!target) continue;
    const dayRow = target.view === "b2c" || target.view === "b2b_mp" ? target.label : "";
    bump(daily, `${target.view}|${dayRow}|${r.day}`, () => ({ view: target.view, row: dayRow, day: r.day, south: 0, north: 0 }), region, r.v);
    bump(review, `${target.view}|${target.label}`, () => ({ view: target.view, row: target.label, south: 0, north: 0 }), region, r.v);
    // category inward also feeds the category-wise view, one row per category
    if (s!.code === "inbound-category-wise" && !prepack)
      bump(review, `category_view|${r.name}`, () => ({ view: "category_view", row: r.name, south: 0, north: 0 }), region, r.v);
  }
  const views = [...new Set([...review.values()].map((x) => x.view))];
  for (const view of views) {
    // this stream now owns the month's plan for these views: drop the workbook day plan first
    await q(`delete from sop_plan_daily where view_key = $1 and date_trunc('month', day)::date = $2::date
             and ($1 not in ('b2c','b2b_mp') or row_label = any($3::text[]))`,
      [view, period, [...daily.values()].filter((d) => d.view === view).map((d) => d.row)]);
  }
  for (const d of daily.values())
    await q(`insert into sop_plan_daily (day, view_key, row_label, south, north, source) values ($1,$2,$3,$4,$5,'input')
             on conflict (day, view_key, row_label) do update set south = excluded.south, north = excluded.north, source = 'input'`,
      [d.day, d.view, d.row, d.south, d.north]);
  for (const r of review.values())
    await q(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, north_plan)
             values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = $1 and period = $2),$5,$6)
             on conflict (view_key, period, row_label) do update set south_plan = excluded.south_plan, north_plan = excluded.north_plan`,
      [r.view, period, r.row, r.view === "b2c" && !r.row.startsWith("Shopify") ? "Marketplace" : null, Math.round(r.south), Math.round(r.north)]);
}
