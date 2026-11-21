import "server-only";
import { q } from "../db";
import { sfQuery } from "../snowflake";

/**
 * Daily stage completions → wcm_stage_output. Read-only Snowflake; each event counted independently, deduplicated.
 *  Forward (warehouse_sla_performance, ~60-day window, from 21 Sep 2026): distinct saleorderitemcode per event day
 *    picked = PICKED_TIMESTAMP (partly filled upstream — 48–82 % of packed items — so pick output is understated),
 *    packed = PACKED_TIMESTAMP, manifested = MANIFESTED_TIMESTAMP, dispatched = DISPATCHED_TIMESTAMP1.
 *    Timestamps are read as IST wall clock, as the S&OP outwards feed does (UC's own packed date agrees on every row tested).
 *  Inward / returns / audit (putaway_tracking, day = putaway updated, trading stock only — is_trading = TRUE, as the S&OP
 *    feeds): units = putaway_completed_quantity, by final type. Non-trading bulk rows (e.g. 19.7 lakh South B2B MP returns in Nov) are excluded.
 * The SLA source keeps ~60 days: only days it returns are replaced, so older days are kept (same rule as packaging).
 */
const SLA = "snitch_db.maplemonk.warehouse_sla_performance";
const PUT = "snitch_db.maplemonk.putaway_tracking";
export const STAGE_FROM = "2026-09-21";
/** Days at the start of the SLA source's window treated as partial (see pullStageOutput). */
const EDGE_DAYS = 7;
const SITE = (col: string) => `CASE WHEN ${col} IN ('SAPL-WH1','SAPL-WH2') THEN 'South' WHEN ${col} = 'SAPL-NORTH-TAURU' THEN 'North' END`;
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
    picked_timestamp, packed_timestamp, manifested_timestamp, "DISPATCHED_TIMESTAMP1" AS dispatched_ts
  FROM ${SLA} WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU'))
${ev("picked", "picked_timestamp")} UNION ALL ${ev("packed", "packed_timestamp")} UNION ALL ${ev("manifested", "manifested_timestamp")} UNION ALL ${ev("dispatched", "dispatched_ts")}
UNION ALL
SELECT TO_VARCHAR(putaway_updated::date, 'YYYY-MM-DD'), ${SITE('"Warehouse Name"')},
  CASE final_type WHEN 'New Inward' THEN 'Inward' WHEN 'B2C Return Inward' THEN 'B2C Returns (channel open)' WHEN 'Store Return Inward' THEN 'B2B Returns Retail'
    WHEN 'B2B MP Returns' THEN 'B2B Returns Marketplace' WHEN 'Audit Activity' THEN 'Inventory' END,
  IFF(final_type = 'Audit Activity', 'audit_move', 'putaway'), 'item', SUM(putaway_completed_quantity)
FROM ${PUT}
WHERE putaway_updated >= TO_DATE('{from}') AND "Warehouse Name" IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
  AND final_type IN ('New Inward','B2C Return Inward','Store Return Inward','B2B MP Returns','Audit Activity') AND is_trading = TRUE
