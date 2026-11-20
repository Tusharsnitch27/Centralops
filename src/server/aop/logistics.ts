import "server-only";
import { q } from "../db";
import { sfQuery } from "../snowflake";
import type { AttributionRow } from "./processingTypes";

/**
 * Logistics volumes by channel + interim cost attribution (until the Cost Master's channel-split tab exists).
 *
 * Sources (Snowflake, read-only):
 *  - B2C + Q-Com: snitch_db.maplemonk.cp_1 — one row per AWB (Shopify orders only; marketplaces ship on their own logistics).
 *      day = PICKUP_DATE · warehouse YLK1/YLK2 → South, TAURU → North, Qcom / blank (most reverse pickups) → Other
 *      channel: COURIER_PARTNER LIKE '%HLD%' → Q-Com, else B2C Shopify · JOURNEY Reverse → rvp, Forward / RTO → forward
 *  - B2B: snitch_db.maplemonk.ESHIPZ_FINAL_GET_TRACKING (Logic ERP dispatches; CREATION_DATE is text "Wed, 18 Feb 2026 10:53:07 GMT")
 *      warehouse = sender city (reverse: receiver city) Bengaluru → South, Gurugram → North
 *      channel: counterparty "SNITCH…" (stores, own entity) → B2B Retail, anyone else (Shivera / Myntra, Abacus, Flipkart …) → B2B Marketplace
 *
 * aop_channel_volume rows (family = 'logistics'):
 *  metric 'shipments'          forward AWBs (incl. RTO) per day × warehouse × channel
 *  metric 'rvp'                reverse pickups
 *  metric 'shipments:<Vendor>' every AWB billed by that vendor (forward + RTO + reverse); <Vendor> = the AOP Logistics item name
 */
export const LOGISTICS_FROM = "2026-07-01";
const ESHIPZ_TABLE = "snitch_db.maplemonk.ESHIPZ_FINAL_GET_TRACKING";
const CP1_TABLE = "snitch_db.maplemonk.cp_1";

// courier → AOP Logistics item name (B2C section). Proship is Prozo's shipping product.
const CP1_VENDOR = `CASE
    WHEN COURIER_PARTNER ILIKE 'Shiprocket HLD%' THEN 'SR Quick'
    WHEN COURIER_PARTNER ILIKE 'Pidge%' THEN 'Pidge Quick'
    WHEN COURIER_PARTNER ILIKE 'Shadowfax Now%' THEN 'SFX HLD'
    WHEN COURIER_PARTNER ILIKE 'Porter%' THEN 'Porter - QCom'
    WHEN COURIER_PARTNER ILIKE 'Fynd%' THEN 'Fynd HLD'
    WHEN COURIER_PARTNER ILIKE 'Bluedart%' THEN 'Bluedart'
    WHEN COURIER_PARTNER ILIKE 'Shadowfax%' OR COURIER_PARTNER ILIKE 'SFX%' THEN 'Shadowfax'
    WHEN COURIER_PARTNER ILIKE 'Blitz%' THEN 'Bigshort Pvt Ltd (Blitz)'
    WHEN COURIER_PARTNER ILIKE 'Proship%' THEN 'Prozo'
    WHEN COURIER_PARTNER ILIKE 'Delhivery%' THEN 'Delhivery'
    WHEN COURIER_PARTNER ILIKE 'Ekart%' THEN 'Instakart Pvt Ltd (eKart)'
    WHEN COURIER_PARTNER ILIKE 'Urbane%' THEN 'Urbonebolt'
    WHEN COURIER_PARTNER ILIKE 'Shiprocket%' THEN 'Bigfoot (Shiprocket)'
    ELSE COURIER_PARTNER END`;
// eShipz vendor slug → AOP Logistics item name (B2B section)
const ESHIPZ_VENDOR = `CASE LOWER(TRIM(VENDOR_NAME))
    WHEN 'bluedart' THEN 'Bluedart' WHEN 'mudita_cargo' THEN 'Mudita Cargo' WHEN 'movemate' THEN 'Movemate' WHEN 'movemate logistics' THEN 'Movemate'
    WHEN 'stockarea' THEN 'Stock Area' WHEN 'ekart_b2b_cargo' THEN 'Ekart B2B' WHEN 'maruti_air' THEN 'Sri Maruti Courier' WHEN 'xpindia' THEN 'XP India'
    ELSE VENDOR_NAME END`;
const EZ_DAY = `TRY_TO_TIMESTAMP(CREATION_DATE, 'DY, DD MON YYYY HH24:MI:SS GMT')`;
const city = (who: "sender" | "receiver") => `UPPER(ORDER_DETAILS:${who}_address:city::string)`;
const party = (who: "sender" | "receiver") => `UPPER(ORDER_DETAILS:${who}_address:company_name::string)`;
const ezWh = (c: string) => `CASE WHEN ${c} ILIKE '%GURU%' OR ${c} ILIKE '%GURGAON%' THEN 'North' WHEN ${c} ILIKE '%BENGAL%' OR ${c} ILIKE '%BANGAL%' THEN 'South' ELSE 'Other' END`;

