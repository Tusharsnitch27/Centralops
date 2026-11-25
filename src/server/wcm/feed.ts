import "server-only";
import { q, tx } from "../db";
import { sfQuery } from "../snowflake";
import { ucOwned, UC_ALL_DAYS_STREAM } from "./math";

/**
 * Daily stage completions → wcm_stage_output. Read-only Snowflake; each event counted independently, deduplicated.
 *  Forward (warehouse_sla_performance, ~60-day window, from 21 Sep 2026): distinct saleorderitemcode per event day
 *    shipments = distinct SHIPPINGPACKAGECODE dispatched that day (the CPS denominator).
 *    picked = PICKED_TIMESTAMP (partly filled upstream — 48–82 % of packed items — so pick output is understated),
 *    packed = PACKED_TIMESTAMP, manifested = MANIFESTED_TIMESTAMP, dispatched = DISPATCHED_TIMESTAMP1.
 *    Timestamps are read as IST wall clock, as the S&OP outwards feed does (UC's own packed date agrees on every row tested).
 *  Inward / returns / audit (putaway_tracking from RETURNS_FROM, day = putaway updated, trading stock only — is_trading = TRUE, as the S&OP
 *    feeds): units = putaway_completed_quantity × pre-pack size (PP4-… = 4 pieces), by final type; putaway_lines = distinct completed putaway item lines ("Putaway Item Id": one SKU
 *    into one bin — the Functions overview's transaction for Inwards and returns). Non-trading bulk rows (e.g. 19.7 lakh South B2B MP returns in Nov) are excluded.
 *  B2C returns (RETURN_2_INWARDING_DATA, the returns app's full history — PG_INWARDING_DATA is its Sep→ subset; one row per packet;
 *    channel B2C = Shopify, MP-* = marketplace; TYPE WH-1/WH-2 = South, North_WH = North): received = RECEIVING_DATE, qc =
 *    QC_TIMESTAMP, distinct packets (~1.05–1.2 units each), from RETURNS_FROM.
 *  Inward receiving (uc_final_get_purchase_orders, COMPLETE trading PO lines — non-trading, carry-bag and packaging vendors out):
 *    received = quantity received on the PO's last-update day; unloaded = that ÷ 30 pieces per box (Malhar M, 23 Nov 2026).
 *    Runs 10–35 % above putaway, which counts later and trading stock only.
 * The SLA source keeps ~60 days: only days it returns are replaced, so older days are kept (same rule as packaging).
 */
const SLA = "snitch_db.maplemonk.warehouse_sla_performance";
const PUT = "snitch_db.maplemonk.putaway_tracking";
/** Pieces per putaway unit: a pre-pack SKU "PP4-…" is one pack of 4 pieces (S&OP Category inward's rule, sop/sync.ts mult). WAM FI_QTY is already
 *  in pieces; store orders and UC items stay in packs (a pack is picked and packed once). */
const PP_PIECES = `CASE WHEN "Item Type skuCode" LIKE 'PP%' THEN COALESCE(TRY_TO_NUMBER(REGEXP_SUBSTR("Item Type skuCode", '^PP([0-9]+)', 1, 1, 'e', 1)), 1) ELSE 1 END`;
const RET = "snitch_db.maplemonk.RETURN_2_INWARDING_DATA";
const PO = "snitch_db.maplemonk.UC_FINAL_GET_PURCHASE_ORDERS";
const PCS_PER_BOX = 30;
/** Returns, putaway and PO receipts are re-read from April each run, so Processing's earlier months get a real channel split
 *  and Functions' returns have putaway history (the SLA events keep their own window, `{from}`). */
const RETURNS_FROM = "2026-04-01";
const PO_SITE = `CASE WHEN FACILITY IN ('SAPL-WH1','SAPL-WH2') THEN 'South' WHEN FACILITY = 'SAPL-NORTH-TAURU' THEN 'North' END`;
const PO_TRADING = `"Purchase Order Status" = 'COMPLETE' AND FACILITY IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND CATEGORY NOT ILIKE '%NON%TRADING%'
  AND CATEGORY NOT ILIKE '%CARRY BAG%' AND "Vendor Name" NOT ILIKE '%NON TRADING%' AND "Vendor Name" NOT ILIKE '%PACKAGING%'`;
