import "server-only";
import { one, q } from "../db";
import { sfConfigured, sfQuery } from "../snowflake";
import { weekOfMonth } from "@/lib/sopWeeks";

/**
 * Daily Snowflake → S&OP actuals. Queries come from the S&OP team (Oct 2026); every run re-reads all months and
 * writes FY27 onward (SOP_SYNC_FROM, default 2026-04-01). Plans are never touched — only actual columns.
 */
const FROM = () => process.env.SOP_SYNC_FROM ?? "2026-04-01";
const REGION = `CASE WHEN warehouse_name IN ('SAPL-WH2','SAPL-WH1') THEN 'south' WHEN warehouse_name IN ('SAPL-NORTH-TAURU') THEN 'north' END`;
const PUT_REGION = `CASE WHEN "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2') THEN 'south' WHEN "Warehouse Name" IN ('SAPL-NORTH-TAURU') THEN 'north' END`;
const BASE = `warehouse_name IN ('SAPL-WH2','SAPL-WH1','SAPL-NORTH-TAURU') AND packed_time IS NOT NULL AND sla_status NOT IN ('CANCELLED')`;

export const FEEDS = {
  b2c: {
    title: "B2C outward — items & orders by marketplace",
    fills: "Monthly review › B2C channels (items, South/North) and the B2C projection lines (orders + items)",
    sql: `SELECT TO_VARCHAR(DATE_TRUNC('MONTH', packed_time), 'YYYY-MM-DD') AS month,
  CASE WHEN MARKETPLACE_MAPPED IN ('NYKAA_FASHION','NYKAA.COM') THEN 'NYKAA' ELSE MARKETPLACE_MAPPED END AS marketplace,
  ${REGION} AS region,
  COUNT(DISTINCT saleorderitemcode) AS item_count,
  COUNT(DISTINCT order_name) AS order_count,
  TO_VARCHAR(MAX(packed_time)::date, 'YYYY-MM-DD') AS last_day
FROM maplemonk.warehouse_sla_performance
WHERE MARKETPLACE_MAPPED IN ('AJIO','AMAZON','FLIPKART','MYNTRA','SHOPIFY','NYKAA.COM','NYKAA_FASHION','COCOBLU')
  AND ${BASE}
GROUP BY 1, 2, 3`,
  },
  b2b_mp: {
    title: "B2B marketplace — items by marketplace",
    fills: "Monthly review › B2B-MP channels (items, South/North)",
    sql: `SELECT TO_VARCHAR(DATE_TRUNC('MONTH', packed_time), 'YYYY-MM-DD') AS month,
  CASE WHEN MARKETPLACE_MAPPED IN ('M_NOW_WESTBENGAL','M-NOW') THEN 'M-NOW' ELSE MARKETPLACE_MAPPED END AS marketplace,
  ${REGION} AS region,
  COUNT(DISTINCT saleorderitemcode) AS item_count,
  TO_VARCHAR(MAX(packed_time)::date, 'YYYY-MM-DD') AS last_day
FROM maplemonk.warehouse_sla_performance
WHERE MARKETPLACE_MAPPED NOT IN ('COCOBLU','AJIO','FLIPKART','MYNTRA','SHOPIFY','NYKAA.COM','NYKAA_FASHION','CUSTOM','OWN_STORE_B2B',
    'B2B CORPORATE CHANNEL','STORE','SNITCH HQ','SAPL_WH_TRANSFERS','B2B_SNITCH','RK_WORLD')
  AND ${BASE}
GROUP BY 1, 2, 3`,
  },
  retail: {
    title: "B2B retail — store dispatch by day",
    fills: "Monthly review › Retail forward (items per week of the month, South/North)",
    sql: `SELECT TO_VARCHAR(packed_time::date, 'YYYY-MM-DD') AS day,
  ${REGION} AS region,
  COUNT(DISTINCT saleorderitemcode) AS item_count
FROM maplemonk.warehouse_sla_performance
WHERE MARKETPLACE_MAPPED IN ('STORE')
  AND ${BASE}
GROUP BY 1, 2`,
  },
  category_inward: {
    title: "Category inward — new-inward putaway by day",
    fills: "Monthly review › Category inward (units per week of the month, South/North)",
    sql: `SELECT TO_VARCHAR(putaway_completed_date::date, 'YYYY-MM-DD') AS day,
  ${PUT_REGION} AS region,
  SUM(putaway_completed_quantity) AS qty
FROM snitch_db.maplemonk.putaway_tracking
WHERE putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward')
  AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  AND category NOT IN ('NON- TRADING') AND is_trading = TRUE
GROUP BY 1, 2`,
  },
  prepack: {
    title: "Pre-pack inward — kit (PP%) putaway by day",
    fills: "Monthly review › Pre-pack (units per week of the month, South/North)",
    sql: `SELECT TO_VARCHAR(putaway_completed_date::date, 'YYYY-MM-DD') AS day,
  ${PUT_REGION} AS region,
  SUM(putaway_completed_quantity) AS qty
FROM snitch_db.maplemonk.putaway_tracking
WHERE putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward') AND "Item Type skuCode" LIKE 'PP%'
  AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  AND category NOT IN ('NON- TRADING') AND is_trading = TRUE
GROUP BY 1, 2`,
  },
  category_view: {
    title: "Category-wise inward — by month and category",
    fills: "Monthly review › Category-wise inward (units by category, South/North)",
    sql: `WITH base AS (
  SELECT TO_VARCHAR(DATE_TRUNC('MONTH', putaway_completed_date), 'YYYY-MM-DD') AS month,
    ${PUT_REGION} AS region, TRIM(LOWER(category)) AS cat_norm, SUM(putaway_completed_quantity) AS qty
  FROM snitch_db.maplemonk.putaway_tracking
  WHERE putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward')
    AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  GROUP BY 1, 2, 3
)
SELECT month, region,
  CASE cat_norm
    WHEN 't-shirts' THEN 'T-Shirts' WHEN 'joggers & trackpants' THEN 'Joggers & Trackpants' WHEN 'sweatshirts' THEN 'Sweatshirts'
    WHEN 'sweater' THEN 'Sweater' WHEN 'accessories' THEN 'Accessories' WHEN 'shirts' THEN 'Shirts' WHEN 'jackets' THEN 'Jackets'
    WHEN 'blazers' THEN 'Blazers' WHEN 'sunglasses' THEN 'Sunglasses' WHEN 'overshirt' THEN 'Overshirt' WHEN 'hoodies' THEN 'Hoodies'
    WHEN 'trousers' THEN 'Trousers' WHEN 'cargo pants' THEN 'Cargo Pants' WHEN 'jeans' THEN 'Jeans' WHEN 'chinos' THEN 'Chinos'
    WHEN 'shorts' THEN 'Shorts' WHEN 'trouser' THEN 'Trousers' WHEN 'sweaters' THEN 'Sweaters' WHEN 'socks' THEN 'Socks' WHEN 'bags' THEN 'Bags'
    WHEN 'trackpants' THEN 'Joggers & Trackpants' WHEN 'perfumes' THEN 'Perfumes' WHEN 'shoes' THEN 'Shoes' WHEN 'joggers' THEN 'Joggers & Trackpants'
    WHEN 'belts' THEN 'Accessories' ELSE INITCAP(cat_norm) END AS category,
  SUM(qty) AS qty
FROM base
GROUP BY 1, 2, 3
HAVING category NOT IN ('Hoodies','Carry Bag','Non- Trading')`,
  },
  returns: {
    title: "Returns — putaway of returns by month and type",
    fills: "Monthly review › Returns (B2C vs B2B by warehouse)",
    sql: `SELECT TO_VARCHAR(DATE_TRUNC('MONTH', putaway_completed_date), 'YYYY-MM-DD') AS month,
  final_type,
  CASE WHEN "Warehouse Name" LIKE '%NORTH%' THEN 'north' ELSE 'south' END AS region,
  SUM(putaway_completed_quantity) AS qty
FROM snitch_db.maplemonk.putaway_tracking
WHERE final_type LIKE '%Return%' AND is_trading = TRUE AND category_group NOT LIKE '%NON%'
GROUP BY 1, 2, 3`,
  },
} as const;
export type FeedKey = keyof typeof FEEDS;

