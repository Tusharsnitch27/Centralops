import "server-only";
import * as XLSX from "xlsx";
import { tx, type Tx } from "../db";
import { logActivity } from "../core/activity";

/**
 * Logistics working files, uploaded in-app (no billing data in git). Each upload replaces that dataset completely.
 *  B2C ("Partnerwise qty cost"): RAW sheet — Courier, Month, AWB No, Shipment Type, Billed Cost, Quantity.
 *  B2B ("Logistics Cost master data"): DATA sheet, one row per LR, plus the "BLR Own vehicle" sheet.
 * Freight is as billed, before credit notes. Every row keeps sheet!row lineage.
 */
const num = (v: unknown) => { const s = String(v ?? "").replace(/[₹,\s]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const MONTHS: Record<string, string> = { apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12", jan: "01", feb: "02", mar: "03" };
/** FY 2026-27 months: Apr–Dec 2026, Jan–Mar 2027. ponytail: fixed FY — take the year from the file once it carries one. */
const month = (m: unknown) => {
  const k = String(m).trim().toLowerCase().replace(/['’]?\s*\d+$/, "");
  const mm = MONTHS[k];
  if (!mm) throw new Error(`Unknown month "${String(m)}"`);
  return `${Number(mm) <= 3 ? 2027 : 2026}-${mm}-01`;
};
const COURIER: Record<string, string> = { SR: "Shiprocket", BD: "Bluedart", Delh: "Delhivery", SFX: "Shadowfax" };
export const siteOf = (f: string) => /mewat|ggn|gurgaon|gurugram|north|tauru|haryana|luhari|noida/i.test(f) ? "North" : /bangalore|bengaluru|blr|south|sapl-wh|karnataka|kolar|yelahanka/i.test(f) ? "South" : "Other";
export const typeOf = (t: unknown) => {
  const s = String(t ?? "").trim();
  if (/^acc$/i.test(s)) return "ACC";
  if (/^ad\s?hoc/i.test(s)) return "Adhoc";
  if (/^stock transfer$/i.test(s)) return "Stock Transfer";
  if (/^q-?comm?$|^qcom$/i.test(s)) return "Q-Comm";
  if (/^fresh/i.test(s)) return "Fresh";
  return s || "(blank)";
};
const sheet = (wb: XLSX.WorkBook, name: string) => {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found (sheets: ${wb.SheetNames.join(", ")})`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
};

export interface B2cRow { month: string; courier: string; type: string; awbs: number | null; cost: number | null; qty: number | null; cell: string }
export function parseB2c(buf: ArrayBuffer): B2cRow[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const rows = sheet(wb, "RAW").map((r, i) => ({ month: month(r.Month), courier: COURIER[String(r.Courier).trim()] ?? String(r.Courier).trim(), type: String(r["Shipment Type"]).trim(),
    awbs: num(r["AWB No"]), cost: num(r["Billed Cost"]), qty: num(r.Quantity), cell: `RAW!${i + 2}` })).filter((r) => r.courier && r.type);
  const seen = new Set<string>();
  for (const r of rows) { const k = `${r.month}|${r.courier}|${r.type}`; if (seen.has(k)) throw new Error(`Duplicate ${r.courier} ${r.type} for ${r.month} (${r.cell})`); seen.add(k); }
  return rows;
}

export interface LrRow { month: string; partner: string; lr: string; boxes: number | null; qty: number | null; facility: string; site: string; store: string; kg: number | null; freight: number | null; type: string; category: string; remark: string | null; cell: string }
export function parseB2b(buf: ArrayBuffer): LrRow[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const lr = (s: string, r: Record<string, unknown>, i: number): LrRow => ({
    month: month(r.Month), partner: String(r.Partner).trim(), lr: String(r.LR).trim(), boxes: num(r.Box), qty: num(r.QTY), facility: String(r.Facility).trim(),
    site: siteOf(String(r.Facility)), store: String(r.Store).trim(), kg: num(r["Charged Weight"]), freight: num(r["Freight Chared"] ?? r["Freight Charged"]),
    type: typeOf(r.Type), category: String(r["Dispatch Category"] ?? "").trim() || "(blank)", remark: String(r.Reamrks ?? r.Remarks ?? "").trim() || null, cell: `${s}!${i + 2}` });
  const own = wb.Sheets["BLR Own vehicle"] ? sheet(wb, "BLR Own vehicle").map((r, i) => {
    // from mid-year this sheet's Box and QTY columns are swapped (e.g. "84 boxes, 4 units"); a box holds ≥ 1 unit
    const x = { ...lr("BLR Own vehicle", r, i), category: "Own vehicle (BLR)" };
    return x.boxes != null && x.qty && x.boxes > x.qty ? { ...x, boxes: x.qty, qty: x.boxes, remark: "Box / QTY swapped in source — corrected" } : x;
  }) : [];
  return [...sheet(wb, "DATA").map((r, i) => lr("DATA", r, i)), ...own].filter((r) => r.partner);
}

export interface RvpRow { month: string; partner: string; flow: string; lrs: number | null; boxes: number | null; qty: number | null; amount: number | null; logistic: number | null; adhoc: number | null; kg: number | null; cell: string }
/**
 * "B2B & MP _ rvp costing": the Summary tab's partner blocks — a header row (partner name, then LR count, box, qty, pre-GST ₹,
 * logistic bill, ad-hoc bill, weight) followed by one row per month until "Grand Total". The MP block = marketplace shipments,
 * the rest = store returns (RVP). The raw tabs behind it are not re-added: the Summary is the file's own control.
 */
export function parseRvp(buf: ArrayBuffer): RvpRow[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const ws = wb.Sheets.Summary;
  if (!ws) throw new Error(`Sheet "Summary" not found (sheets: ${wb.SheetNames.join(", ")})`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const out: RvpRow[] = [];
  let partner: string | null = null;
  rows.forEach((r, i) => {
    const a = String(r[0] ?? "").trim(), b = String(r[1] ?? "").trim();
    if (a && /lr/i.test(b)) { partner = a; return; }
    if (!partner) return;
    if (!a || /grand total/i.test(a)) { if (/grand total/i.test(a)) partner = null; return; }
    let m: string;
    try { m = month(a); } catch { return; }
    const mp = /^mp[^a-z]/i.test(partner);
    out.push({ month: m, partner: mp ? "Movemate / Ekart (MP)" : partner[0] + partner.slice(1).toLowerCase(), flow: mp ? "Marketplace shipments" : "Store returns (RVP)",
      lrs: num(r[1]), boxes: num(r[2]), qty: num(r[3]), amount: num(r[4]), logistic: num(r[5]), adhoc: num(r[6]), kg: num(r[7]), cell: `Summary!A${i + 1}` });
  });
  const seen = new Set<string>();
  for (const r of out) { const k = `${r.month}|${r.partner}`; if (seen.has(k)) throw new Error(`Duplicate ${r.partner} for ${r.month} (${r.cell})`); seen.add(k); }
  return out;
}

/** B2C courier cost by package group: the CSV scripts/courier-category.mjs writes (month, channel, courier, group, shipments, cost, kg). */
export interface CatRow { month: string; channel: string; courier: string; grp: string; ships: number; cost: number; kg: number | null }
export function parseB2cCat(buf: ArrayBuffer): CatRow[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", raw: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { defval: "", raw: false });
  const out = rows.map((r, i) => {
    const m = String(r.month).trim(), ships = num(r.shipments), cost = num(r.cost);
    if (!/^\d{4}-\d{2}-01$/.test(m) || ships == null || cost == null || !r.courier || !r.group) throw new Error(`Row ${i + 2}: expected month (YYYY-MM-01), channel, courier, group, shipments, cost`);
    return { month: m, channel: String(r.channel).trim(), courier: String(r.courier).trim(), grp: String(r.group).trim(), ships, cost, kg: num(r.kg) };
  });
  if (!out.length) throw new Error("No rows: is this the CSV scripts/courier-category.mjs wrote?");
  return out;
}

/** Replace one dataset in a single transaction; returns what was loaded (rows, ₹) so the upload can be checked against the file. */
export async function loadLogistics(actorId: string, kind: "b2c" | "b2b" | "rvp" | "b2ccat", fileName: string, buf: ArrayBuffer) {
  const source = `${fileName} · ${new Date().toISOString().slice(0, 10)}`;
  if (kind === "b2ccat") {
    const c = parseB2cCat(buf), months = [...new Set(c.map((r) => r.month))];
    await tx(async (t) => {
      await t.q(`delete from lg_b2c_cat where month = any($1::date[])`, [months]); // an upload replaces only the months it carries
      await t.q(`insert into lg_b2c_cat (month, channel, courier, grp, ships, cost, kg, source)
                 select m::date, ch, co, g, s, c, k, $1 from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::numeric[], $8::numeric[]) as x(m, ch, co, g, s, c, k)`,
        [source, c.map((r) => r.month), c.map((r) => r.channel), c.map((r) => r.courier), c.map((r) => r.grp), c.map((r) => r.ships), c.map((r) => r.cost), c.map((r) => r.kg)]);
      await logActivity({ actorId, entityType: "aop_section", entityId: null, action: "logistics_b2c_cat_loaded", from: null, to: { source, rows: c.length }, summary: `B2C courier cost by package loaded: ${c.length} rows for ${months.join(", ")} (${fileName})` }, t);
    });
    return { rows: c.length, amount: c.reduce((a, r) => a + r.cost, 0) };
  }
  if (kind === "b2c") {
    const b = parseB2c(buf);
    let filled = 0;
    if (!b.length) throw new Error("No courier rows found in RAW");
    await tx(async (t) => {
      await t.q(`delete from lg_b2c_month`);
      await t.q(`insert into lg_b2c_month (source, month, courier, type, awbs, cost, qty, cell)
                 select $1, m::date, c, ty, a, co, q, ce from unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[]) as x(m, c, ty, a, co, q, ce)`,
        [source, b.map((r) => r.month), b.map((r) => r.courier), b.map((r) => r.type), b.map((r) => r.awbs), b.map((r) => r.cost), b.map((r) => r.qty), b.map((r) => r.cell)]);
      await logActivity({ actorId, entityType: "aop_section", entityId: null, action: "logistics_b2c_loaded", from: null, to: { source, rows: b.length }, summary: `Logistics B2C working file loaded: ${b.length} courier-month rows (${fileName})` }, t);
      filled = await fillB2cActuals(t, actorId, source);
    });
    return { rows: b.length, amount: b.reduce((a, r) => a + (r.cost ?? 0), 0), filled };
  }
  if (kind === "rvp") {
    const v = parseRvp(buf);
    if (!v.length) throw new Error("No partner-month rows found in Summary");
    await tx(async (t) => {
      await t.q(`delete from lg_rvp_month`);
      await t.q(`insert into lg_rvp_month (source, month, partner, flow, lrs, boxes, qty, amount, logistic, adhoc, kg, cell)
                 select $1, m::date, p, f, l, b, q, a, lo, ad, k, c from unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::text[])
                   as x(m, p, f, l, b, q, a, lo, ad, k, c)`,
        [source, v.map((r) => r.month), v.map((r) => r.partner), v.map((r) => r.flow), v.map((r) => r.lrs), v.map((r) => r.boxes), v.map((r) => r.qty), v.map((r) => r.amount), v.map((r) => r.logistic), v.map((r) => r.adhoc), v.map((r) => r.kg), v.map((r) => r.cell)]);
      await logActivity({ actorId, entityType: "aop_section", entityId: null, action: "logistics_rvp_loaded", from: null, to: { source, rows: v.length }, summary: `Logistics B2B RVP & MP file loaded: ${v.length} partner-month rows (${fileName})` }, t);
    });
    return { rows: v.length, amount: v.reduce((a, r) => a + (r.amount ?? 0), 0) };
  }
  const L = parseB2b(buf);
  if (!L.length) throw new Error("No LR rows found in DATA");
  await tx(async (t) => {
    await t.q(`delete from lg_b2b_lr`);
    for (let i = 0; i < L.length; i += 2000) {
      const c = L.slice(i, i + 2000), g = <K extends keyof LrRow>(k: K) => c.map((r) => r[k]);
      await t.q(`insert into lg_b2b_lr (source, cell, month, partner, lr, boxes, qty, facility, site, store, kg, freight, type, category, remark)
                 select $1, ce, m::date, p, l, b, q, f, s, st, k, fr, ty, ca, re from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[], $10::text[], $11::numeric[], $12::numeric[], $13::text[], $14::text[], $15::text[])
                   as x(ce, m, p, l, b, q, f, s, st, k, fr, ty, ca, re)`,
        [source, g("cell"), g("month"), g("partner"), g("lr"), g("boxes"), g("qty"), g("facility"), g("site"), g("store"), g("kg"), g("freight"), g("type"), g("category"), g("remark")]);
    }
    await logActivity({ actorId, entityType: "aop_section", entityId: null, action: "logistics_b2b_loaded", from: null, to: { source, rows: L.length }, summary: `Logistics B2B working file loaded: ${L.length} LRs (${fileName})` }, t);
  });
  return { rows: L.length, amount: L.reduce((a, r) => a + (r.freight ?? 0), 0) };
}

/**
 * AOP › Logistics › B2C actuals the file can fill: an EMPTY actual cell only (a booked or owner figure is never overwritten).
 * Line → courier and shipment types, each checked against months where both the AOP actual and the file exist (Aug–Oct 2026,
 * to the rupee): e.g. Shadowfax = FWD + RTO (its DTO is booked separately), Bluedart RVP = Bluedart DTO.
 */
const B2C_LINES: { line: string; courier: string; types: string[] | null }[] = [
  { line: "Shadowfax", courier: "Shadowfax", types: ["FWD", "RTO"] },
  { line: "Bluedart", courier: "Bluedart", types: ["FWD", "RTO"] },
  { line: "Bluedart RVP", courier: "Bluedart", types: ["DTO"] },
  { line: "Delhivery", courier: "Delhivery", types: null },
  { line: "Instakart Pvt Ltd (eKart)", courier: "Ekart", types: null },
  { line: "Prozo", courier: "Prozo", types: null },
  { line: "Bigfoot (Shiprocket)", courier: "Shiprocket", types: null },
];
async function fillB2cActuals(t: Tx, actorId: string, source: string) {
  let n = 0; const Q = t.q;
  for (const m of B2C_LINES) {
    const cells = await Q<{ item_id: string; period: string; cost: number }>(
      `select i.id as item_id, x.month::text as period, x.cost::float8 as cost
         from aop_items i join aop_sections s on s.id = i.section_id and s.name = 'B2C' join aop_sections f on f.id = s.parent_id and f.name = 'Logistics'
         join aop_cycles c on c.id = i.cycle_id and c.status = 'active'
         join (select month, sum(cost) as cost from lg_b2c_month where courier = $2 and ($3::text[] is null or type = any($3::text[])) and cost is not null group by 1) x
           on x.month >= c.fy_start and x.month < c.fy_start + make_interval(months => c.months)
         left join aop_period_values v on v.item_id = i.id and v.period = x.month
        where i.name = $1 and v.actual is null`, [m.line, m.courier, m.types]);
    for (const c of cells) {
      await Q(`insert into aop_period_values (item_id, period, actual) values ($1, $2, $3) on conflict (item_id, period) do update set actual = excluded.actual where aop_period_values.actual is null`, [c.item_id, c.period, c.cost]);
      await logActivity({ actorId, entityType: "aop_item", entityId: c.item_id, action: "actual_from_logistics_file", from: null, to: { period: c.period, actual: c.cost },
        summary: `${m.line} ${c.period.slice(0, 7)} actual from the B2C partner file (${m.courier}${m.types ? ` ${m.types.join(" + ")}` : ""}, ${source})` }, t);
      n++;
    }
  }
  return n;
}