const PG_EV = (event: string, dayExpr: string) => `SELECT TO_VARCHAR(${dayExpr}, 'YYYY-MM-DD'),
  CASE WHEN TYPE ILIKE 'North%' THEN 'North' WHEN TYPE ILIKE 'WH-%' THEN 'South' END, IFF(CHANEL = 'B2C', 'B2C Returns Shopify', 'B2C Returns Marketplace'),
  '${event}', 'packet', COUNT(DISTINCT AWB_NO)
FROM ${RET} WHERE ${dayExpr} >= TO_DATE('${RETURNS_FROM}') AND (TYPE ILIKE 'North%' OR TYPE ILIKE 'WH-%')
GROUP BY 1, 2, 3`;
export const STAGE_FROM = "2026-09-21";
/** Days at the start of the SLA source's window treated as partial (see pullStageOutput). */
const EDGE_DAYS = 7;
export const SITE = (col: string) => `CASE WHEN ${col} IN ('SAPL-WH1','SAPL-WH2') THEN 'South' WHEN ${col} = 'SAPL-NORTH-TAURU' THEN 'North' END`;
/** marketplace_mapped → warehouse stream. Anything unlisted is kept as "Other" (visible, never folded into a channel). */
const STREAM = `CASE
  WHEN marketplace_mapped = 'SHOPIFY' THEN 'B2C Shopify'
  WHEN marketplace_mapped IN ('AJIO','AMAZON','COCOBLU','FLIPKART','MYNTRA','NYKAA.COM','NYKAA_FASHION') THEN 'B2C Marketplace'
  WHEN marketplace_mapped IN ('STORE','OWN_STORE_B2B','FRANCHISE_STORE_B2B') THEN 'B2B Retail'
  WHEN marketplace_mapped IN ('FLIPKART_SOR','M-NOW','M_NOW_WESTBENGAL','ZILO','KNOT','SLIKK','SJIT') THEN 'B2B Marketplace'
  ELSE 'Other' END`;
const ev = (event: string, col: string) => `SELECT TO_VARCHAR(${col}::date, 'YYYY-MM-DD') AS day, site, stream, '${event}' AS event, 'item' AS unit, COUNT(DISTINCT saleorderitemcode) AS qty
  FROM s WHERE ${col} >= TO_DATE('{from}') GROUP BY 1, 2, 3`;
export const STAGE_SQL = `WITH s AS (
  SELECT saleorderitemcode, ${SITE("warehouse_name")} AS site, ${STREAM} AS stream,
    picked_timestamp, packed_timestamp, manifested_timestamp, "DISPATCHED_TIMESTAMP1" AS dispatched_ts, shippingpackagecode
  FROM ${SLA} WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU'))
${ev("picked", "picked_timestamp")} UNION ALL ${ev("packed", "packed_timestamp")} UNION ALL ${ev("manifested", "manifested_timestamp")} UNION ALL ${ev("dispatched", "dispatched_ts")}
UNION ALL
SELECT TO_VARCHAR(dispatched_ts::date, 'YYYY-MM-DD'), site, stream, 'shipments', 'shipment', COUNT(DISTINCT shippingpackagecode)
  FROM s WHERE dispatched_ts >= TO_DATE('{from}') GROUP BY 1, 2, 3
UNION ALL
SELECT TO_VARCHAR(putaway_updated::date, 'YYYY-MM-DD'), ${SITE('"Warehouse Name"')},
  CASE final_type WHEN 'New Inward' THEN 'Inward' WHEN 'B2C Return Inward' THEN 'B2C Returns (channel open)' WHEN 'Store Return Inward' THEN 'B2B Returns Retail'
    WHEN 'B2B MP Returns' THEN 'B2B Returns Marketplace' WHEN 'Audit Activity' THEN 'Inventory' END,
  IFF(final_type = 'Audit Activity', 'audit_move', 'putaway'), 'item', SUM(putaway_completed_quantity * ${PP_PIECES})
FROM ${PUT}
WHERE putaway_updated >= TO_DATE('${RETURNS_FROM}') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  AND final_type IN ('New Inward','B2C Return Inward','Store Return Inward','B2B MP Returns','Audit Activity') AND is_trading = TRUE
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT TO_VARCHAR(putaway_updated::date, 'YYYY-MM-DD'), ${SITE('"Warehouse Name"')},
  CASE final_type WHEN 'New Inward' THEN 'Inward' WHEN 'B2C Return Inward' THEN 'B2C Returns (channel open)' WHEN 'Store Return Inward' THEN 'B2B Returns Retail'
    WHEN 'B2B MP Returns' THEN 'B2B Returns Marketplace' END,
  'putaway_lines', 'line', COUNT(DISTINCT "Putaway Item Id")
FROM ${PUT}
WHERE putaway_updated >= TO_DATE('${RETURNS_FROM}') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  AND final_type IN ('New Inward','B2C Return Inward','Store Return Inward','B2B MP Returns') AND is_trading = TRUE AND putaway_completed_quantity > 0
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT TO_VARCHAR(TRY_TO_TIMESTAMP(UPDATED)::date, 'YYYY-MM-DD'), ${PO_SITE}, 'Inward', ev, u, ROUND(SUM(TRY_TO_NUMBER("Recieved Quantity")) / k.dv)
FROM ${PO}, (SELECT 'received' AS ev, 'item' AS u, 1 AS dv UNION ALL SELECT 'unloaded', 'box', ${PCS_PER_BOX}) k
WHERE TRY_TO_TIMESTAMP(UPDATED) >= TO_DATE('${RETURNS_FROM}') AND ${PO_TRADING}
GROUP BY 1, 2, 4, 5, k.dv
UNION ALL
${PG_EV("received", "TRY_TO_DATE(RECEIVING_DATE, 'DD-MM-YYYY')")}
UNION ALL
${PG_EV("qc", "TRY_TO_TIMESTAMP(QC_TIMESTAMP, 'MON DD, YYYY HH12:MI AM')::date")}`;