/** day × warehouse × channel × vendor × dir (fwd | rvp) → distinct AWBs. Bind 1 and 2 = from date. */
export const LOGISTICS_SQL = `
SELECT TO_VARCHAR(PICKUP_DATE::date, 'YYYY-MM-DD') AS day,
  CASE WHEN WAREHOUSE IN ('YLK1','YLK2') THEN 'South' WHEN WAREHOUSE = 'TAURU' THEN 'North' ELSE 'Other' END AS warehouse,
  CASE WHEN COURIER_PARTNER ILIKE '%HLD%' THEN 'Q-Com' ELSE 'B2C Shopify' END AS channel,
  ${CP1_VENDOR} AS vendor,
  CASE WHEN JOURNEY = 'Reverse' THEN 'rvp' ELSE 'fwd' END AS dir,
  COUNT(DISTINCT AWB_NUMBER) AS n
FROM ${CP1_TABLE}
WHERE PICKUP_DATE >= TO_DATE(?)
GROUP BY 1, 2, 3, 4, 5
UNION ALL
SELECT TO_VARCHAR(${EZ_DAY}::date, 'YYYY-MM-DD'),
  IFF(IS_REVERSE, ${ezWh(city("receiver"))}, ${ezWh(city("sender"))}),
  IFF(IFF(IS_REVERSE, ${party("sender")}, ${party("receiver")}) LIKE 'SNITCH%', 'B2B Retail', 'B2B Marketplace'),
  ${ESHIPZ_VENDOR},
  IFF(IS_REVERSE, 'rvp', 'fwd'),
  COUNT(DISTINCT AWB)
FROM ${ESHIPZ_TABLE}
WHERE ${EZ_DAY} >= TO_DATE(?) AND COALESCE(ORDER_SOURCE, '') <> 'test'
GROUP BY 1, 2, 3, 4, 5`;

type VolRow = { day: string; warehouse: string; channel: string; vendor: string; dir: "fwd" | "rvp"; n: number };

/** Snowflake → aop_channel_volume (family 'logistics'), replacing every day from `from`. */
export async function pullLogisticsVolumes(from = LOGISTICS_FROM) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("from must be YYYY-MM-DD");
  const rows = await sfQuery<VolRow>(LOGISTICS_SQL, [from, from]);
  const m = new Map<string, { day: string; warehouse: string; channel: string; metric: string; qty: number; source: string }>();
  const put = (r: VolRow, metric: string) => {
    const k = `${r.day}|${r.warehouse}|${r.channel}|${metric}`;
    const cur = m.get(k) ?? { day: r.day, warehouse: r.warehouse, channel: r.channel, metric, qty: 0, source: r.channel.startsWith("B2B") ? "eshipz" : "cp_1" };
    cur.qty += Number(r.n) || 0;
    m.set(k, cur);
  };
  for (const r of rows) {
    if (!r.day) continue;
    put(r, r.dir === "rvp" ? "rvp" : "shipments");
    put(r, `shipments:${r.vendor}`);
  }
  const v = [...m.values()];
  await q(`delete from aop_channel_volume where family = 'logistics' and day >= $1`, [from]);
  for (let i = 0; i < v.length; i += 2000) {
    const c = v.slice(i, i + 2000);
    await q(`insert into aop_channel_volume (day, warehouse, family, channel, metric, qty, source)
             select d::date, w, 'logistics', ch, mt, n, s from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[]) as t(d, w, ch, mt, n, s)`,
      [c.map((x) => x.day), c.map((x) => x.warehouse), c.map((x) => x.channel), c.map((x) => x.metric), c.map((x) => x.qty), c.map((x) => x.source)]);
  }
  return { read: rows.length, written: v.length, from };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isB2B = (bucket: string) => /b2b/i.test(bucket);
const B2B_CH = ["B2B Retail", "B2B Marketplace"];
const B2C_CH = ["B2C Shopify", "B2C Marketplace", "Q-Com"];

/** AOP line names that already say which channel they serve — attributed whole, no share needed. */
function namedChannel(name: string): string | null {
  if (/movemate.*market|ekart\s*mp/i.test(name)) return "B2B Marketplace";
  if (/movemate.*(nso|stock\s*transfer|milkrun)/i.test(name)) return "B2B Retail";
  if (/quick|hld|q-?com/i.test(name)) return "Q-Com";
  return null;
}
/** Volume key for a line: Movemate sub-lines share Movemate's AWBs. */
const volumeVendor = (name: string) => (/^movemate/i.test(name) ? "Movemate" : name);

