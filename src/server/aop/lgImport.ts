import "server-only";
import * as XLSX from "xlsx";
import { tx } from "../db";
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

/** Replace one dataset in a single transaction; returns what was loaded (rows, ₹) so the upload can be checked against the file. */
export async function loadLogistics(actorId: string, kind: "b2c" | "b2b", fileName: string, buf: ArrayBuffer) {
  const source = `${fileName} · ${new Date().toISOString().slice(0, 10)}`;
  if (kind === "b2c") {
    const b = parseB2c(buf);
    if (!b.length) throw new Error("No courier rows found in RAW");
    await tx(async (t) => {
      await t.q(`delete from lg_b2c_month`);
      await t.q(`insert into lg_b2c_month (source, month, courier, type, awbs, cost, qty, cell)
                 select $1, m::date, c, ty, a, co, q, ce from unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[]) as x(m, c, ty, a, co, q, ce)`,
        [source, b.map((r) => r.month), b.map((r) => r.courier), b.map((r) => r.type), b.map((r) => r.awbs), b.map((r) => r.cost), b.map((r) => r.qty), b.map((r) => r.cell)]);
      await logActivity({ actorId, entityType: "aop_section", entityId: null, action: "logistics_b2c_loaded", from: null, to: { source, rows: b.length }, summary: `Logistics B2C working file loaded: ${b.length} courier-month rows (${fileName})` }, t);
    });
    return { rows: b.length, amount: b.reduce((a, r) => a + (r.cost ?? 0), 0) };
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