type Row = { day: string | null; site: string | null; stream: string; event: string; unit: string; qty: number };

export async function pullStageOutput(from = STAGE_FROM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const raw = (await sfQuery<Row>(STAGE_SQL.replaceAll("{from}", from))).filter((r) => r.day && r.site && r.stream);
  // The SLA source keeps ~60 days by order creation, so event days in its first week are partial (items created earlier have
  // aged out). Those edge days are written only if never stored, so a moving window can't overwrite a complete count.
  const slaEvs = ["picked", "packed", "manifested", "dispatched", "shipments"];
  const first = raw.filter((r) => slaEvs.includes(r.event)).map((r) => r.day!).sort()[0];
  const edge = first ? new Date(Date.parse(`${first}T00:00:00Z`) + EDGE_DAYS * 864e5).toISOString().slice(0, 10) : null;
  const stored = new Set(edge ? (await q<{ k: string }>(`select distinct day::text || '|' || event as k from wcm_stage_output
    where event = any($1::text[]) and day < $2 and source is distinct from 'uc_items'`, [slaEvs, edge])).map((r) => r.k) : []);
  // day × event that UC items history owns (pullUcHistory): the SLA source's count there is partial, never written over it
  const ucRows = await q<{ day: string; site: string; stream: string; event: string }>(`select distinct day::text as day, site, case when stream = $2 then stream else '' end as stream, event
    from wcm_stage_output where source = 'uc_items' and event = any($1::text[])`, [slaEvs, UC_ALL_DAYS_STREAM]);
  const ucBy = new Map<string, typeof ucRows>();
  for (const u of ucRows) ucBy.set(`${u.day}|${u.event}`, [...(ucBy.get(`${u.day}|${u.event}`) ?? []), u]);
  const rows = raw.filter((r) => !(slaEvs.includes(r.event) && ((edge && r.day! < edge && stored.has(`${r.day}|${r.event}`))
    || ucOwned(r as { day: string; site: string; stream: string; event: string }, ucBy.get(`${r.day}|${r.event}`) ?? []))));
  // replace per source (event family) only the days that source returned — one transaction per family, so a failed run leaves its days as they were
  const families = [slaEvs, ["putaway", "audit_move", "putaway_lines"], ["received", "qc", "unloaded"]];
  for (const evs of families) {
    const fam = rows.filter((r) => evs.includes(r.event)), days = [...new Set(fam.map((r) => r.day!))];
    if (!days.length) continue;
    await tx(async (t) => {
      await t.q(`delete from wcm_stage_output where event = any($1::text[]) and day = any($2::date[]) and source is distinct from 'uc_items'`, [evs, days]);
      for (let i = 0; i < fam.length; i += 2000) {
        const c = fam.slice(i, i + 2000);
        await t.q(`insert into wcm_stage_output (day, site, stream, event, unit, qty, source)
                 select d::date, s, st, e, u, n, src from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[]) as t(d, s, st, e, u, n, src)
                 on conflict (day, site, stream, event) do update set qty = excluded.qty, unit = excluded.unit, source = excluded.source, fetched_at = now()
                 where wcm_stage_output.source is distinct from 'uc_items'`,
          [c.map((r) => r.day), c.map((r) => r.site), c.map((r) => r.stream), c.map((r) => r.event), c.map((r) => r.unit), c.map((r) => Number(r.qty) || 0),
            c.map((r) => (["putaway", "audit_move", "putaway_lines"].includes(r.event) ? "putaway_tracking" : r.stream === "Inward" ? "uc_purchase_orders"
              : ["received", "qc"].includes(r.event) ? "return_2_inwarding_data" : "warehouse_sla_performance"))]);
      }
    });
  }
  return { read: rows.length, from, keptEdgeDays: new Set([...stored].map((k) => k.split("|")[0])).size };
}