GROUP BY 1, 2, 3, 4`;

type Row = { day: string | null; site: string | null; stream: string; event: string; unit: string; qty: number };

export async function pullStageOutput(from = STAGE_FROM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const raw = (await sfQuery<Row>(STAGE_SQL.replaceAll("{from}", from))).filter((r) => r.day && r.site && r.stream);
  // The SLA source keeps ~60 days by order creation, so event days in its first week are partial (items created earlier have
  // aged out). Those edge days are written only if never stored, so a moving window can't overwrite a complete count.
  const slaEvs = ["picked", "packed", "manifested", "dispatched"];
  const first = raw.filter((r) => slaEvs.includes(r.event)).map((r) => r.day!).sort()[0];
  const edge = first ? new Date(Date.parse(`${first}T00:00:00Z`) + EDGE_DAYS * 864e5).toISOString().slice(0, 10) : null;
  const stored = new Set(edge ? (await q<{ d: string }>(`select distinct day::text as d from wcm_stage_output where event = any($1::text[]) and day < $2`, [slaEvs, edge])).map((r) => r.d) : []);
  const rows = raw.filter((r) => !(slaEvs.includes(r.event) && edge && r.day! < edge && stored.has(r.day!)));
  // replace per source (event family) only the days that source returned
  const families = [slaEvs, ["putaway", "audit_move"]];
  for (const evs of families) {
    const days = [...new Set(rows.filter((r) => evs.includes(r.event)).map((r) => r.day!))];
    if (days.length) await q(`delete from wcm_stage_output where event = any($1::text[]) and day = any($2::date[])`, [evs, days]);
  }
  for (let i = 0; i < rows.length; i += 2000) {
    const c = rows.slice(i, i + 2000);
    await q(`insert into wcm_stage_output (day, site, stream, event, unit, qty, source)
             select d::date, s, st, e, u, n, src from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[]) as t(d, s, st, e, u, n, src)
             on conflict (day, site, stream, event) do update set qty = excluded.qty, unit = excluded.unit, source = excluded.source, fetched_at = now()`,
      [c.map((r) => r.day), c.map((r) => r.site), c.map((r) => r.stream), c.map((r) => r.event), c.map((r) => r.unit), c.map((r) => Number(r.qty) || 0),
        c.map((r) => (r.event === "putaway" || r.event === "audit_move" ? "putaway_tracking" : "warehouse_sla_performance"))]);
  }
  return { read: rows.length, from, keptEdgeDays: [...stored].length };
}

/**
 * Per-cohort SLA from warehouse_sla_performance → wcm_sla_daily. Cohort = created day (IST wall clock, as above).
 * SLA deadline = TAT (1899 sentinel / blank ⇒ no deadline, counted apart). On time = DISPATCHED_TIMESTAMP1 ≤ TAT.
 * ON_HOLD is 'false' on every row (checked 21 Nov 2026), so no hold exclusion is possible; cancelled lines are excluded.
 * The &-columns (created&dispatch …) are same-day flags, not durations, so TAT hours are computed from the timestamps.
 */
export const SLA_SQL = `WITH s AS (
  SELECT saleorderitemcode AS id, ${SITE("warehouse_name")} AS site, ${STREAM} AS stream, created_timestamp AS c,
    "DISPATCHED_TIMESTAMP1" AS d, cancelled_timestamp AS x, IFF(tat > '2000-01-01', tat, NULL) AS t
  FROM ${SLA} WHERE warehouse_name IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') AND created_timestamp >= TO_DATE('{from}')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY saleorderitemcode ORDER BY last_updated DESC NULLS LAST) = 1),
e AS (SELECT *, x IS NULL AND t IS NOT NULL AS ok FROM s)
SELECT TO_VARCHAR(c::date, 'YYYY-MM-DD') AS day, site, stream, COUNT(*) AS lines, COUNT_IF(x IS NOT NULL) AS cancelled,
  COUNT_IF(x IS NULL AND t IS NULL) AS no_sla, COUNT_IF(ok) AS eligible, COUNT_IF(ok AND d IS NOT NULL) AS dispatched,
  COUNT_IF(ok AND d <= t) AS on_time, COUNT_IF(ok AND d IS NULL) AS open,
  COUNT_IF(ok AND d IS NULL AND t < CONVERT_TIMEZONE('Asia/Kolkata', CURRENT_TIMESTAMP())::timestamp_ntz) AS overdue,
  MEDIAN(IFF(ok AND d IS NOT NULL, DATEDIFF('minute', c, d) / 60, NULL)) AS p50_h,
  APPROX_PERCENTILE(IFF(ok AND d IS NOT NULL, DATEDIFF('minute', c, d) / 60, NULL), 0.9) AS p90_h
FROM e WHERE site IS NOT NULL GROUP BY 1, 2, 3`;

type SlaRow = { day: string; site: string; stream: string; lines: number; cancelled: number; no_sla: number; eligible: number; dispatched: number; on_time: number; open: number; overdue: number; p50_h: number | null; p90_h: number | null };
export async function pullSla(from = STAGE_FROM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const rows = (await sfQuery<SlaRow>(SLA_SQL.replaceAll("{from}", from))).filter((r) => r.day && r.site);
  const days = [...new Set(rows.map((r) => r.day))];
  if (days.length) await q(`delete from wcm_sla_daily where day = any($1::date[])`, [days]);
  const col = (k: keyof SlaRow) => rows.map((r) => (r[k] == null ? null : k === "day" || k === "site" || k === "stream" ? r[k] : Number(r[k])));
  if (rows.length)
    await q(`insert into wcm_sla_daily (day, site, stream, lines, cancelled, no_sla, eligible, dispatched, on_time, open, overdue, p50_h, p90_h)
             select * from unnest($1::date[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[], $11::int[], $12::numeric[], $13::numeric[])`,
      (["day", "site", "stream", "lines", "cancelled", "no_sla", "eligible", "dispatched", "on_time", "open", "overdue", "p50_h", "p90_h"] as const).map(col));
  return { read: rows.length, from };
}