/**
 * Logistics cost → channel, per month. Precedence per month:
 *  (a) rows in aop_cost_alloc (family 'logistics') — the channel-split tab, once imported → 'direct'
 *  (b) each AOP Logistics line (actual → provision → budget) split by that vendor's AWB share across its bucket's channels → 'allocated'
 *      (lines whose name names the channel, e.g. "Movemate- Marketplace", go whole → 'direct')
 *  (c) no AWBs for that vendor that month → stays on its AOP bucket (B2C / B2B) as 'pending'
 * units = AWBs (forward + RTO + reverse) of that vendor × channel; cpi = ₹ / AWB.
 */
export async function logisticsAttribution(months: string[]): Promise<AttributionRow[]> {
  if (!months.length) return [];
  const [lines, vols, alloc, chVols] = await Promise.all([
    q<{ item: string; bucket: string; period: string; plan: number | null; forecast: number | null; actual: number | null }>(
      `select i.name as item, s.name as bucket, v.period::text as period, v.plan::float8 as plan, v.forecast::float8 as forecast, v.actual::float8 as actual
       from aop_items i join aop_sections s on s.id = i.section_id join aop_sections f on f.id = s.parent_id
       join aop_cycles c on c.id = f.cycle_id and c.status = 'active'
       join aop_period_values v on v.item_id = i.id and v.period = any($1::date[])
       where f.name ilike 'logistics%' and i.active`, [months]),
    q<{ period: string; channel: string; vendor: string; n: number }>(
      `select date_trunc('month', day)::date::text as period, channel, substr(metric, 11) as vendor, sum(qty)::float8 as n
       from aop_channel_volume where family = 'logistics' and metric like 'shipments:%' and date_trunc('month', day)::date = any($1::date[])
       group by 1, 2, 3`, [months]),
    q<{ period: string; warehouse: string; channel: string; process: string; vendor: string; amount: number }>(
      `select period::text as period, warehouse, channel, process, vendor, amount::float8 as amount from aop_cost_alloc where family = 'logistics' and period = any($1::date[])`, [months]),
    q<{ period: string; channel: string; n: number }>(
      `select date_trunc('month', day)::date::text as period, channel, sum(qty)::float8 as n
       from aop_channel_volume where family = 'logistics' and metric in ('shipments','rvp') and date_trunc('month', day)::date = any($1::date[])
       group by 1, 2`, [months]),
  ]);
  const out: AttributionRow[] = [];
  const cpi = (amount: number, units: number | null) => (units ? amount / units : null);
  for (const p of months) {
    const direct = alloc.filter((a) => a.period === p);
    if (direct.length) {
      for (const a of direct) {
        const units = chVols.find((x) => x.period === p && x.channel === a.channel)?.n ?? null;
        out.push({ period: p, warehouse: a.warehouse as AttributionRow["warehouse"], family: "logistics", channel: a.channel, process: a.process || a.vendor,
          amount: a.amount, basis: "direct", key: "Cost Master channel split", units, cpi: cpi(a.amount, units) });
      }
      continue;
    }
    for (const l of lines.filter((x) => x.period === p)) {
      const [amount, which] = l.actual != null ? [l.actual, "actual"] : l.forecast != null ? [l.forecast, "provision"] : [l.plan ?? 0, "budget"];
      if (!amount) continue;
      const allowed = isB2B(l.bucket) ? B2B_CH : B2C_CH;
      const vv = vols.filter((x) => x.period === p && allowed.includes(x.channel) && norm(x.vendor) === norm(volumeVendor(l.item)));
      const base = { period: p, warehouse: "All" as const, family: "logistics" as const, process: l.item };
      const named = namedChannel(l.item);
      if (named) {
        const units = vv.filter((x) => x.channel === named).reduce((a, x) => a + x.n, 0) || null;
        out.push({ ...base, channel: named, amount, basis: "direct", key: `line names the channel (${which})`, units, cpi: cpi(amount, units) });
        continue;
      }
      const total = vv.reduce((a, x) => a + x.n, 0);
      if (!total) {
        out.push({ ...base, channel: l.bucket, amount, basis: "pending", key: `no ${l.item} AWBs found — waiting for the channel split (${which})`, units: null, cpi: null });
        continue;
      }
      const key = `${l.item} AWBs: ${vv.map((x) => `${x.channel.replace(/^B2[BC] /, "")} ${Math.round((x.n / total) * 100)}%`).join(" · ")} (${which})`;
      for (const x of vv) {
        const share = amount * (x.n / total);
        // ponytail: forward and reverse AWBs weigh the same; weight by rate card once vendor RVP rates are in the sheet
        out.push({ ...base, channel: x.channel, amount: share, basis: "allocated", key, units: x.n, cpi: cpi(share, x.n) });
      }
    }
  }
  return out;
}