/**
 * Forward history before warehouse_sla_performance's window, from UC items (UNICOMMERCE_FACT_ITEMS_INTERMEDIATE, Mar 2026 →):
 * packed (PACKED_TIMESTAMP, a date), dispatched, shipments (distinct SHIPPINGPACKAGECODE dispatched) and ordered (items by UC_CREATED day —
 * every day to yesterday, or to the day before UC's latest uc_created when UC lags: the SLA source writes no 'ordered', so it is the one creation-day count for Functions' received).
 * The SLA source's window is cut by creation day, so items created before its first day (asked each run) but done later are in neither
 * source unless UC covers event days up to UC_WINS_DAYS past it; UC wins on those days (pullStageOutput skips them). UC labels stores and
 * M-Now differently ('Own Store', 'M-NOW MUMBAI'; Flipkart SOR is marketplace 'FLIPKART B2B CUSTOM'): those map to the same streams first.
 */
const UC = "snitch_db.maplemonk.UNICOMMERCE_FACT_ITEMS_INTERMEDIATE";
/** B2B Marketplace dispatches up to ~3 weeks after creation: UC owns event days until 14 days past the SLA source's first creation day. */
const UC_WINS_DAYS = 14;
export const UC_STREAM = `CASE WHEN marketplace = 'FLIPKART B2B CUSTOM' OR marketplace_mapped LIKE 'M-NOW%' OR UPPER(marketplace_mapped) = 'SLIKK' THEN 'B2B Marketplace'
  WHEN marketplace_mapped IN ('Own Store','Franchise Store') THEN 'B2B Retail' WHEN marketplace_mapped = 'NYKAA_SAPL_TAURU' THEN 'B2C Marketplace'
  ELSE ${STREAM} END`;
// B2B Marketplace's packed / dispatched / shipments run to yesterday: UC ties to the S&OP workbook (Oct South 42,086), the SLA source gives 37,630
const ucEv = (event: string, col: string, unit = "item", key = "saleorderitemcode", until = "{until}") => `SELECT TO_VARCHAR(${col}::date, 'YYYY-MM-DD') AS day, site, stream,
  '${event}' AS event, '${unit}' AS unit, COUNT(DISTINCT ${key}) AS qty FROM s WHERE ${col} >= TO_DATE('{from}')
  AND (${col} < TO_DATE('${until}') OR (stream = '${UC_ALL_DAYS_STREAM}' AND ${col} < TO_DATE('{today}'))) GROUP BY 1, 2, 3`;
export const UC_SQL = `WITH s AS (
  SELECT saleorderitemcode, shippingpackagecode, ${SITE("warehouse_name")} AS site, ${UC_STREAM} AS stream, uc_created, packed_timestamp, dispatched_timestamp
  FROM ${UC} WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU'))
${ucEv("ordered", "uc_created", "item", "saleorderitemcode", "{today}")} UNION ALL ${ucEv("packed", "packed_timestamp")} UNION ALL ${ucEv("dispatched", "dispatched_timestamp")}
UNION ALL ${ucEv("shipments", "dispatched_timestamp", "shipment", "shippingpackagecode")}`;

export async function pullUcHistory(from = "2026-04-01") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const until = (await sfQuery<{ until: string | null }>(`SELECT TO_VARCHAR(MIN(uc_created)::date, 'YYYY-MM-DD') AS until FROM ${SLA}`))[0]?.until;
  if (!until) throw new Error("warehouse_sla_performance has no first day — UC history not written");
  const upTo = new Date(Date.parse(`${until}T00:00:00Z`) + UC_WINS_DAYS * 864e5).toISOString().slice(0, 10);
  const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // ordered: every day to yesterday (IST)
  // UC items lags: the day of its latest uc_created is still filling, so days from it on are not written (never a partial last day)
  const ucLast = (await sfQuery<{ d: string | null }>(`SELECT TO_VARCHAR(MAX(uc_created)::date, 'YYYY-MM-DD') AS d FROM ${UC}
    WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')`))[0]?.d;
  if (!ucLast) throw new Error("UC items has no uc_created — UC history not written");
  const today = ucLast < istToday ? ucLast : istToday;
  const rows = (await sfQuery<Row>(UC_SQL.replaceAll("{from}", from).replaceAll("{until}", upTo).replaceAll("{today}", today))).filter((r) => r.day && r.site);
  const days = [...new Set(rows.map((r) => r.day!))];
  await tx(async (t) => {
    if (days.length) await t.q(`delete from wcm_stage_output where source = 'uc_items' and day = any($1::date[])`, [days]);
    for (let i = 0; i < rows.length; i += 2000) {
      const c = rows.slice(i, i + 2000);
      await t.q(`insert into wcm_stage_output (day, site, stream, event, unit, qty, source)
               select d::date, s, st, e, u, n, 'uc_items' from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[]) as t(d, s, st, e, u, n)
               on conflict (day, site, stream, event) do update set qty = excluded.qty, unit = excluded.unit, source = 'uc_items', fetched_at = now()`,
        [c.map((r) => r.day), c.map((r) => r.site), c.map((r) => r.stream), c.map((r) => r.event), c.map((r) => r.unit), c.map((r) => Number(r.qty) || 0)]);
    }
  });
  return { read: rows.length, until: upTo };
}

