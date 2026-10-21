import "server-only";
import { one, q } from "../db";
import { sfConfigured, sfQuery } from "../snowflake";
import { weekOfMonth } from "@/lib/sopWeeks";

/**
 * Snowflake → S&OP, daily grain. Each feed pulls one row per day (× channel / category / region) from FY27 start
 * (SOP_SYNC_FROM) into sop_actuals_daily; rebuild() then derives every weekly / monthly / MTD number the review shows.
 * Plans are never touched. Queries are the S&OP team's (Oct 2026), only re-grained to days.
 *
 * Pre-packs: a SKU like "PP4-…" is one pack holding 4 pieces → units = quantity × 4 (packs and units are both kept).
 * Inventory: daily stock by warehouse from SNOWFLAKE_INVENTORY_TABLE; pre-pack stock is kept apart (separate area,
 * not part of WH capacity).
 */
export const FROM = () => process.env.SOP_SYNC_FROM ?? "2026-04-01";
const INV_TABLE = () => process.env.SNOWFLAKE_INVENTORY_TABLE ?? "snitch_db.maplemonk.snitch_final_inventory_wh2";
const SLA_TABLE = "maplemonk.warehouse_sla_performance";
const PUT_TABLE = "snitch_db.maplemonk.putaway_tracking";

/* ------------------------------------------------------------------ */
/* Column discovery (we can't see the schema up front)                 */
/* ------------------------------------------------------------------ */
type Cols = { name: string; type: string }[];
const quote = (c: string) => (/^[A-Z_][A-Z0-9_$]*$/.test(c) ? c : `"${c.replace(/"/g, '""')}"`);
async function describe(table: string): Promise<Cols> {
  const rows = await sfQuery<{ name: string; type: string }>(`DESCRIBE TABLE ${table}`);
  return rows.map((r) => ({ name: String(r.name), type: String(r.type) }));
}
/** First column whose name matches one of the exact candidates (case-insensitive), else the first regex hit. */
function pick(cols: Cols, exact: string[], re?: RegExp, typeRe?: RegExp): string | null {
  const ok = (c: Cols[number]) => !typeRe || typeRe.test(c.type);
  for (const e of exact) { const c = cols.find((x) => x.name.toLowerCase() === e.toLowerCase() && ok(x)); if (c) return c.name; }
  if (re) { const c = cols.find((x) => re.test(x.name) && ok(x)); if (c) return c.name; }
  return null;
}
export interface SchemaInfo { table: string; columns: string[]; picked: Record<string, string | null>; checkedAt: string }
async function saveSchema(key: string, info: SchemaInfo) {
  await q(`insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [`sop.schema.${key}`, JSON.stringify(info)]);
}
export async function schemaInfo() {
  const rows = await q<{ key: string; value: SchemaInfo }>(`select key, value from app_settings where key like 'sop.schema.%'`);
  return Object.fromEntries(rows.map((r) => [r.key.replace("sop.schema.", ""), r.value])) as Record<string, SchemaInfo>;
}

/** Pre-pack multiplier SQL: PP4-… → 4, anything else → 1. */
const mult = (sku: string | null) => (sku ? `CASE WHEN ${sku} LIKE 'PP%' THEN COALESCE(TRY_TO_NUMBER(REGEXP_SUBSTR(${sku}, '^PP([0-9]+)', 1, 1, 'e', 1)), 1) ELSE 1 END` : "1");

/* ------------------------------------------------------------------ */
/* Feed definitions                                                    */
/* ------------------------------------------------------------------ */
const SLA_REGION = `CASE WHEN warehouse_name IN ('SAPL-WH2','SAPL-WH1') THEN 'south' WHEN warehouse_name IN ('SAPL-NORTH-TAURU') THEN 'north' ELSE 'other' END`;
const SLA_BASE = `warehouse_name IN ('SAPL-WH2','SAPL-WH1','SAPL-NORTH-TAURU') AND packed_time IS NOT NULL AND sla_status NOT IN ('CANCELLED')`;
const PUT_REGION = `CASE WHEN "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2') THEN 'south' WHEN "Warehouse Name" IN ('SAPL-NORTH-TAURU') THEN 'north' ELSE 'other' END`;
const PUT_SKU = `"Item Type skuCode"`;
const B2B_MP_EXCLUDE = `'COCOBLU','AMAZON','AJIO','FLIPKART','MYNTRA','SHOPIFY','NYKAA.COM','NYKAA_FASHION','CUSTOM','OWN_STORE_B2B','B2B CORPORATE CHANNEL','STORE','SNITCH HQ','SAPL_WH_TRANSFERS','B2B_SNITCH','RK_WORLD'`;

/** Outward (dispatch) feeds share one shape: distinct sale-order items per day, with pre-pack units. */
const outwardSql = (marketplace: string, where: string, sku: string | null) => `WITH x AS (
  SELECT DISTINCT saleorderitemcode, order_name,
    TO_VARCHAR(packed_time::date, 'YYYY-MM-DD') AS day,
    ${marketplace} AS label,
    ${SLA_REGION} AS region,
    ${mult(sku)} AS mult
  FROM ${SLA_TABLE}
  WHERE ${where}
    AND ${SLA_BASE}
    AND packed_time >= '${FROM()}'
)
SELECT day, label, region, COUNT(*) AS qty, SUM(mult) AS units, COUNT(DISTINCT order_name) AS orders
FROM x GROUP BY 1, 2, 3`;

// putaway is dated by the putaway-updated column (found with DESCRIBE), never the completed / created date
const putawaySql = (D: string, labelSql: string, where: string) => `SELECT TO_VARCHAR(${D}::date, 'YYYY-MM-DD') AS day,
  ${labelSql} AS label,
  ${PUT_REGION} AS region,
  SUM(putaway_completed_quantity) AS qty,
  SUM(putaway_completed_quantity * ${mult(PUT_SKU)}) AS units
FROM ${PUT_TABLE}
WHERE ${where}
  AND ${D} >= '${FROM()}'
GROUP BY 1, 2, 3`;

const CATEGORY_BUCKET = `CASE TRIM(LOWER(category))
    WHEN 't-shirts' THEN 'T-Shirts' WHEN 'joggers & trackpants' THEN 'Joggers & Trackpants' WHEN 'sweatshirts' THEN 'Sweatshirts'
    WHEN 'sweater' THEN 'Sweater' WHEN 'accessories' THEN 'Accessories' WHEN 'shirts' THEN 'Shirts' WHEN 'jackets' THEN 'Jackets'
    WHEN 'blazers' THEN 'Blazers' WHEN 'sunglasses' THEN 'Sunglasses' WHEN 'overshirt' THEN 'Overshirt' WHEN 'hoodies' THEN 'Hoodies'
    WHEN 'trousers' THEN 'Trousers' WHEN 'cargo pants' THEN 'Cargo Pants' WHEN 'jeans' THEN 'Jeans' WHEN 'chinos' THEN 'Chinos'
    WHEN 'shorts' THEN 'Shorts' WHEN 'trouser' THEN 'Trousers' WHEN 'sweaters' THEN 'Sweaters' WHEN 'socks' THEN 'Socks' WHEN 'bags' THEN 'Bags'
    WHEN 'trackpants' THEN 'Joggers & Trackpants' WHEN 'perfumes' THEN 'Perfumes' WHEN 'shoes' THEN 'Shoes' WHEN 'joggers' THEN 'Joggers & Trackpants'
    WHEN 'belts' THEN 'Accessories' ELSE INITCAP(TRIM(LOWER(category))) END`;

export interface FeedDef {
  title: string; source: string; grain: string; conditions: string[]; transforms: string[]; fills: string[];
  sql: (ctx: { slaSku: string | null; putDate: string }) => string;
}
export const FEEDS: Record<string, FeedDef> = {
  b2c: {
    title: "B2C outward", source: SLA_TABLE, grain: "day × marketplace × region",
    conditions: ["MARKETPLACE_MAPPED in AJIO, AMAZON, FLIPKART, MYNTRA, SHOPIFY, NYKAA.COM, NYKAA_FASHION, COCOBLU", "warehouse SAPL-WH1/WH2 (South), SAPL-NORTH-TAURU (North)", "packed_time not null, sla_status ≠ CANCELLED", "day = packed_time date"],
    transforms: ["NYKAA.COM + NYKAA_FASHION → Nykaa", "AMAZON + COCOBLU → Amazon", "items = distinct saleorderitemcode; orders = distinct order_name", "pre-pack SKUs expanded to units (when the table has a SKU column)"],
    fills: ["Monthly review › B2C channels (items, South/North)", "Projection lines ‹channel› · items / · orders (actuals)", "Returns rate denominator (B2C forward)", "Inventory flow outward"],
    sql: ({ slaSku }) => outwardSql(`CASE WHEN MARKETPLACE_MAPPED IN ('NYKAA_FASHION','NYKAA.COM') THEN 'NYKAA' WHEN MARKETPLACE_MAPPED IN ('AMAZON','COCOBLU') THEN 'AMAZON' ELSE MARKETPLACE_MAPPED END`,
      `MARKETPLACE_MAPPED IN ('AJIO','AMAZON','FLIPKART','MYNTRA','SHOPIFY','NYKAA.COM','NYKAA_FASHION','COCOBLU')`, slaSku),
  },
  b2b_mp: {
    title: "B2B marketplace outward", source: SLA_TABLE, grain: "day × marketplace × region",
    conditions: [`MARKETPLACE_MAPPED not in ${B2B_MP_EXCLUDE.replace(/'/g, "")}`, "same warehouse / packed / cancelled rules as B2C"],
    transforms: ["M_NOW_WESTBENGAL + M-NOW → M-Now", "AMAZON excluded here (it is B2C)", "marketplace names matched to the workbook's B2B rows", "pre-pack units as above"],
    fills: ["Monthly review › B2B-MP channels", "Inventory flow outward"],
    sql: ({ slaSku }) => outwardSql(`CASE WHEN MARKETPLACE_MAPPED IN ('M_NOW_WESTBENGAL','M-NOW') THEN 'M-NOW' ELSE MARKETPLACE_MAPPED END`, `MARKETPLACE_MAPPED NOT IN (${B2B_MP_EXCLUDE})`, slaSku),
  },
  retail: {
    title: "B2B retail (store) outward", source: SLA_TABLE, grain: "day × region",
    conditions: ["MARKETPLACE_MAPPED = STORE", "same warehouse / packed / cancelled rules"],
    transforms: ["days grouped into the workbook's weeks (Monday-start, cut at month end)", "pre-pack units as above"],
    fills: ["Monthly review › Retail forward (weekly)", "Store-returns rate denominator", "Inventory flow outward"],
    sql: ({ slaSku }) => outwardSql(`'STORE'`, `MARKETPLACE_MAPPED IN ('STORE')`, slaSku),
  },
  category_inward: {
    title: "Category inward (new inward putaway)", source: PUT_TABLE, grain: "day × region",
    conditions: ["putaway_type = PUTAWAY_GRN_ITEM", "final_type = New Inward", "Warehouse Name in SAPL-WH1/WH2/NORTH-TAURU", "category ≠ NON- TRADING, is_trading = TRUE", "day = putaway updated date (column detected — see below)"],
    transforms: ["units = putaway_completed_quantity × pre-pack size (PP4-… = 4)", "weeks as above"],
    fills: ["Monthly review › Category inward (weekly)", "Inventory flow inward (category)"],
    sql: ({ putDate }) => putawaySql(putDate, `''`, `putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND category NOT IN ('NON- TRADING') AND is_trading = TRUE`),
  },
  prepack: {
    title: "Pre-pack inward (kits)", source: PUT_TABLE, grain: "day × region",
    conditions: ["as Category inward, plus Item Type skuCode LIKE 'PP%'"],
    transforms: ["packs = putaway_completed_quantity; units = packs × pre-pack size", "weeks as above"],
    fills: ["Monthly review › Pre-pack (weekly, units)"],
    sql: ({ putDate }) => putawaySql(putDate, `''`, `putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward') AND ${PUT_SKU} LIKE 'PP%' AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND category NOT IN ('NON- TRADING') AND is_trading = TRUE`),
  },
  category_view: {
    title: "Category-wise inward", source: PUT_TABLE, grain: "day × category × region",
    conditions: ["putaway_type = PUTAWAY_GRN_ITEM, final_type = New Inward", "Warehouse Name in SAPL-WH1/WH2/NORTH-TAURU", "categories Hoodies, Carry Bag, Non- Trading dropped (as in your query; no is_trading filter)"],
    transforms: ["your category buckets (trouser → Trousers, joggers / trackpants → Joggers & Trackpants, belts → Accessories …)", "units = quantity × pre-pack size"],
    fills: ["Monthly review › Category-wise inward"],
    sql: ({ putDate }) => `SELECT * FROM (${putawaySql(putDate, CATEGORY_BUCKET, `putaway_type = 'PUTAWAY_GRN_ITEM' AND final_type IN ('New Inward') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')`)}) WHERE label NOT IN ('Hoodies','Carry Bag','Non- Trading')`,
  },
  returns: {
    title: "Returns (putaway)", source: PUT_TABLE, grain: "day × final_type × region",
    conditions: ["final_type LIKE '%Return%'", "is_trading = TRUE, category_group NOT LIKE '%NON%'", "region: Warehouse Name containing NORTH → North, else South", "day = putaway updated date"],
    transforms: ["final_type containing B2B / Store / Retail / SOR → B2B returns, the rest → B2C", "units = quantity × pre-pack size"],
    fills: ["Monthly review › Returns (+ return rate vs B2C and retail forward)", "Inventory flow inward (returns)"],
    sql: ({ putDate }) => `SELECT TO_VARCHAR(${putDate}::date, 'YYYY-MM-DD') AS day, final_type AS label,
  CASE WHEN "Warehouse Name" LIKE '%NORTH%' THEN 'north' ELSE 'south' END AS region,
  SUM(putaway_completed_quantity) AS qty, SUM(putaway_completed_quantity * ${mult(PUT_SKU)}) AS units
FROM ${PUT_TABLE}
WHERE final_type LIKE '%Return%' AND is_trading = TRUE AND category_group NOT LIKE '%NON%' AND ${putDate} >= '${FROM()}'
GROUP BY 1, 2, 3`,
  },
};
export type FeedKey = keyof typeof FEEDS | "inventory";
export const INVENTORY_FEED = {
  title: "Warehouse inventory (daily)", grain: "day × warehouse",
  conditions: ["warehouses SAPL-WH1, SAPL-WH2 (South) and SAPL-NORTH-TAURU (North)", "columns detected automatically — see the detected columns below"],
  transforms: ["SKU LIKE 'PP%' → pre-pack stock: packs and units (× pre-pack size), kept OUT of capacity", "everything else → units against capacity (South 16L = WH1 + WH2, North 12L)", "month inventory = last day available in the month"],
  fills: ["Monthly review › Warehouse utilisation (+ pre-pack stock shown apart)", "Inventory flow opening / closing"],
};
export const ALL_FEEDS = [...Object.keys(FEEDS), "inventory"] as FeedKey[];

/* ------------------------------------------------------------------ */
/* Pull: Snowflake → daily facts                                       */
/* ------------------------------------------------------------------ */
type DailyRow = { day: string; label: string | null; region: string | null; qty: number; units: number; orders?: number | null };
const reg = (r: string | null) => { const x = (r ?? "").toLowerCase(); return x === "south" || x === "north" ? x : "other"; };

async function saveDaily(feed: string, rows: DailyRow[]) {
  await q(`delete from sop_actuals_daily where feed = $1 and day >= $2`, [feed, FROM()]);
  // aggregate first so (day, label, region) is unique
  const m = new Map<string, { day: string; label: string; region: string; qty: number; units: number; orders: number | null }>();
  for (const r of rows) {
    if (!r.day || r.day < FROM()) continue;
    const k = `${r.day}|${r.label ?? ""}|${reg(r.region)}`;
    const cur = m.get(k) ?? { day: r.day, label: r.label ?? "", region: reg(r.region), qty: 0, units: 0, orders: r.orders == null ? null : 0 };
    cur.qty += Number(r.qty) || 0; cur.units += Number(r.units ?? r.qty) || 0;
    if (r.orders != null) cur.orders = (cur.orders ?? 0) + (Number(r.orders) || 0);
    m.set(k, cur);
  }
  const v = [...m.values()];
  for (let i = 0; i < v.length; i += 2000) {
    const c = v.slice(i, i + 2000);
    await q(`insert into sop_actuals_daily (day, feed, label, region, qty, units, orders)
             select d::date, $1, l, r, qn, u, o from unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[]) as t(d, l, r, qn, u, o)`,
      [feed, c.map((x) => x.day), c.map((x) => x.label), c.map((x) => x.region), c.map((x) => x.qty), c.map((x) => x.units), c.map((x) => x.orders)]);
  }
  return v.length;
}

/** The putaway table's "putaway updated" timestamp — every putaway feed is dated by it. */
async function putawayDateColumn(): Promise<string> {
  const cols = await describe(PUT_TABLE);
  const d = pick(cols, ["PUTAWAY_UPDATED", "PUTAWAY_UPDATED_AT", "PUTAWAY_UPDATED_DATE", "PUTAWAY_UPDATED_TIME", "PUTAWAY_UPDATED_ON", "Putaway Updated", "Putaway Updated At", "Putaway Updated Date"], /putaway.?updat/i);
  await saveSchema("putaway", { table: PUT_TABLE, columns: cols.map((c) => c.name), picked: { date: d }, checkedAt: new Date().toISOString() });
  if (!d) throw new Error(`No "putaway updated" column found in ${PUT_TABLE}. Columns: ${cols.map((c) => c.name).join(", ")}`);
  return quote(d);
}

async function slaSkuColumn(): Promise<string | null> {
  const cols = await describe(SLA_TABLE);
  const sku = pick(cols, ["SKU", "SKU_CODE", "SKUCODE", "ITEM_SKU_CODE", "ITEM_SKU", "SELLER_SKU_CODE", "CHANNEL_SKU_CODE"], /sku/i);
  await saveSchema("sla", { table: SLA_TABLE, columns: cols.map((c) => c.name), picked: { sku }, checkedAt: new Date().toISOString() });
  return sku ? quote(sku) : null;
}

async function pullInventory(): Promise<{ read: number; written: number; note: string }> {
  const t = INV_TABLE();
  const cols = await describe(t);
  const date = pick(cols, ["DATE", "INVENTORY_DATE", "SNAPSHOT_DATE", "AS_ON_DATE", "AS_OF_DATE", "REPORT_DATE", "INV_DATE", "STOCK_DATE", "CREATED_DATE"], /date|_dt$|day/i, /date|time/i);
  const wh = pick(cols, ["WAREHOUSE_NAME", "Warehouse Name", "FACILITY", "FACILITY_NAME", "WAREHOUSE", "FACILITY_CODE", "WAREHOUSE_CODE"], /ware|facil/i);
  const sku = pick(cols, ["SKU", "SKU_CODE", "SKUCODE", "Item Type skuCode", "ITEM_SKU_CODE", "ITEM_SKU"], /sku/i);
  const qty = pick(cols, ["INVENTORY", "TOTAL_INVENTORY", "QUANTITY", "QTY", "INVENTORY_QTY", "TOTAL_QTY", "ON_HAND", "AVAILABLE_INVENTORY", "GOOD_INVENTORY"], /inv|qty|quant|stock/i, /number|int|float|decimal|numeric/i);
  await saveSchema("inventory", { table: t, columns: cols.map((c) => c.name), picked: { date, warehouse: wh, sku, quantity: qty }, checkedAt: new Date().toISOString() });
  const missing = Object.entries({ date, warehouse: wh, sku, quantity: qty }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Couldn't identify the ${missing.join(", ")} column in ${t}. Columns: ${cols.map((c) => c.name).join(", ")}`);
  const [D, W, S, Q] = [quote(date!), quote(wh!), quote(sku!), quote(qty!)];
  const from = new Date(new Date(`${FROM()}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10); // + the day before, for April's opening
  const rows = await sfQuery<{ day: string; warehouse: string; units: number; prepack_packs: number; prepack_units: number }>(
    `SELECT TO_VARCHAR(${D}::date, 'YYYY-MM-DD') AS day, ${W} AS warehouse,
       SUM(CASE WHEN ${S} LIKE 'PP%' THEN 0 ELSE ${Q} END) AS units,
       SUM(CASE WHEN ${S} LIKE 'PP%' THEN ${Q} ELSE 0 END) AS prepack_packs,
       SUM(CASE WHEN ${S} LIKE 'PP%' THEN ${Q} * ${mult(S)} ELSE 0 END) AS prepack_units
     FROM ${t}
     WHERE ${W} IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND ${D}::date >= '${from}'
     GROUP BY 1, 2`);
  await q(`delete from sop_inventory_daily where day >= $1`, [from]);
  for (const r of rows) {
    const region = /NORTH/i.test(r.warehouse) ? "north" : "south";
    await q(`insert into sop_inventory_daily (day, warehouse, region, units, prepack_packs, prepack_units) values ($1,$2,$3,$4,$5,$6)
             on conflict (day, warehouse) do update set units = excluded.units, prepack_packs = excluded.prepack_packs, prepack_units = excluded.prepack_units`,
      [r.day, r.warehouse, region, Number(r.units) || 0, Number(r.prepack_packs) || 0, Number(r.prepack_units) || 0]);
  }
  return { read: rows.length, written: rows.length, note: `columns: date=${date}, warehouse=${wh}, sku=${sku}, qty=${qty}` };
}

/* ------------------------------------------------------------------ */
/* Rebuild: daily facts → review rows, returns, inventory, flow        */
/* ------------------------------------------------------------------ */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const B2C_LABEL: Record<string, string> = { myntra: "Myntra", flipkart: "Flipkart", amazon: "Amazon", ajio: "AJIO", nykaa: "Nykaa", shopify: "Shopify (Items)" };
export const isB2BReturn = (t: string) => /b2b|store|retail|sor/i.test(t);

/** Daily fact → the review view and row it belongs to (same mapping rebuild() writes). */
export function viewOf(feed: string, label: string, day: string, knownB2B: string[]): { view: string; label: string } | null {
  if (feed === "b2c") return { view: "b2c", label: B2C_LABEL[norm(label)] ?? label };
  if (feed === "b2b_mp") return { view: "b2b_mp", label: b2bLabelSync(label, knownB2B) };
  if (feed === "retail") return { view: "retail_fwd", label: weekOfMonth(day) };
  if (feed === "category_inward" || feed === "prepack") return { view: feed, label: weekOfMonth(day) };
  if (feed === "category_view") return { view: "category_view", label };
  return null;
}
function b2bLabelSync(mp: string, known: string[]) {
  const k = norm(mp);
  return known.find((l) => norm(l) === k) ?? known.find((l) => k.includes(norm(l)) || norm(l).includes(k))
    ?? (k.includes("mnow") ? known.find((l) => norm(l) === "mnow") : undefined)
    ?? (k.includes("myntra") ? known.find((l) => norm(l).includes("myntra")) : undefined)
    ?? (k.includes("flipkart") ? known.find((l) => norm(l).includes("flipkart")) : undefined)
    ?? mp.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
const b2bLabel = async (mp: string, known: string[]) => b2bLabelSync(mp, known);

/** Write actual South/North; the first time Snowflake touches a row the workbook's figures are kept for reconciliation. */
async function writeActual(view: string, period: string, label: string, group: string | null, south: number, north: number) {
  await q(`insert into sop_review_rows (view_key, period, row_label, row_group, sort, south_plan, south_actual, north_plan, north_actual, actual_source)
           values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from sop_review_rows where view_key = $1 and period = $2),null,$5,null,$6,'snowflake')
           on conflict (view_key, period, row_label) do update set
             wb_south_actual = coalesce(sop_review_rows.wb_south_actual, case when sop_review_rows.actual_source is null then sop_review_rows.south_actual end),
             wb_north_actual = coalesce(sop_review_rows.wb_north_actual, case when sop_review_rows.actual_source is null then sop_review_rows.north_actual end),
             south_actual = excluded.south_actual, north_actual = excluded.north_actual, actual_source = 'snowflake'`,
    [view, period, label, group, Math.round(south), Math.round(north)]);
}

type Agg = { south: number; north: number };
const add = (m: Map<string, Agg>, k: string, region: string, v: number) => { const a = m.get(k) ?? { south: 0, north: 0 }; if (region === "south") a.south += v; else if (region === "north") a.north += v; m.set(k, a); };

export async function rebuild() {
  const from = FROM();
  // Amazon and Cocoblu are one B2C channel: "Amazon"
  await q(`update sop_review_rows r set row_label = 'Amazon' where view_key = 'b2c' and row_label = 'Cocoblu'
           and not exists (select 1 from sop_review_rows x where x.view_key = 'b2c' and x.period = r.period and x.row_label = 'Amazon')`);
  const daily = await q<{ day: string; feed: string; label: string; region: string; units: number; orders: number | null }>(
    `select day::text as day, feed, label, region, units, orders from sop_actuals_daily where day >= $1`, [from]);
  const feeds = new Set(daily.map((d) => d.feed));
  const month = (d: string) => `${d.slice(0, 7)}-01`;

  // --- channel / category / weekly views
  const views = new Map<string, Map<string, Agg>>(); // view → "period|label" → agg
  const v = (name: string) => { if (!views.has(name)) views.set(name, new Map()); return views.get(name)!; };
  const known = (await q<{ row_label: string }>(`select distinct row_label from sop_review_rows where view_key = 'b2b_mp'`)).map((r) => r.row_label);
  const lines = new Map<string, { items: number; orders: number }>();
  for (const d of daily) {
    const p = month(d.day);
    if (d.feed === "b2c") {
      const label = B2C_LABEL[norm(d.label)] ?? d.label;
      add(v("b2c"), `${p}|${label}`, d.region, Number(d.units));
      const ch = label.replace(" (Items)", ""), k = `${p}|${ch}`;
      const l = lines.get(k) ?? { items: 0, orders: 0 }; l.items += Number(d.units); l.orders += Number(d.orders ?? 0); lines.set(k, l);
    } else if (d.feed === "b2b_mp") add(v("b2b_mp"), `${p}|${await b2bLabel(d.label, known)}`, d.region, Number(d.units));
    else if (d.feed === "retail") add(v("retail_fwd"), `${p}|${weekOfMonth(d.day)}`, d.region, Number(d.units));
    else if (d.feed === "category_inward") add(v("category_inward"), `${p}|${weekOfMonth(d.day)}`, d.region, Number(d.units));
    else if (d.feed === "prepack") add(v("prepack"), `${p}|${weekOfMonth(d.day)}`, d.region, Number(d.units));
    else if (d.feed === "category_view") add(v("category_view"), `${p}|${d.label}`, d.region, Number(d.units));
  }
  let written = 0;
  for (const [view, m] of views) for (const [k, a] of m) {
    const [p, label] = k.split("|");
    await writeActual(view, p, label, view === "b2c" ? (label.startsWith("Shopify") ? null : "Marketplace") : null, a.south, a.north);
    written++;
  }
  // projection lines (orders + items) for the B2C streams
  for (const [k, val] of lines) {
    const [p, ch] = k.split("|");
    for (const [metric, n] of [["items", val.items], ["orders", val.orders]] as const) {
      const line = await one<{ id: string }>(`select l.id from sop_lines l join sop_streams s on s.id = l.stream_id where s.name in ('B2C-SF','B2C-MP') and lower(l.name) = lower($1)`, [`${ch} · ${metric}`]);
      if (line) await q(`insert into sop_values (line_id, period, period_label, dimension, actual, actual_source) values ($1,$2,'','',$3,'snowflake')
                         on conflict (line_id, period, period_label, dimension) do update set actual = excluded.actual, actual_source = 'snowflake', updated_at = now()`, [line.id, p, Math.round(n)]);
    }
  }

  // --- months covered + MTD
  const lastDay = new Map<string, string>();
  for (const d of daily) { const p = month(d.day); if (!lastDay.get(p) || d.day > lastDay.get(p)!) lastDay.set(p, d.day); }
  const todayMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  for (const [p, last] of lastDay)
    await q(`insert into sop_review_periods (period, through_day, label) values ($1,$2,'') on conflict (period) do update set through_day = excluded.through_day`,
      [p, p === todayMonth ? Number(last.slice(8, 10)) : monthEnd(p)]);

  // --- returns (+ forward volumes for the rate)
  const ret = new Map<string, { b2c: number; b2b: number; fwdB2c: number; fwdRetail: number }>();
  const r = (k: string) => { if (!ret.has(k)) ret.set(k, { b2c: 0, b2b: 0, fwdB2c: 0, fwdRetail: 0 }); return ret.get(k)!; };
  for (const d of daily) {
    if (d.region === "other") continue;
    const k = `${month(d.day)}|${d.region === "north" ? "North" : "South"}`;
    if (d.feed === "returns") { if (isB2BReturn(d.label)) r(k).b2b += Number(d.units); else r(k).b2c += Number(d.units); }
    else if (d.feed === "b2c") r(k).fwdB2c += Number(d.units);
    else if (d.feed === "retail") r(k).fwdRetail += Number(d.units);
  }
  if (feeds.has("returns"))
    for (const [k, x] of ret) {
      const [p, wh] = k.split("|");
      await q(`insert into sop_returns (period, warehouse, b2c, b2b, fwd_b2c, fwd_retail, source) values ($1,$2,$3,$4,$5,$6,'snowflake')
               on conflict (period, warehouse) do update set b2c = excluded.b2c, b2b = excluded.b2b, fwd_b2c = excluded.fwd_b2c, fwd_retail = excluded.fwd_retail, source = 'snowflake'`,
        [p, wh, Math.round(x.b2c), Math.round(x.b2b), Math.round(x.fwdB2c) || null, Math.round(x.fwdRetail) || null]);
    }

  // --- inventory: month = last day available; pre-packs apart
  const inv = await q<{ day: string; region: string; units: number; prepack_units: number }>(
    `select day::text as day, region, sum(units)::float8 as units, sum(prepack_units)::float8 as prepack_units from sop_inventory_daily group by day, region order by day`);
  const invAt = new Map<string, { units: number; prepack: number }>(); // "day|region"
  for (const x of inv) invAt.set(`${x.day}|${x.region}`, { units: Number(x.units), prepack: Number(x.prepack_units) });
  const invDays = [...new Set(inv.map((x) => x.day))].sort();
  const lastInvIn = (p: string) => invDays.filter((d) => d.startsWith(p.slice(0, 7))).at(-1);
  const months = [...new Set(invDays.map((d) => month(d)))].filter((p) => p >= from);
  for (const p of months) {
    const d = lastInvIn(p)!;
    for (const [region, wh, cap] of [["south", "South", 1600000], ["north", "North", 1200000]] as const) {
      const at = invAt.get(`${d}|${region}`);
      if (!at) continue;
      await q(`insert into sop_wh_capacity (period, warehouse, capacity, inventory, prepack_units, inventory_source) values ($1,$2,$3,$4,$5,'snowflake')
               on conflict (period, warehouse) do update set inventory = excluded.inventory, prepack_units = excluded.prepack_units, inventory_source = 'snowflake'`,
        [p, wh, cap, Math.round(at.units), Math.round(at.prepack)]);
    }
  }

  // --- inventory flow: opening = last stock before the month, closing = last stock in it; inward / outward from the feeds
  if (months.length) {
    const flowIn = new Map<string, { cat: number; ret: number; out: number }>();
    const f = (k: string) => { if (!flowIn.has(k)) flowIn.set(k, { cat: 0, ret: 0, out: 0 }); return flowIn.get(k)!; };
    for (const d of daily) {
      if (d.region === "other") continue;
      const k = `${month(d.day)}|${d.region}`;
      if (d.feed === "category_inward") f(k).cat += Number(d.units);
      else if (d.feed === "returns") f(k).ret += Number(d.units);
      else if (d.feed === "b2c" || d.feed === "b2b_mp" || d.feed === "retail") f(k).out += Number(d.units);
    }
    for (const p of months) {
      const closeDay = lastInvIn(p)!;
      const openDay = invDays.filter((x) => x < p).at(-1) ?? invDays.find((x) => x.startsWith(p.slice(0, 7)));
      for (const [region, wh] of [["south", "South"], ["north", "North"]] as const) {
        const open = openDay ? invAt.get(`${openDay}|${region}`) : undefined, close = invAt.get(`${closeDay}|${region}`);
        if (!close) continue;
        const cap = (await one<{ capacity: number }>(`select capacity from sop_wh_capacity where period = $1 and warehouse = $2`, [p, wh]))?.capacity ?? (region === "south" ? 1600000 : 1200000);
        const x = flowIn.get(`${p}|${region}`) ?? { cat: 0, ret: 0, out: 0 };
        await q(`insert into sop_inventory_flow (period, warehouse, capacity, opening, inward_category, inward_returns, outward, closing, source) values ($1,$2,$3,$4,$5,$6,$7,$8,'snowflake')
                 on conflict (period, warehouse) do update set capacity = excluded.capacity, opening = excluded.opening, inward_category = excluded.inward_category,
                   inward_returns = excluded.inward_returns, outward = excluded.outward, closing = excluded.closing, source = 'snowflake'`,
          [p, wh, cap, open ? Math.round(open.units) : null, Math.round(x.cat), Math.round(x.ret), Math.round(x.out), Math.round(close.units)]);
      }
    }
  }
  return written;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */
export async function runSync(feeds: FeedKey[] = ALL_FEEDS, trigger: "manual" | "schedule" | "cron" = "manual", actorId: string | null = null) {
  const out: { feed: FeedKey; status: "ok" | "failed"; read?: number; written?: number; error?: string }[] = [];
  let slaSku: string | null | undefined;
  let putDate: string | undefined;
  for (const feed of feeds) {
    const [run] = await q<{ id: string }>(`insert into sop_sync_runs (feed, trigger, from_date, actor_id) values ($1,$2,$3,$4) returning id`, [feed, trigger, FROM(), actorId]);
    try {
      if (!sfConfigured()) throw new Error("Snowflake isn't configured (SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME / SNOWFLAKE_PAT)");
      let read = 0, written = 0, note: string | null = null;
      if (feed === "inventory") ({ read, written, note } = await pullInventory());
      else {
        if (["b2c", "b2b_mp", "retail"].includes(feed) && slaSku === undefined) slaSku = await slaSkuColumn().catch(() => null);
        if (["category_inward", "prepack", "category_view", "returns"].includes(feed) && putDate === undefined) putDate = await putawayDateColumn();
        const rows = await sfQuery<DailyRow>(FEEDS[feed].sql({ slaSku: slaSku ?? null, putDate: putDate ?? "" }));
        read = rows.length;
        written = await saveDaily(feed, rows);
        if (feed === "returns") note = `Return types: ${[...new Set(rows.map((x) => `${x.label} → ${isB2BReturn(x.label ?? "") ? "B2B" : "B2C"}`))].join("; ")}`;
        if (putDate && ["category_inward", "prepack", "category_view"].includes(feed)) note = `dated by ${putDate}`;
        if (["b2c", "b2b_mp", "retail"].includes(feed)) note = slaSku ? `pre-packs expanded via ${slaSku}` : "no SKU column found in the dispatch table — pre-packs counted as 1 unit";
      }
      await q(`update sop_sync_runs set status = 'ok', rows_read = $2, rows_written = $3, message = $4, finished_at = now() where id = $1`, [run.id, read, written, note?.slice(0, 1000) ?? null]);
      out.push({ feed, status: "ok", read, written });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[sop-sync] ${feed} failed:`, msg);
      await q(`update sop_sync_runs set status = 'failed', message = $2, finished_at = now() where id = $1`, [run.id, msg.slice(0, 1000)]);
      out.push({ feed, status: "failed", error: msg });
    }
  }
  if (out.some((o) => o.status === "ok")) await rebuild().catch((e) => console.error("[sop-sync] rebuild failed", e));
  return out;
}

export const lastRuns = () => q<{ feed: string; status: string; trigger: string; rows_read: number | null; rows_written: number | null; message: string | null; started_at: string; finished_at: string | null }>(
  `select distinct on (feed) feed, status, trigger, rows_read, rows_written, message, started_at::text, finished_at::text from sop_sync_runs order by feed, started_at desc`);
