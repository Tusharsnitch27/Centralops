// Courier bills → cost per forward shipment by what the package holds (Malhar M, 24 Nov 2026).
//   node scripts/courier-category.mjs "<folder with the month's raw courier bills>" "<out.csv>"
// Reads every bill it recognises by its header row (Shiprocket, Delhivery, Ekart, Blitz, Shadowfax Large forward, Blue Dart, Prozo);
// forward rows only (reverse / DTO / RVP rows skipped; RTO shares the forward AWB, so a shipment's cost is all-in). Each AWB is matched to its
// package in UNICOMMERCE_FACT_ITEMS_INTERMEDIATE (read-only Snowflake, credentials from .env.local) and grouped by the first of: Shoes, Perfume,
// Bags / trolley, Accessories / belts / sunglasses, Winterwear, Apparel only. Output: month, channel, courier, group, shipments, cost (pre-tax ₹),
// kg (charged) — load it in AOP › Data › Logistics files. The bills stay out of the repository; so does the CSV.
// Checked 24 Nov on the Oct files: bill totals tie to the partner cost file (Delhivery 19,762 AWBs ₹14.18 L, Ekart 12,912 ₹8.84 L, Blue Dart
// 51,274 ₹50.39 L, Prozo, Shiprocket); Blitz's sheet carries a grand-total row (blank AWB), skipped. The main Shadowfax forward bill is a pivot
// with no AWBs, so Shadowfax forward is not split.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx"), sf = require("snowflake-sdk");

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: node scripts/courier-category.mjs "<bills folder>" "<out.csv>"'); process.exit(1); }
const num = (v) => { const n = Number(String(v ?? "").replace(/[₹,\s']/g, "")); return Number.isFinite(n) ? n : null; };
const kg = (w) => (w == null ? null : w > 30 ? w / 1000 : w); // grams vs kg by size
const excelDay = (v) => (typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + v * 864e5) : v ? new Date(String(v).replace(" ", "T")) : null);
const awbOf = (v) => String(v ?? "").replace(/['"\s]/g, "").toUpperCase();

/** One parser per bill format, picked by a header it alone carries. row → { awb, cost, kg, day } or null (not a forward shipment). */
const FORMATS = [
  { courier: "Shiprocket", has: "SR Order ID", row: (r) => /true/i.test(r["IS Reverse"]) ? null : { awb: r["Tracking ID"], cost: num(r["Pre-Tax Charges"]), kg: kg(num(r["Charged Weight"])), day: r["Pickup Date"] || r["Placed Date"] } },
  { courier: "Delhivery", has: "waybill_num", row: (r) => /pickup/i.test(r.package_type) || /DTO/i.test(r.status) ? null : { awb: r.waybill_num, cost: num(r.gross_amount), kg: kg(num(r.charged_weight)), day: r.pickup_date } },
  { courier: "Ekart", has: "TRACKING_ID", row: (r) => /rvp|reverse/i.test(`${r.SHIPMENT_TYPE}${r.MOVEMENT_TYPE}`) ? null : { awb: r.TRACKING_ID, cost: num(r.NET_REVENUE), kg: kg(num(r.BILLEABLE_WEIGHT)), day: r.PICKUP_DATE } },
  { courier: "Blitz", has: "Shipment Cost Type", row: (r) => /rev|rvp/i.test(r["Shipment Cost Type"]) ? null : { awb: r.Awb, cost: num(r["Total Shipment Charges"]), kg: kg(num(r["Final Weight"])), day: r["Pickup Date"] } },
  { courier: "Shadowfax", has: "received_at_hub_date", row: (r) => ({ awb: r.awb_number, cost: num(r.total_charges), kg: kg(num(r.weight)), day: r.picked_date }) },
  // Blue Dart's headers sit one column left of the values: the pre-tax total (Σ charge columns) is under "GST"
  { courier: "Bluedart", has: "CAWBNO", row: (r) => ({ awb: r.CAWBNO, cost: num(r.GST), kg: kg(num(r.NCHRGWT)), day: r.DBATCHDT }) },
  { courier: "Prozo", has: "AWB NUMBER", row: (r) => String(r.Mode).toUpperCase() !== "FWD" ? null : { awb: r["AWB NUMBER"], cost: num(r[" Total pricing for shipment Exc GST "] ?? r.TOTAL), kg: kg(num(r.Weight)), day: r["Proship Order Date"] } },
];

const bills = [];
for (const f of fs.readdirSync(dir).filter((f) => /\.(csv|xlsx?|xls)$/i.test(f) && !f.startsWith("~$"))) {
  const wb = XLSX.readFile(path.join(dir, f));
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const hdr = grid.findIndex((r, i) => i < 5 && FORMATS.some((x) => r.map((c) => String(c).trim()).includes(x.has)));
    if (hdr < 0) continue;
    const fmt = FORMATS.find((x) => grid[hdr].map((c) => String(c).trim()).includes(x.has));
    let n = 0;
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", range: hdr })) {
      const b = fmt.row(r);
      if (!b || !awbOf(b.awb) || b.cost == null) continue; // grand-total rows have no AWB
      const d = excelDay(b.day);
      bills.push({ courier: fmt.courier, awb: awbOf(b.awb), cost: b.cost, kg: b.kg, month: d && !isNaN(d) ? `${d.toISOString().slice(0, 7)}-01` : null });
      n++;
    }
    console.log(`${f} › ${name}: ${fmt.courier}, ${n} forward bills`);
    break;
  }
}
if (!bills.length) { console.error("No bill recognised in", dir); process.exit(1); }
// the bills' month: the most common pickup month (a few pickups fall a day either side)
const mc = {}; for (const b of bills) if (b.month) mc[b.month] = (mc[b.month] ?? 0) + 1;
const month = Object.entries(mc).sort((a, b) => b[1] - a[1])[0][0];

// AWB → package profile, packages dispatched from 20 days before to 10 days after the month
for (const l of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = l.match(/^(SNOWFLAKE_[A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); }
const e = process.env;
sf.configure({ logLevel: "ERROR" });
const conn = sf.createConnection({ account: e.SNOWFLAKE_ACCOUNT, username: e.SNOWFLAKE_USERNAME, role: e.SNOWFLAKE_ROLE, warehouse: e.SNOWFLAKE_WAREHOUSE, database: e.SNOWFLAKE_DATABASE, authenticator: "PROGRAMMATIC_ACCESS_TOKEN", token: e.SNOWFLAKE_PAT });
await new Promise((ok, no) => conn.connect((err) => (err ? no(err) : ok())));
const SQL = `with i as (select upper(trim(awb)) awb, iff(marketplace_mapped = 'SHOPIFY', 'B2C Shopify', 'B2C Marketplace') ch,
  case upper(trim(category)) when 'FOOTWEAR' then 'SHOES' when 'SWEATER' then 'SWEATERS' else upper(trim(category)) end cat
  from snitch_db.maplemonk.UNICOMMERCE_FACT_ITEMS_INTERMEDIATE
  where dispatched_timestamp >= dateadd(day, -20, to_date(?)) and dispatched_timestamp < dateadd(day, 10, dateadd(month, 1, to_date(?)))
    and warehouse_name in ('SAPL-WH1','SAPL-WH2','SAPL-NORTH-TAURU') and awb is not null
    and marketplace_mapped in ('SHOPIFY','AJIO','AMAZON','COCOBLU','FLIPKART','MYNTRA','NYKAA.COM','NYKAA_FASHION'))
select awb, max(ch) ch, max(iff(cat = 'SHOES', 1, 0)) sh, max(iff(cat = 'PERFUMES', 1, 0)) pf, max(iff(cat in ('BAGS','TROLLEY'), 1, 0)) bg,
  max(iff(cat in ('SUNGLASSES','ACCESSORIES','BELTS'), 1, 0)) ac, max(iff(cat in ('JACKETS','SWEATERS','HOODIES','SWEATSHIRTS','BLAZERS'), 1, 0)) wn from i group by 1`;
const pk = await new Promise((ok, no) => conn.execute({ sqlText: SQL, binds: [month, month], complete: (err, _s, rows) => (err ? no(err) : ok(rows)) }));
const prof = new Map(pk.map((r) => [r.AWB, r]));
const group = (p) => (p.SH ? "Shoes" : p.PF ? "Perfume" : p.BG ? "Bags / trolley" : p.AC ? "Accessories / belts / sunglasses" : p.WN ? "Winterwear" : "Apparel only");

const agg = new Map(); let matched = 0;
for (const b of bills) {
  const p = prof.get(b.awb); if (!p) continue; matched++;
  const k = [month, p.CH, b.courier, group(p)].join("|"), a = agg.get(k) ?? { ships: 0, cost: 0, kg: 0, kgN: 0 };
  a.ships++; a.cost += b.cost; if (b.kg != null) { a.kg += b.kg; a.kgN++; }
  agg.set(k, a);
}
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
fs.writeFileSync(out, ["month,channel,courier,group,shipments,cost,kg", ...[...agg].map(([k, a]) => { const [m, ch, c, g] = k.split("|");
  return [m, q(ch), q(c), q(g), a.ships, a.cost.toFixed(2), a.kgN ? (a.kg * a.ships / a.kgN).toFixed(2) : ""].join(","); })].join("\n"));
console.log(`${month}: ${bills.length} forward bills, ${matched} matched to a package (${Math.round(100 * matched / bills.length)} %) → ${out}`);
conn.destroy(() => {});