/**
 * Service-level cells → wcm_sla_cell (migration 085), on the upstream SLA definitions — nothing is recomputed here.
 *  B2C: warehouse_sla_performance.SLA_STATUS (deadline = TAT, done = coalesced DISPATCHED_TIMESTAMP, both as built upstream);
 *       delay_flag lines (exchange / warehouse switch / error order) are counted apart and excluded from every other count.
 *       Latest row per order line. The source keeps ~60 days, so the first EDGE_SLA_DAYS deadline days of its window are
 *       written only if never stored (items created earlier have aged out of the source).
 *  B2B Retail: retail_journey_spine.HANDOVER_SLA vs HANDOVER_DEADLINE_TS, in units (quantity) and orders. NSO / QCOM have no SLA.
 *  B2B Marketplace: the Marketplace<>Warehouse tracker (gs_marketplace_wh_tracker, Airbyte copy of the sheet) — the channel has no
 *       UC TAT; the warehouse works to the tracker's Dispatch_date (taken as 18:00, day-shift end), done = RTS_DATE.
 *       A DISPATCHED row with no RTS date can't be judged (no_sla).
 * Timestamps are IST wall clock, as the S&OP outwards feed reads them.
 */
const EDGE_SLA_DAYS = 2;
export const SLA_B2C_SQL = `WITH s AS (
  SELECT warehouse_name AS wh, CASE WHEN marketplace_mapped = 'SHOPIFY' THEN 'B2C Shopify' ELSE 'B2C Marketplace' END AS stream,
    uc_created AS c, tat AS t, COALESCE(tat_type, 'Unknown') AS wave, sla_status AS st, COALESCE(delay_flag, 0) = 1 AS dl, dispatched_timestamp AS d
  FROM ${SLA}
  WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND tat >= TO_DATE('{from}')
    AND marketplace_mapped IN ('SHOPIFY','AJIO','AMAZON','COCOBLU','FLIPKART','MYNTRA','NYKAA.COM','NYKAA_FASHION')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY saleorderitemcode ORDER BY last_updated DESC NULLS LAST) = 1)
SELECT TO_VARCHAR(t, 'YYYY-MM-DD HH24:MI') AS deadline, TO_VARCHAR(DATE_TRUNC('hour', c), 'YYYY-MM-DD HH24:MI') AS created_hr,
  CASE wh WHEN 'SAPL-WH1' THEN 'WH1' WHEN 'SAPL-WH2' THEN 'WH2' ELSE 'NORTH' END AS wh, stream, wave, 'warehouse_sla_performance' AS source,
  COUNT(*) AS units, COUNT_IF(NOT dl AND st = 'WITHIN SLA') AS within, COUNT_IF(NOT dl AND st = 'FUTURE DATE-COMPLETED') AS fut_done,
  COUNT_IF(NOT dl AND st = 'BREACHED') AS breached, COUNT_IF(NOT dl AND st = 'BREACHED - PENDING FOR PROCESS') AS pend_breach,
  COUNT_IF(NOT dl AND st = 'FUTURE DATE-PENDING') AS fut_open, COUNT_IF(NOT dl AND st = 'CANCELLED') AS cancelled,
  COUNT_IF(NOT dl AND st = 'UNFULFILLABLE') AS unfulfillable,
  COUNT_IF(NOT dl AND COALESCE(st, '') NOT IN ('WITHIN SLA','FUTURE DATE-COMPLETED','BREACHED','BREACHED - PENDING FOR PROCESS','FUTURE DATE-PENDING','CANCELLED','UNFULFILLABLE')) AS no_sla,
  COUNT_IF(dl) AS delay_flagged, NULL AS orders, NULL AS orders_late,
  COALESCE(SUM(IFF(NOT dl AND st IN ('WITHIN SLA','FUTURE DATE-COMPLETED','BREACHED') AND d IS NOT NULL, DATEDIFF('minute', c, d) / 60, NULL)), 0) AS o2m_h,
  COUNT_IF(NOT dl AND st IN ('WITHIN SLA','FUTURE DATE-COMPLETED','BREACHED') AND d IS NOT NULL) AS o2m_n
FROM s GROUP BY 1, 2, 3, 4, 5`;
export const SLA_SPINE_SQL = `WITH s AS (
  SELECT CASE warehouse_name WHEN 'SAPL-WH1' THEN 'WH1' WHEN 'SAPL-WH2' THEN 'WH2' ELSE 'NORTH' END AS wh, order_timestamp AS c, handover_deadline_ts AS t,
    handover_sla AS st, COALESCE(quantity, 0) AS q
  FROM snitch_db.maplemonk.retail_journey_spine
  WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND order_timestamp IS NOT NULL AND COALESCE(handover_deadline_ts, order_timestamp) >= TO_DATE('{from}'))
SELECT TO_VARCHAR(IFF(st IS NULL OR t IS NULL, DATE_TRUNC('hour', c), t), 'YYYY-MM-DD HH24:MI') AS deadline, TO_VARCHAR(DATE_TRUNC('hour', c), 'YYYY-MM-DD HH24:MI') AS created_hr,
  wh, 'B2B Retail' AS stream, IFF(st IS NULL OR t IS NULL, 'No SLA', 'Handover ' || TO_VARCHAR(t, 'HH24:MI')) AS wave, 'retail_journey_spine' AS source,
  SUM(q) AS units, SUM(IFF(t IS NOT NULL AND st = 'WITHIN_SLA', q, 0)) AS within, 0 AS fut_done, SUM(IFF(t IS NOT NULL AND st = 'BREACHED', q, 0)) AS breached,
  SUM(IFF(t IS NOT NULL AND st = 'BREACHED-PENDING FOR PROCESS', q, 0)) AS pend_breach, SUM(IFF(t IS NOT NULL AND st = 'FUTURE SLA', q, 0)) AS fut_open,
  0 AS cancelled, 0 AS unfulfillable,
  SUM(IFF(t IS NULL OR COALESCE(st, '') NOT IN ('WITHIN_SLA','BREACHED','BREACHED-PENDING FOR PROCESS','FUTURE SLA'), q, 0)) AS no_sla, 0 AS delay_flagged,
  COUNT(*) AS orders, COUNT_IF(t IS NOT NULL AND st IN ('BREACHED','BREACHED-PENDING FOR PROCESS')) AS orders_late, 0 AS o2m_h, 0 AS o2m_n
FROM s GROUP BY 1, 2, 3, 4, 5`;
export const SLA_TRACKER_SQL = `WITH s AS (
  SELECT CASE facility WHEN 'SAPL-WH1' THEN 'WH1' WHEN 'SAPL-WH2' THEN 'WH2' ELSE 'NORTH' END AS wh, UPPER(TRIM(status)) AS st, COALESCE(TRY_TO_NUMBER(qty), 0) AS q,
    TRY_TO_DATE(dispatch_date, 'YYYY-MM-DD') AS dd, TRY_TO_DATE(rts_date, 'YYYY-MM-DD') AS rts, TRY_TO_DATE("DATE", 'DD/MM/YYYY') AS od
  FROM snitch_db.maplemonk.gs_marketplace_wh_tracker WHERE facility IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')),
c AS (SELECT *, COALESCE(od, dd) AS cd, CURRENT_DATE() AS today FROM s WHERE COALESCE(dd, od) >= TO_DATE('{from}'))
SELECT TO_VARCHAR(IFF(dd IS NULL, cd::timestamp_ntz + INTERVAL '9 hour', dd::timestamp_ntz + INTERVAL '18 hour'), 'YYYY-MM-DD HH24:MI') AS deadline,
  TO_VARCHAR(cd::timestamp_ntz + INTERVAL '9 hour', 'YYYY-MM-DD HH24:MI') AS created_hr, wh, 'B2B Marketplace' AS stream, IFF(dd IS NULL, 'No SLA', 'Tracker dispatch date') AS wave,
  'gs_marketplace_wh_tracker' AS source, SUM(q) AS units,
  SUM(IFF(st NOT IN ('CANCELLED','UNFULFILLABLE') AND dd IS NOT NULL AND rts <= dd, q, 0)) AS within, 0 AS fut_done,
  SUM(IFF(st NOT IN ('CANCELLED','UNFULFILLABLE') AND dd IS NOT NULL AND rts > dd, q, 0)) AS breached,
  SUM(IFF(st NOT IN ('CANCELLED','UNFULFILLABLE','DISPATCHED') AND dd IS NOT NULL AND rts IS NULL AND dd < today, q, 0)) AS pend_breach,
  SUM(IFF(st NOT IN ('CANCELLED','UNFULFILLABLE','DISPATCHED') AND dd IS NOT NULL AND rts IS NULL AND dd >= today, q, 0)) AS fut_open,
  SUM(IFF(st = 'CANCELLED', q, 0)) AS cancelled, SUM(IFF(st = 'UNFULFILLABLE', q, 0)) AS unfulfillable,
  SUM(IFF(st NOT IN ('CANCELLED','UNFULFILLABLE') AND (dd IS NULL OR (rts IS NULL AND st = 'DISPATCHED')), q, 0)) AS no_sla, 0 AS delay_flagged,
  COUNT(*) AS orders, COUNT_IF(st NOT IN ('CANCELLED','UNFULFILLABLE') AND dd IS NOT NULL AND (rts > dd OR (rts IS NULL AND st <> 'DISPATCHED' AND dd < today))) AS orders_late, 0 AS o2m_h, 0 AS o2m_n
FROM c GROUP BY 1, 2, 3, 4, 5`;

