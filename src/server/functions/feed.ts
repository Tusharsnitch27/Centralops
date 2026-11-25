import "server-only";
import { q, tx } from "../db";
import { sfQuery } from "../snowflake";
import { PLACEMENT_SQL, placementSla } from "./aggregate";
import { CAT, SITE, UC_STREAM } from "../wcm/feed";
import { LONG_TAIL, LONG_TAIL_KEY } from "./types";

/** Feeds for the AOP Functions view: store orders, handover rulebook, WAM inward. Read-only Snowflake; missing is null, never 0. */
const num = (v: unknown) => (v == null ? null : Number(v));
const chunks = <T,>(a: T[], n = 2000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** DISTRIBUTION_ANALYTICS repeats an order_name 2–4 times (same date / store / quantity, packages differ): one row per order. Rolling ~60 days. */
const ORDERS_SQL = `SELECT ORDER_NAME AS order_name, TO_VARCHAR(MAX(ORDER_DATE), 'YYYY-MM-DD') AS order_date,
  MAX(IFF(WAREHOUSE_NAME = 'SAPL-NORTH-TAURU', 'North', 'South')) AS site, MAX(STORE) AS store, MAX(RECEIVER_CITY) AS city,
  MAX(QUANTITY) AS quantity, MAX(PACKAGE_COUNT) AS packages, MAX(ORDER_TYPE) AS order_type, MAX(ORDER_PLACEMENT_SLA) AS placement_sla
FROM snitch_db.maplemonk.DISTRIBUTION_ANALYTICS WHERE ORDER_DATE >= TO_DATE('{from}') AND ORDER_NAME IS NOT NULL GROUP BY ORDER_NAME`;
/** retail_journey_spine: the same UC store orders from March 2026, with the rulebook's store names; placement judged from its order and cutoff times
 *  (PLACEMENT_SQL, 48-hour window) — its own ORDER_PLACEMENT_SLA is not used (BREACHED also turns up 2–3 days before the cutoff). */
const SPINE_ORDERS_SQL = `SELECT ORDER_NAME AS order_name, TO_VARCHAR(ORDER_DATE, 'YYYY-MM-DD') AS order_date, TO_VARCHAR(ORDER_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') AS order_ts,
  IFF(WAREHOUSE_NAME = 'SAPL-NORTH-TAURU', 'North', 'South') AS site, STORE AS store, RECEIVER_CITY AS city, QUANTITY AS quantity, PACKAGE_COUNT AS packages,
  ORDER_TYPE AS order_type, ${PLACEMENT_SQL} AS placement_sla
FROM snitch_db.maplemonk.retail_journey_spine
WHERE ORDER_DATE >= TO_DATE('{from}') AND ORDER_NAME IS NOT NULL AND WAREHOUSE_NAME IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
QUALIFY ROW_NUMBER() OVER (PARTITION BY ORDER_NAME ORDER BY LAST_UPDATED DESC NULLS LAST) = 1`;
type OrderRow = { order_name: string; order_date: string; order_ts?: string | null; site: string; store: string | null; city: string | null; quantity: number | null;
  packages: number | null; order_type: string | null; placement_sla: string | null };

/** Upsert orders; with keepFlag a row without its own placement flag keeps the one stored (DISTRIBUTION_ANALYTICS over the spine's); the spine's flag always replaces it. */
async function upsertOrders(rows: OrderRow[], keepFlag = true) {
  for (const c of chunks(rows)) {
    await q(`insert into fn_retail_order (order_name, order_date, site, store, city, quantity, packages, order_type, placement_sla)
             select * from unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[])
             on conflict (order_name) do update set order_date = excluded.order_date, site = excluded.site, store = excluded.store, city = excluded.city,
               quantity = excluded.quantity, packages = excluded.packages, order_type = excluded.order_type,
               placement_sla = ${keepFlag ? "coalesce(excluded.placement_sla, fn_retail_order.placement_sla)" : "excluded.placement_sla"}, fetched_at = now()`,
      [c.map((r) => r.order_name), c.map((r) => r.order_date), c.map((r) => r.site), c.map((r) => r.store), c.map((r) => r.city),
        c.map((r) => num(r.quantity)), c.map((r) => num(r.packages)), c.map((r) => r.order_type), c.map((r) => r.placement_sla)]);
  }
}

/**
 * Store orders: the spine from `from`, then DISTRIBUTION_ANALYTICS over it where both have the order. An order without the source's own
 * placement flag gets placementSla against the rulebook upload in force (FRESH* → FRESH cutoff, RPL → RPL, other types / stores the
 * rulebook doesn't list → null).
 */
export async function pullRetailOrders(from = "2026-04-01") {
  if (!isDay(from)) throw new Error("from must be YYYY-MM-DD");
  const [spine, da, rb] = await Promise.all([
    sfQuery<OrderRow>(SPINE_ORDERS_SQL.replaceAll("{from}", from)),
    sfQuery<OrderRow>(ORDERS_SQL.replaceAll("{from}", from)),
    q<{ upload: string; store: string; site: string; fc: string | null; rc: string | null }>(
      `select upload_date::text as upload, upper(trim(store)) as store, site, fresh_order_cutoff as fc, rpl_order_cutoff as rc from fn_rulebook`),
  ]);
  const uploads = [...new Set(rb.map((r) => r.upload))].sort(), rule = new Map(rb.map((r) => [`${r.upload}|${r.store}|${r.site}`, r]));
  const cutoff = (o: OrderRow) => {
    const up = uploads.filter((u) => u <= o.order_date).at(-1), r = up && o.store ? rule.get(`${up}|${o.store.trim().toUpperCase()}|${o.site}`) : undefined;
    const t = o.order_type?.toUpperCase() ?? "";
    return !r ? null : t.startsWith("FRESH") ? r.fc : t === "RPL" ? r.rc : null;
  };
  let computed = 0;
  for (const o of spine) {
    if (o.placement_sla || !o.order_ts) continue;
    o.placement_sla = placementSla(o.order_ts, { cutoff: cutoff(o) });
    if (o.placement_sla) computed++;
  }
  // one rule for every order: DISTRIBUTION_ANALYTICS' own flag (its older rule) only for orders the spine doesn't have
  const inSpine = new Set(spine.map((o) => o.order_name));
  for (const o of da) if (inSpine.has(o.order_name)) o.placement_sla = null;
  await upsertOrders(spine, false);
  await upsertOrders(da);
  return { read: spine.length + da.length, note: `${spine.length} spine + ${da.length} DISTRIBUTION_ANALYTICS store orders from ${from} (${computed} placement flags computed from the rulebook)` };
}

/** Every upload, one row per store × warehouse (the sheet lists each store once per warehouse). ZONE is '#REF!' in recent uploads → null. */
const RULEBOOK_SQL = `SELECT TO_VARCHAR(UPLOAD_DATE, 'YYYY-MM-DD') AS upload_date, STORE_NAME AS store, IFF(UPPER(WH) LIKE 'NORTH%', 'North', 'South') AS site,
  FRESH_QTY AS fresh_qty, RPL_QTY AS rpl_qty, FRESH_HANDOVER_DAY AS fresh_handover_day, RPL_HANDOVER_DAY AS rpl_handover_day,
  FRESH_TAT AS fresh_tat, RPL_TAT AS rpl_tat, IFF(UPPER(TRIM(ZONE)) IN ('NORTH', 'SOUTH'), UPPER(TRIM(ZONE)), NULL) AS zone,
  FRESH_ORDER_DAY AS fresh_order_day, FRESH_ORDER_CUTOFF AS fresh_order_cutoff, RPL_ORDER_DAY AS rpl_order_day, RPL_ORDER_CUTOFF AS rpl_order_cutoff
FROM snitch_db.maplemonk.DISTRIBUTION_RULEBOOK WHERE STORE_NAME IS NOT NULL AND UPLOAD_DATE IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY UPLOAD_DATE, STORE_NAME, IFF(UPPER(WH) LIKE 'NORTH%', 'North', 'South') ORDER BY FRESH_QTY DESC NULLS LAST) = 1`;
type RuleRow = { upload_date: string; store: string; site: string; fresh_qty: number | null; rpl_qty: number | null; fresh_handover_day: string | null;
  rpl_handover_day: string | null; fresh_tat: string | null; rpl_tat: string | null; zone: string | null;
  fresh_order_day: string | null; fresh_order_cutoff: string | null; rpl_order_day: string | null; rpl_order_cutoff: string | null };

export async function pullRulebook() {
  const rows = await sfQuery<RuleRow>(RULEBOOK_SQL);
  if (!rows.length) return { read: 0, note: "rulebook returned no rows — table kept" };
  await tx(async (t) => {
  await t.q(`delete from fn_rulebook`);
  for (const c of chunks(rows)) {
    await t.q(`insert into fn_rulebook (upload_date, store, site, fresh_qty, rpl_qty, fresh_handover_day, rpl_handover_day, fresh_tat, rpl_tat, zone,
               fresh_order_day, fresh_order_cutoff, rpl_order_day, rpl_order_cutoff)
             select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
               $11::text[], $12::text[], $13::text[], $14::text[])`,
      [c.map((r) => r.upload_date), c.map((r) => r.store), c.map((r) => r.site), c.map((r) => num(r.fresh_qty)), c.map((r) => num(r.rpl_qty)),
        c.map((r) => r.fresh_handover_day), c.map((r) => r.rpl_handover_day), c.map((r) => r.fresh_tat), c.map((r) => r.rpl_tat), c.map((r) => r.zone),
        c.map((r) => r.fresh_order_day), c.map((r) => r.fresh_order_cutoff), c.map((r) => r.rpl_order_day), c.map((r) => r.rpl_order_cutoff)]);
  }
  });
  return { read: rows.length, note: `${rows.length} rulebook rows (all uploads)` };
}

/** WAM inward: received = Σ FI_QTY by gate-entry day; boxes = Σ over distinct ASNs of their max ACTUAL_BOXES_RECEIVED; issues by ISSUE_DATE. */
const WAM_SQL = `WITH a AS (
  SELECT GATE_ENTRY_TIME::date AS d, IFF(WAREHOUSE = 'NORTH_WH', 'North', 'South') AS site, ASN_NUMBER, SUM(FI_QTY) AS rec, MAX(ACTUAL_BOXES_RECEIVED) AS bx
  FROM snitch_db.maplemonk.WAM_ASN_INWARD
  WHERE GATE_ENTRY_TIME >= TO_DATE('{from}') AND WAREHOUSE IN ('NORTH_WH', 'SOUTH_WH') GROUP BY 1, 2, 3),
inw AS (SELECT d, site, SUM(rec) AS received, SUM(bx) AS boxes FROM a GROUP BY 1, 2),
iss AS (SELECT ISSUE_DATE AS d, IFF(WAREHOUSE = 'NORTH_WH', 'North', 'South') AS site, SUM(ISSUE_COUNT) AS issues, SUM(SKU_LINES) AS sku_lines
  FROM snitch_db.maplemonk.WAM_ISSUES_DAILY WHERE ISSUE_DATE >= TO_DATE('{from}') AND WAREHOUSE IN ('NORTH_WH', 'SOUTH_WH') GROUP BY 1, 2)
SELECT TO_VARCHAR(COALESCE(inw.d, iss.d), 'YYYY-MM-DD') AS day, COALESCE(inw.site, iss.site) AS site, inw.received, inw.boxes, iss.issues, iss.sku_lines
FROM inw FULL JOIN iss ON inw.d = iss.d AND inw.site = iss.site`;
type WamRow = { day: string; site: string; received: number | null; boxes: number | null; issues: number | null; sku_lines: number | null };

export async function pullWam(from = "2026-04-01") {
  if (!isDay(from)) throw new Error("from must be YYYY-MM-DD");
  let rows: WamRow[];
  try { rows = await sfQuery<WamRow>(WAM_SQL.replaceAll("{from}", from)); }
  catch (e) {
    if (/does not exist|not authorized/i.test(e instanceof Error ? e.message : String(e))) return { read: 0, note: "WAM tables not in Snowflake yet — Inwards uses PO receipts" };
    throw e;
  }
  const days = [...new Set(rows.map((r) => r.day))];
  await tx(async (t) => {
  if (days.length) await t.q(`delete from fn_inward_daily where source = 'wam' and day = any($1::date[])`, [days]);
  for (const c of chunks(rows)) {
    await t.q(`insert into fn_inward_daily (day, site, received, boxes, issues, sku_lines, source)
             select d, s, r, b, i, l, 'wam' from unnest($1::date[], $2::text[], $3::numeric[], $4::numeric[], $5::int[], $6::int[]) as t(d, s, r, b, i, l)
             on conflict (day, site) do update set received = excluded.received, boxes = excluded.boxes, issues = excluded.issues, sku_lines = excluded.sku_lines, source = 'wam'`,
      [c.map((r) => r.day), c.map((r) => r.site), c.map((r) => num(r.received)), c.map((r) => num(r.boxes)), c.map((r) => num(r.issues)), c.map((r) => num(r.sku_lines))]);
  }
  });
  return { read: rows.length, note: `${rows.length} WAM inward days from ${from}` };
}

/**
 * Functions SLA → fn_sla_daily (migration 096), from `from`; only the days returned are replaced. Timestamps are IST wall clock in both sources.
 *  inwards: per ASN, gate entry → last putaway (LAST_PUV_AT) within 24 h; an ASN not put away and older than 24 h is judged and missed.
 *  b2c_returns: per packet, receiving day → processed within 2 days (PROCESSED_DATE is mostly blank — Oct–Nov 1 % filled — and equals QC_TIMESTAMP
 *  where filled, so QC time stands in); not processed and older than 2 days = missed.
 */
const FN_SLA_SQL = `WITH a AS (
  SELECT ASN_NUMBER, MIN(GATE_ENTRY_TIME) AS g, MAX(LAST_PUV_AT) AS p, SUM(FI_QTY) AS q, MAX(IFF(WAREHOUSE = 'NORTH_WH', 'North', 'South')) AS site
  FROM snitch_db.maplemonk.WAM_ASN_INWARD WHERE GATE_ENTRY_TIME >= TO_DATE('{from}') AND WAREHOUSE IN ('NORTH_WH', 'SOUTH_WH') GROUP BY 1),
r AS (
  SELECT TRY_TO_DATE(RECEIVING_DATE, 'DD-MM-YYYY') AS d, CASE WHEN TYPE ILIKE 'North%' THEN 'North' WHEN TYPE ILIKE 'WH-%' THEN 'South' END AS site,
    COALESCE(TRY_TO_TIMESTAMP(NULLIF(PROCESSED_DATE, ''), 'MON DD, YYYY HH12:MI AM'), TRY_TO_TIMESTAMP(QC_TIMESTAMP, 'MON DD, YYYY HH12:MI AM')) AS p
  FROM snitch_db.maplemonk.RETURN_2_INWARDING_DATA WHERE TRY_TO_DATE(RECEIVING_DATE, 'DD-MM-YYYY') >= TO_DATE('{from}') AND (TYPE ILIKE 'North%' OR TYPE ILIKE 'WH-%'))
SELECT TO_VARCHAR(g::date, 'YYYY-MM-DD') AS day, site, 'inwards' AS fn,
  SUM(IFF(p IS NOT NULL OR DATEDIFF('minute', g, CONVERT_TIMEZONE('Asia/Kolkata', CURRENT_TIMESTAMP())::timestamp_ntz) > 1440, q, 0)) AS judged,
  SUM(IFF(p IS NOT NULL AND DATEDIFF('minute', g, p) <= 1440, q, 0)) AS within
FROM a WHERE q > 0 GROUP BY 1, 2
UNION ALL
SELECT TO_VARCHAR(d, 'YYYY-MM-DD'), site, 'b2c_returns',
  SUM(IFF(p IS NOT NULL OR DATEDIFF('day', d, CONVERT_TIMEZONE('Asia/Kolkata', CURRENT_TIMESTAMP())::date) > 2, 1, 0)), SUM(IFF(p IS NOT NULL AND DATEDIFF('day', d, p::date) <= 2, 1, 0))
FROM r WHERE d IS NOT NULL AND site IS NOT NULL GROUP BY 1, 2`;

export async function pullFnSla(from = "2026-04-01") {
  if (!isDay(from)) throw new Error("from must be YYYY-MM-DD");
  const rows = await sfQuery<{ day: string; site: string; fn: string; judged: number; within: number }>(FN_SLA_SQL.replaceAll("{from}", from));
  await tx(async (t) => {
    for (const fn of ["inwards", "b2c_returns"]) {
      const days = [...new Set(rows.filter((r) => r.fn === fn).map((r) => r.day))];
      if (days.length) await t.q(`delete from fn_sla_daily where fn = $1 and day = any($2::date[])`, [fn, days]);
    }
    for (const c of chunks(rows)) {
      await t.q(`insert into fn_sla_daily (day, site, fn, judged, within) select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[], $5::numeric[])`,
        [c.map((r) => r.day), c.map((r) => r.site), c.map((r) => r.fn), c.map((r) => num(r.judged) ?? 0), c.map((r) => num(r.within) ?? 0)]);
    }
  });
  return { read: rows.length, note: `${rows.length} SLA day × site × function rows from ${from}` };
}

/** Pre-pack ROI → fn_prepack_monthly (migration 097), replaced in full from `from`: WAM ASNs with / without pre-packs (median gate entry → last
 *  putaway hours, pieces) and pre-pack SKUs dispatched to stores (UC items: pieces and packs). */
const PREPACK_SQL = `WITH a AS (
  SELECT ASN_NUMBER, MIN(GATE_ENTRY_TIME) AS g, MAX(LAST_PUV_AT) AS p, SUM(FI_QTY) AS q, MAX(COALESCE(NUM_PREPACKS, 0)) AS packs, MAX(IFF(WAREHOUSE = 'NORTH_WH', 'North', 'South')) AS site
  FROM snitch_db.maplemonk.WAM_ASN_INWARD WHERE GATE_ENTRY_TIME >= TO_DATE('{from}') AND WAREHOUSE IN ('NORTH_WH', 'SOUTH_WH') GROUP BY 1)
SELECT TO_VARCHAR(DATE_TRUNC('month', g), 'YYYY-MM-DD') AS month, site, IFF(packs > 0, 'inward_pp', 'inward_solid') AS kind,
  MEDIAN(DATEDIFF('minute', g, p) / 60) AS hours, SUM(q) AS pieces, NULL AS packs
FROM a WHERE p IS NOT NULL AND q > 0 GROUP BY 1, 2, 3
UNION ALL
SELECT TO_VARCHAR(DATE_TRUNC('month', DISPATCH_DATE), 'YYYY-MM-DD'), CASE WHEN warehouse_name IN ('SAPL-WH1','SAPL-WH2') THEN 'South' ELSE 'North' END, 'retail_pp', NULL,
  SUM(SUBORDER_QUANTITY * COALESCE(TRY_TO_NUMBER(REGEXP_SUBSTR(SKU, '^PP([0-9]+)', 1, 1, 'e', 1)), 1)), SUM(SUBORDER_QUANTITY)
FROM snitch_db.maplemonk.UNICOMMERCE_FACT_ITEMS_INTERMEDIATE
WHERE SKU LIKE 'PP%' AND MARKETPLACE_MAPPED IN ('FRANCHISE_STORE_B2B','OWN_STORE_B2B') AND DISPATCH_DATE >= TO_DATE('{from}') AND warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
GROUP BY 1, 2, 3`;

export async function pullPrepack(from = "2026-08-01") {
  if (!isDay(from)) throw new Error("from must be YYYY-MM-DD");
  const rows = await sfQuery<{ month: string; site: string; kind: string; hours: number | null; pieces: number | null; packs: number | null }>(PREPACK_SQL.replaceAll("{from}", from));
  await tx(async (t) => {
    await t.q(`delete from fn_prepack_monthly where month >= $1::date`, [from]);
    for (const r of rows) await t.q(`insert into fn_prepack_monthly (month, site, kind, hours, pieces, packs) values ($1, $2, $3, $4, $5, $6)`,
      [r.month, r.site, r.kind, num(r.hours), num(r.pieces), num(r.packs)]);
  });
  return { read: rows.length, note: `${rows.length} pre-pack month × site rows from ${from}` };
}

/**
 * Category split per function (fn_category_month, migration 093), month by month from April:
 *  forward streams (UC items, dispatched month): units = items, shipments = distinct packages holding the category; '(all)' = the stream's packages;
 *    '(long tail)' = packages holding any non-apparel item (LONG_TAIL), counted once however many it holds;
 *  putaway streams (putaway_tracking, trading stock, putaway month): units by final type, as the stage feed maps them;
 *  inward hours (WAM, gate-entry month): median hours gate entry → last putaway per ASN, category from the ASN's SKU group (style-colour) through the
 *  inventory master's SKUs. GRN_SUBMITTED_AT lands after putaway on most ASNs, so the stage between isn't split.
 *  factory issues (issues_factory_sorted, raised month): issue quantity per inward category — the style's category (its SKU field holds the style),
 *  else the PO's main category; North_WH = North, WH1 / WH2 = South.
 * Categories fold as storage's (CAT). Months the source returns are replaced.
 */
const INV_MASTER = "snitch_db.maplemonk.snitch_final_inventory_wh2";
const CATEGORY_SQL = `WITH f AS (
  SELECT TO_VARCHAR(DATE_TRUNC('month', dispatched_timestamp), 'YYYY-MM-DD') AS m, ${SITE("warehouse_name")} AS site, ${UC_STREAM} AS stream,
    ${CAT("category")} AS cat, saleorderitemcode, shippingpackagecode
  FROM snitch_db.maplemonk.UNICOMMERCE_FACT_ITEMS_INTERMEDIATE
  WHERE dispatched_timestamp >= TO_DATE('{from}') AND warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')),
c AS (SELECT REGEXP_SUBSTR("Item SkuCode", '^(.*)-[^-]+$', 1, 1, 'e') AS g, MAX(${CAT('"Category Name"')}) AS cat FROM ${INV_MASTER}
  WHERE date >= DATEADD(day, -180, CURRENT_DATE) GROUP BY 1),
a AS (SELECT ASN_NUMBER, MAX(IFF(WAREHOUSE = 'NORTH_WH', 'North', 'South')) AS site, MAX(SKU_GROUP_ID) AS g, MIN(GATE_ENTRY_TIME) AS ge, MAX(LAST_PUV_AT) AS lp
  FROM snitch_db.maplemonk.WAM_ASN_INWARD WHERE GATE_ENTRY_TIME >= TO_DATE('{from}') AND WAREHOUSE IN ('NORTH_WH','SOUTH_WH') GROUP BY 1)
SELECT m AS month, site, stream, cat AS category, 'units' AS metric, COUNT(DISTINCT saleorderitemcode) AS value FROM f WHERE stream <> 'Other' GROUP BY 1, 2, 3, 4
UNION ALL SELECT m, site, stream, cat, 'shipments', COUNT(DISTINCT shippingpackagecode) FROM f WHERE stream <> 'Other' GROUP BY 1, 2, 3, 4
UNION ALL SELECT m, site, stream, '(all)', 'shipments', COUNT(DISTINCT shippingpackagecode) FROM f WHERE stream <> 'Other' GROUP BY 1, 2, 3
UNION ALL SELECT m, site, stream, '${LONG_TAIL_KEY}', 'shipments', COUNT(DISTINCT shippingpackagecode) FROM f
  WHERE stream <> 'Other' AND cat IN (${LONG_TAIL.map((c) => `'${c}'`).join(",")}) GROUP BY 1, 2, 3
UNION ALL SELECT TO_VARCHAR(DATE_TRUNC('month', putaway_updated), 'YYYY-MM-DD'), ${SITE('"Warehouse Name"')},
  CASE final_type WHEN 'New Inward' THEN 'Inward' WHEN 'B2C Return Inward' THEN 'B2C Returns (channel open)' WHEN 'Store Return Inward' THEN 'B2B Returns Retail'
    WHEN 'B2B MP Returns' THEN 'B2B Returns Marketplace' END, ${CAT("category")}, 'units', SUM(putaway_completed_quantity)
FROM snitch_db.maplemonk.putaway_tracking
WHERE putaway_updated >= TO_DATE('{from}') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND is_trading = TRUE
  AND final_type IN ('New Inward','B2C Return Inward','Store Return Inward','B2B MP Returns')
GROUP BY 1, 2, 3, 4
UNION ALL SELECT TO_VARCHAR(DATE_TRUNC('month', ge), 'YYYY-MM-DD'), a.site, 'Inward', COALESCE(c.cat, '(NO CATEGORY)'), 'gate_put_h', MEDIAN(DATEDIFF('minute', ge, lp) / 60)
  FROM a LEFT JOIN c ON c.g = a.g WHERE lp >= ge GROUP BY 1, 2, 3, 4
UNION ALL SELECT TO_VARCHAR(DATE_TRUNC('month', ge), 'YYYY-MM-DD'), a.site, 'Inward', COALESCE(c.cat, '(NO CATEGORY)'), 'asns', COUNT(*)
  FROM a LEFT JOIN c ON c.g = a.g WHERE lp >= ge GROUP BY 1, 2, 3, 4`;
const ISSUES_SQL = `WITH s AS (SELECT UPPER(REGEXP_SUBSTR("Item SkuCode", '^[^-]+')) AS st, MAX(${CAT('"Category Name"')}) AS cat FROM ${INV_MASTER}
    WHERE date >= DATEADD(day, -240, CURRENT_DATE) GROUP BY 1),
  p AS (SELECT UPPER(TRIM("PO Code")) AS po, ${CAT("category")} AS cat, SUM(TRY_TO_NUMBER("Order Quantity")) AS q FROM snitch_db.maplemonk.uc_final_get_purchase_orders
    GROUP BY 1, 2 QUALIFY ROW_NUMBER() OVER (PARTITION BY po ORDER BY q DESC) = 1)
SELECT TO_VARCHAR(DATE_TRUNC('month', i.created_at_date), 'YYYY-MM-DD') AS month, IFF(i.facility = 'North_WH', 'North', 'South') AS site, 'Inward' AS stream,
  COALESCE(s.cat, p.cat, '(NO CATEGORY)') AS category, 'issue_qty' AS metric, SUM(TRY_TO_NUMBER(i.qty)) AS value
FROM snitch_db.maplemonk.issues_factory_sorted i
  LEFT JOIN s ON s.st = UPPER(REGEXP_SUBSTR(TRIM(i.sku), '^[^-/ ]+'))
  LEFT JOIN p ON p.po = UPPER(REGEXP_REPLACE(TRIM(i.po_number), '^-', ''))
WHERE i.created_at_date >= TO_DATE('{from}') GROUP BY 1, 2, 3, 4, 5`;
type CatRow = { month: string; site: string | null; stream: string | null; category: string; metric: string; value: number | null };

export async function pullCategories(from = "2026-04-01") {
  if (!isDay(from)) throw new Error("from must be YYYY-MM-DD");
  const [main, issues] = await Promise.all([CATEGORY_SQL, ISSUES_SQL].map((s) => sfQuery<CatRow>(s.replaceAll("{from}", from))));
  const rows = [...main!, ...issues!].filter((r) => r.site && r.stream && r.value != null);
  if (!rows.length) return { read: 0, note: "category split returned no rows — table kept" };
  const months = [...new Set(rows.map((r) => r.month))];
  await tx(async (t) => {
    await t.q(`delete from fn_category_month where month = any($1::date[])`, [months]);
    for (const c of chunks(rows)) {
      await t.q(`insert into fn_category_month (month, site, stream, category, metric, value)
                 select * from unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[])`,
        [c.map((r) => r.month), c.map((r) => r.site), c.map((r) => r.stream), c.map((r) => r.category), c.map((r) => r.metric), c.map((r) => num(r.value))]);
    }
  });
  return { read: rows.length, note: `${rows.length} category rows for ${months.length} months from ${from}` };
}
