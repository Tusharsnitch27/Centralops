import "server-only";
import { q, tx } from "../db";
import { sfQuery } from "../snowflake";
import { placementSla } from "./aggregate";

/** Feeds for the AOP Functions view: store orders, handover rulebook, WAM inward. Read-only Snowflake; missing is null, never 0. */
const num = (v: unknown) => (v == null ? null : Number(v));
const chunks = <T,>(a: T[], n = 2000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** DISTRIBUTION_ANALYTICS repeats an order_name 2–4 times (same date / store / quantity, packages differ): one row per order. Rolling ~60 days. */
const ORDERS_SQL = `SELECT ORDER_NAME AS order_name, TO_VARCHAR(MAX(ORDER_DATE), 'YYYY-MM-DD') AS order_date,
  MAX(IFF(WAREHOUSE_NAME = 'SAPL-NORTH-TAURU', 'North', 'South')) AS site, MAX(STORE) AS store, MAX(RECEIVER_CITY) AS city,
  MAX(QUANTITY) AS quantity, MAX(PACKAGE_COUNT) AS packages, MAX(ORDER_TYPE) AS order_type, MAX(ORDER_PLACEMENT_SLA) AS placement_sla
FROM snitch_db.maplemonk.DISTRIBUTION_ANALYTICS WHERE ORDER_DATE >= TO_DATE('{from}') AND ORDER_NAME IS NOT NULL GROUP BY ORDER_NAME`;
/** retail_journey_spine: the same UC store orders from March 2026, with the rulebook's store names; its placement flag is filled from Sep. */
const SPINE_ORDERS_SQL = `SELECT ORDER_NAME AS order_name, TO_VARCHAR(ORDER_DATE, 'YYYY-MM-DD') AS order_date, TO_VARCHAR(ORDER_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') AS order_ts,
  IFF(WAREHOUSE_NAME = 'SAPL-NORTH-TAURU', 'North', 'South') AS site, STORE AS store, RECEIVER_CITY AS city, QUANTITY AS quantity, PACKAGE_COUNT AS packages,
  ORDER_TYPE AS order_type, ORDER_PLACEMENT_SLA AS placement_sla
FROM snitch_db.maplemonk.retail_journey_spine
WHERE ORDER_DATE >= TO_DATE('{from}') AND ORDER_NAME IS NOT NULL AND WAREHOUSE_NAME IN ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU')
QUALIFY ROW_NUMBER() OVER (PARTITION BY ORDER_NAME ORDER BY LAST_UPDATED DESC NULLS LAST) = 1`;
type OrderRow = { order_name: string; order_date: string; order_ts?: string | null; site: string; store: string | null; city: string | null; quantity: number | null;
  packages: number | null; order_type: string | null; placement_sla: string | null };

/** Upsert orders; a row without its own placement flag keeps the one stored (DISTRIBUTION_ANALYTICS over the spine's computed flag). */
async function upsertOrders(rows: OrderRow[]) {
  for (const c of chunks(rows)) {
    await q(`insert into fn_retail_order (order_name, order_date, site, store, city, quantity, packages, order_type, placement_sla)
             select * from unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[])
             on conflict (order_name) do update set order_date = excluded.order_date, site = excluded.site, store = excluded.store, city = excluded.city,
               quantity = excluded.quantity, packages = excluded.packages, order_type = excluded.order_type,
               placement_sla = coalesce(excluded.placement_sla, fn_retail_order.placement_sla), fetched_at = now()`,
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
  await upsertOrders(spine);
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