const CELL_COLS = ["deadline", "created_hr", "wh", "stream", "wave", "source", "units", "within", "fut_done", "breached", "pend_breach", "fut_open",
  "cancelled", "unfulfillable", "no_sla", "delay_flagged", "orders", "orders_late", "o2m_h", "o2m_n"] as const;
type Cell = Record<(typeof CELL_COLS)[number], string | number | null>;
const CELL_TYPES = ["timestamp", "timestamp", "text", "text", "text", "text", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric",
  "numeric", "numeric", "numeric", "numeric", "int", "int", "numeric", "int"];
const TEXT_COLS = 6; // the first six columns are keys / labels, the rest numbers

/** Replace one source's cells for the deadline days it returned (except `keep` days, already stored). */
async function writeCells(source: string, rows: Cell[], keep: Set<string>) {
  const day = (r: Cell) => String(r.deadline).slice(0, 10);
  rows = rows.filter((r) => !keep.has(day(r)));
  const days = [...new Set(rows.map(day))];
  if (days.length) await q(`delete from wcm_sla_cell where source = $1 and deadline::date = any($2::date[])`, [source, days]);
  for (let i = 0; i < rows.length; i += 2000) {
    const c = rows.slice(i, i + 2000);
    await q(`insert into wcm_sla_cell (${CELL_COLS.join(", ")})
             select * from unnest(${CELL_COLS.map((_, j) => `$${j + 1}::${CELL_TYPES[j]}[]`).join(", ")})
             on conflict (deadline, created_hr, wh, stream, wave) do update set ${CELL_COLS.slice(5).map((k) => `${k} = excluded.${k}`).join(", ")}, fetched_at = now()`,
      CELL_COLS.map((k, j) => c.map((r) => (r[k] == null ? null : j < TEXT_COLS ? String(r[k]) : Number(r[k])))));
  }
  return rows.length;
}