type Region = "south" | "north";
const n = (v: unknown) => Number(v) || 0;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** Label in the review for a Snowflake marketplace (keeps the names the workbook used). */
async function reviewLabel(view: "b2c" | "b2b_mp", period: string, mp: string) {
  const existing = await q<{ row_label: string }>(`select row_label from sop_review_rows where view_key = $1 and period = $2`, [view, period]);
  const has = (l: string) => existing.some((e) => e.row_label === l);
  const k = norm(mp);
  if (view === "b2c") {
    if (k === "shopify") return "Shopify (Items)";
    if (k === "amazon" || k === "cocoblu") return has("Cocoblu") ? "Cocoblu" : "Amazon";
    const m: Record<string, string> = { myntra: "Myntra", flipkart: "Flipkart", ajio: "AJIO", nykaa: "Nykaa" };
    return m[k] ?? mp;
  }
  // B2B marketplaces: match an existing row loosely (e.g. FLIPKART_SOR → Flipkart, SJIT_MYNTRA → SJIT Myntra)
  const rows = (await q<{ row_label: string }>(`select distinct row_label from sop_review_rows where view_key = 'b2b_mp'`)).map((r) => r.row_label);
  const hit = rows.find((l) => norm(l) === k) ?? rows.find((l) => k.includes(norm(l)) || norm(l).includes(k))
    ?? (k.includes("mnow") ? rows.find((l) => norm(l) === "mnow") : undefined)
    ?? (k.includes("cocoblu") || k.includes("amazon") ? rows.find((l) => norm(l).includes("cocoblu") || norm(l).includes("amazon")) : undefined)
    ?? (k.includes("myntra") ? rows.find((l) => norm(l).includes("myntra")) : undefined)
    ?? (k.includes("flipkart") ? rows.find((l) => norm(l).includes("flipkart")) : undefined);
  return hit ?? mp.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Write actual South/North into a review row (insert with no plan when the row is new). */
async function writeActual(view: string, period: string, label: string, group: string | null, south: number, north: number) {
  await q(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual)
           values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = $1 and period = $2),null,$5,null,$6)
           on conflict (view_key, period, row_label) do update set south_actual = excluded.south_actual, north_actual = excluded.north_actual`,
    [view, period, label, group, south, north]);
}
async function markThrough(period: string, lastDay: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const through = period === `${today.slice(0, 7)}-01` && lastDay ? Number(lastDay.slice(8, 10)) : monthEnd(period);
  await q(`insert into sop_review_periods (period, through_day, label) values ($1,$2,'') on conflict (period) do update set through_day = greatest(sop_review_periods.through_day, excluded.through_day)`, [period, through]);
}

type Sum = { south: number; north: number; orders: number; last: string | null };
const bump = (m: Map<string, Sum>, key: string, region: Region | null, items: number, orders = 0, last: string | null = null) => {
  const s = m.get(key) ?? { south: 0, north: 0, orders: 0, last: null };
  if (region === "south") s.south += items; else if (region === "north") s.north += items;
  s.orders += orders;
  if (last && (!s.last || last > s.last)) s.last = last;
  m.set(key, s);
};

async function runB2C(): Promise<{ read: number; written: number }> {
  const rows = await sfQuery<{ month: string; marketplace: string; region: Region | null; item_count: number; order_count: number; last_day: string | null }>(FEEDS.b2c.sql);
  const keep = rows.filter((r) => r.month >= FROM());
  const by = new Map<string, Sum>(); // period|label
  const lines = new Map<string, { items: number; orders: number }>(); // period|channel
  for (const r of keep) {
    const label = await reviewLabel("b2c", r.month, r.marketplace);
    bump(by, `${r.month}|${label}`, r.region, n(r.item_count), n(r.order_count), r.last_day);
    const ch = norm(r.marketplace) === "cocoblu" ? "Amazon" : label.replace(" (Items)", "");
    const l = lines.get(`${r.month}|${ch}`) ?? { items: 0, orders: 0 };
    l.items += n(r.item_count); l.orders += n(r.order_count); lines.set(`${r.month}|${ch}`, l);
  }
  let written = 0;
  const lastByMonth = new Map<string, string | null>();
  for (const [k, s] of by) {
    const [period, label] = k.split("|");
    await writeActual("b2c", period, label, label.startsWith("Shopify") ? null : "Marketplace", s.south, s.north);
    if (!lastByMonth.get(period) || (s.last ?? "") > (lastByMonth.get(period) ?? "")) lastByMonth.set(period, s.last);
    written++;
  }
  for (const [p, last] of lastByMonth) await markThrough(p, last);
  // projection lines: "<Channel> · items" / "<Channel> · orders" in the B2C streams
  for (const [k, v] of lines) {
    const [period, ch] = k.split("|");
    for (const [metric, val] of [["items", v.items], ["orders", v.orders]] as const) {
      const line = await one<{ id: string }>(
        `select l.id from sop_lines l join sop_streams s on s.id = l.stream_id where s.name in ('B2C-SF','B2C-MP') and lower(l.name) = lower($1)`, [`${ch} · ${metric}`]);
      if (!line) continue;
      await q(`insert into sop_values (line_id, period, period_label, dimension, actual, actual_source) values ($1,$2,'','',$3,'snowflake')
               on conflict (line_id, period, period_label, dimension) do update set actual = excluded.actual, actual_source = 'snowflake', updated_at = now()`, [line.id, period, val]);
      written++;
    }
  }
  return { read: rows.length, written };
}

async function runB2BMP(): Promise<{ read: number; written: number }> {
  const rows = await sfQuery<{ month: string; marketplace: string; region: Region | null; item_count: number; last_day: string | null }>(FEEDS.b2b_mp.sql);
  const by = new Map<string, Sum>();
  for (const r of rows.filter((x) => x.month >= FROM() && x.marketplace)) bump(by, `${r.month}|${await reviewLabel("b2b_mp", r.month, r.marketplace)}`, r.region, n(r.item_count), 0, r.last_day);
  for (const [k, s] of by) { const [period, label] = k.split("|"); await writeActual("b2b_mp", period, label, null, s.south, s.north); }
  return { read: rows.length, written: by.size };
}

async function runRetail(): Promise<{ read: number; written: number }> {
  const rows = await sfQuery<{ day: string; region: Region | null; item_count: number }>(FEEDS.retail.sql);
  const by = new Map<string, Sum>();
  for (const r of rows.filter((x) => x.day >= FROM())) bump(by, `${r.day.slice(0, 7)}-01|${weekOfMonth(r.day)}`, r.region, n(r.item_count), 0, r.day);
  for (const [k, s] of by) { const [period, label] = k.split("|"); await writeActual("retail_fwd", period, label, null, s.south, s.north); }
  return { read: rows.length, written: by.size };
}

/** Day rows → week-of-month rows of a weekly review view. */
async function runWeekly(view: string, sql: string): Promise<{ read: number; written: number }> {
  const rows = await sfQuery<{ day: string; region: string | null; qty: number }>(sql);
  const by = new Map<string, Sum>();
  for (const r of rows.filter((x) => x.day >= FROM())) bump(by, `${r.day.slice(0, 7)}-01|${weekOfMonth(r.day)}`, (r.region?.toLowerCase() ?? null) as Region | null, n(r.qty), 0, r.day);
  for (const [k, s] of by) { const [period, label] = k.split("|"); await writeActual(view, period, label, null, s.south, s.north); }
  return { read: rows.length, written: by.size };
}

async function runCategoryView(): Promise<{ read: number; written: number }> {
  const rows = await sfQuery<{ month: string; region: string | null; category: string; qty: number }>(FEEDS.category_view.sql);
  const by = new Map<string, Sum>();
  for (const r of rows.filter((x) => x.month >= FROM() && x.category)) bump(by, `${r.month}|${r.category}`, (r.region?.toLowerCase() ?? null) as Region | null, n(r.qty));
  for (const [k, s] of by) { const [period, label] = k.split("|"); await writeActual("category_view", period, label, null, s.south, s.north); }
  return { read: rows.length, written: by.size };
}

/** B2B returns = store / retail / B2B / marketplace-B2B return types; everything else counts as B2C. */
export const isB2BReturn = (t: string) => /b2b|store|retail|rto.?b2b|sor/i.test(t);
async function runReturns(): Promise<{ read: number; written: number; types: string[] }> {
  const rows = await sfQuery<{ month: string; final_type: string; region: string; qty: number }>(FEEDS.returns.sql);
  const by = new Map<string, { b2c: number; b2b: number }>();
  for (const r of rows.filter((x) => x.month >= FROM())) {
    const k = `${r.month}|${r.region === "north" ? "North" : "South"}`;
    const cur = by.get(k) ?? { b2c: 0, b2b: 0 };
    if (isB2BReturn(r.final_type ?? "")) cur.b2b += n(r.qty); else cur.b2c += n(r.qty);
    by.set(k, cur);
  }
  for (const [k, v] of by) {
    const [period, wh] = k.split("|");
    await q(`insert into sop_returns (period, warehouse, b2c, b2b) values ($1,$2,$3,$4) on conflict (period, warehouse) do update set b2c = excluded.b2c, b2b = excluded.b2b`, [period, wh, v.b2c, v.b2b]);
  }
  return { read: rows.length, written: by.size, types: [...new Set(rows.map((r) => `${r.final_type} → ${isB2BReturn(r.final_type ?? "") ? "B2B" : "B2C"}`))] };
}

const RUN: Record<FeedKey, () => Promise<{ read: number; written: number; types?: string[] }>> = {
  b2c: runB2C, b2b_mp: runB2BMP, retail: runRetail,
  category_inward: () => runWeekly("category_inward", FEEDS.category_inward.sql),
  prepack: () => runWeekly("prepack", FEEDS.prepack.sql),
  category_view: runCategoryView, returns: runReturns,
};

/** Run one feed or all, logging each run. Never throws — failures are recorded on the run. */
export async function runSync(feeds: FeedKey[] = Object.keys(FEEDS) as FeedKey[], trigger: "manual" | "schedule" | "cron" = "manual", actorId: string | null = null) {
  const out: { feed: FeedKey; status: "ok" | "failed"; read?: number; written?: number; error?: string }[] = [];
  for (const feed of feeds) {
    const [run] = await q<{ id: string }>(`insert into sop_sync_runs (feed, trigger, from_date, actor_id) values ($1,$2,$3,$4) returning id`, [feed, trigger, FROM(), actorId]);
    try {
      if (!sfConfigured()) throw new Error("Snowflake isn't configured (SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME / SNOWFLAKE_PAT)");
      const r = await RUN[feed]();
      await q(`update sop_sync_runs set status = 'ok', rows_read = $2, rows_written = $3, message = $4, finished_at = now() where id = $1`, [run.id, r.read, r.written, r.types?.length ? `Return types: ${r.types.join("; ")}`.slice(0, 1000) : null]);
      out.push({ feed, status: "ok", read: r.read, written: r.written });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[sop-sync] ${feed} failed:`, msg);
      await q(`update sop_sync_runs set status = 'failed', message = $2, finished_at = now() where id = $1`, [run.id, msg.slice(0, 1000)]);
      out.push({ feed, status: "failed", error: msg });
    }
  }
  return out;
}

export const lastRuns = () => q<{ feed: string; status: string; trigger: string; rows_read: number | null; rows_written: number | null; message: string | null; started_at: string; finished_at: string | null }>(
  `select distinct on (feed) feed, status, trigger, rows_read, rows_written, message, started_at::text, finished_at::text from sop_sync_runs order by feed, started_at desc`);