/** Pull all three SLA sources into wcm_sla_cell (07:00 job and the planner's Refresh). Name kept for the existing callers. */
export async function pullSla(from = STAGE_FROM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const [b2c, spine, trk] = await Promise.all([SLA_B2C_SQL, SLA_SPINE_SQL, SLA_TRACKER_SQL].map((s) => sfQuery<Cell>(s.replaceAll("{from}", from))));
  const first = b2c.map((r) => String(r.deadline).slice(0, 10)).sort()[0];
  const edge = first ? new Date(Date.parse(`${first}T00:00:00Z`) + EDGE_SLA_DAYS * 864e5).toISOString().slice(0, 10) : null;
  const stored = new Set(edge ? (await q<{ d: string }>(`select distinct deadline::date::text as d from wcm_sla_cell where source = 'warehouse_sla_performance' and deadline < $1::date`, [edge])).map((r) => r.d) : []);
  const n = (await writeCells("warehouse_sla_performance", b2c, stored)) + (await writeCells("retail_journey_spine", spine, new Set())) + (await writeCells("gs_marketplace_wh_tracker", trk, new Set()));
  return { read: n, from };
}

/**
 * Retail store dispatch volume per month × warehouse × store × store zone × order type → lg_retail_month (logistics correlation).
 * Source: retail_journey_spine (one row per store order; zone = the store's zone). FRESH-<category> order types roll up to FRESH.
 * distribution_rulebook's ZONE column is broken upstream (#REF! for most stores, checked 21 Nov 2026), so the spine's zone is used.
 */
const SPINE_SQL = `SELECT TO_VARCHAR(DATE_TRUNC('month', order_date), 'YYYY-MM-DD') AS month, ${SITE("warehouse_name")} AS site, store,
  COALESCE(NULLIF(UPPER(zone), ''), 'UNMAPPED') AS zone, IFF(UPPER(order_type) LIKE 'FRESH%', 'FRESH', COALESCE(NULLIF(UPPER(order_type), ''), 'UNTYPED')) AS order_type,
  COUNT(DISTINCT order_name) AS orders, COUNT(DISTINCT tracking_number) AS awbs, SUM(package_count) AS boxes, SUM(quantity) AS qty
FROM snitch_db.maplemonk.retail_journey_spine
WHERE order_date >= TO_DATE('{from}') AND warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND store IS NOT NULL
GROUP BY 1, 2, 3, 4, 5`;
export async function pullRetailSpine(from = "2026-04-01") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const rows = await sfQuery<{ month: string; site: string; store: string; zone: string; order_type: string; orders: number; awbs: number; boxes: number | null; qty: number | null }>(SPINE_SQL.replaceAll("{from}", from));
  const months = [...new Set(rows.map((r) => r.month))];
  if (months.length) await q(`delete from lg_retail_month where month = any($1::date[])`, [months]);
  for (let i = 0; i < rows.length; i += 2000) {
    const c = rows.slice(i, i + 2000);
    await q(`insert into lg_retail_month (month, site, store, zone, order_type, orders, awbs, boxes, qty)
             select * from unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::numeric[], $9::numeric[])
             on conflict (month, site, store, zone, order_type) do update set orders = excluded.orders, awbs = excluded.awbs, boxes = excluded.boxes, qty = excluded.qty, fetched_at = now()`,
      [c.map((r) => r.month), c.map((r) => r.site), c.map((r) => r.store), c.map((r) => r.zone), c.map((r) => r.order_type), c.map((r) => Number(r.orders)), c.map((r) => Number(r.awbs)), c.map((r) => r.boxes == null ? null : Number(r.boxes)), c.map((r) => r.qty == null ? null : Number(r.qty))]);
  }
  return { read: rows.length, from };
}

/** Category names as the item master spells them, folded to one name per category (singular / plural variants). */
export const CAT = (col: string) => `CASE UPPER(TRIM(${col})) WHEN 'SHIRT' THEN 'SHIRTS' WHEN 'SWEATER' THEN 'SWEATERS' WHEN 'TROUSER' THEN 'TROUSERS'
  WHEN 'JACKET' THEN 'JACKETS' WHEN 'JOGGERS' THEN 'JOGGERS & TRACKPANTS' WHEN 'TRACKPANTS' THEN 'JOGGERS & TRACKPANTS' WHEN 'FOOTWEAR' THEN 'SHOES'
  WHEN 'PYJAMAS' THEN 'NIGHT SUIT & PYJAMAS' ELSE COALESCE(NULLIF(UPPER(TRIM(${col})), ''), '(NO CATEGORY)') END`;
const INV = "snitch_db.maplemonk.snitch_final_inventory_wh2";
export const INV_CAT_SQL = `SELECT TO_VARCHAR(DATE_TRUNC('month', date), 'YYYY-MM-DD') AS month, ${SITE("facility")} AS site, ${CAT('"Category Name"')} AS category,
  SUM(TRY_TO_NUMBER(inventory::string)) / COUNT(DISTINCT date) AS avg_units, COUNT(DISTINCT date) AS days
FROM ${INV} WHERE date >= TO_DATE('{from}') AND facility IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') GROUP BY 1, 2, 3`;
export const BIN_CAT_SQL = `WITH inv AS (SELECT facility, "Item SkuCode" AS sku, MAX("Category Name") AS cat FROM ${INV}
    WHERE date >= DATEADD(day, -3, CURRENT_DATE) AND facility IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') GROUP BY 1, 2),
  sh AS (SELECT facility, shelf, "Item Type SKU Code" AS sku, TRY_TO_NUMBER(quantity) AS q, _airbyte_emitted_at AS at FROM snitch_db.maplemonk.uc_new_get_shelfwise_inventory
    WHERE "Inventory Type" = 'GOOD_INVENTORY' AND shelf <> 'NON_TRADING' AND TRY_TO_NUMBER(quantity) > 0 AND facility IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')),
  t AS (SELECT facility, shelf, SUM(q) AS tq FROM sh GROUP BY 1, 2)
SELECT ${SITE("sh.facility")} AS site, ${CAT("inv.cat")} AS category, SUM(sh.q) AS units, SUM(sh.q / t.tq) AS bins, TO_VARCHAR(MAX(sh.at)) AS taken_at
FROM sh JOIN t ON t.facility = sh.facility AND t.shelf = sh.shelf LEFT JOIN inv ON inv.facility = sh.facility AND inv.sku = sh.sku GROUP BY 1, 2`;
/** Monthly average inventory by category (from April) + today's bins by category. Months the source returns are replaced. */
export async function pullInventory(from = "2026-04-01") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const [inv, bins] = await Promise.all([
    sfQuery<{ month: string; site: string; category: string; avg_units: number; days: number }>(INV_CAT_SQL.replaceAll("{from}", from)),
    sfQuery<{ site: string; category: string; units: number; bins: number; taken_at: string }>(BIN_CAT_SQL),
  ]);
  const months = [...new Set(inv.map((r) => r.month))];
  if (months.length) await q(`delete from wcm_inv_cat where month = any($1::date[])`, [months]);
  if (inv.length) await q(`insert into wcm_inv_cat (month, site, category, avg_units, days) select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[], $5::int[])`,
    [inv.map((r) => r.month), inv.map((r) => r.site), inv.map((r) => r.category), inv.map((r) => Number(r.avg_units)), inv.map((r) => Number(r.days))]);
  if (bins.length) {
    await q(`delete from wcm_bin_cat`);
    await q(`insert into wcm_bin_cat (site, category, units, bins, taken_at) select * from unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::timestamptz[])`,
      [bins.map((r) => r.site), bins.map((r) => r.category), bins.map((r) => Number(r.units)), bins.map((r) => Number(r.bins)), bins.map((r) => r.taken_at)]);
  }
  return { read: inv.length + bins.length, from };
}
