// Warehouse Cost Master source lines: every terminal Budget / Provision / Actuals cell of the Cost Master's warehouse tabs,
// with its sheet-cell lineage, plus the sheet's own subtotal cells as controls (never imported as amounts).
// node scripts/extract-wcm.mjs "<Cost Master.xlsx>" <snapshot-date YYYY-MM-DD>
//   → src/db/seed/wcm-costmaster-<date>.json
// Rules: blank cell = missing input (amount null); 0 = booked zero; parent totals are controls only.
import XLSX from "xlsx";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [path, date] = process.argv.slice(2);
if (!path || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("usage: node scripts/extract-wcm.mjs <cost-master.xlsx> <YYYY-MM-DD>");
const buf = readFileSync(path);
const wb = XLSX.read(buf, { cellFormula: false });
const BASES = ["budget", "provision", "actual"];
const SITES = ["South", "North"];
const FY = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"].map((m, i) => `${i < 9 ? 2026 : 2027}-${m}-01`);
const ref = (c, r) => XLSX.utils.encode_cell({ c, r });
const cellOf = (sheet, c, r) => wb.Sheets[sheet][ref(c, r)];
const label = (sheet, c, r) => String(cellOf(sheet, c, r)?.v ?? "").replace(/\s+/g, " ").trim();
/** null = blank (missing input); numbers kept signed, to the paise. Text in a value cell is an error, not a zero. */
function amount(sheet, c, r) {
  const x = cellOf(sheet, c, r);
  if (!x || x.v === "" || x.v == null) return null;
  if (typeof x.v !== "number") throw new Error(`${sheet}!${ref(c, r)} is not a number: ${JSON.stringify(x.v)}`);
  return Math.round(x.v * 100) / 100;
}
const serialMonth = (s) => { const d = XLSX.SSF.parse_date_code(s); return `${d.y}-${String(d.m).padStart(2, "0")}-01`; };

const lines = [], controls = [];
const line = (o) => lines.push(o);

// Warehousing: rows 5–17 = cost heads; month blocks of 6 columns from D (site × Budget / Provision / Actuals), Apr → Nov.
{
  const S = "Warehousing";
  for (let m = 0; m < 8; m++) {
    if (!/^[A-Za-z]/.test(label(S, 3 + m * 6, 0))) throw new Error(`${S}: month header missing at ${ref(3 + m * 6, 0)}`);
    for (const [si, site] of SITES.entries()) for (const [bi, basis] of BASES.entries()) {
      const c = 3 + m * 6 + si * 3 + bi;
      if (label(S, c, 2).toLowerCase() !== ["budget", "provision", "actuals/invoices"][bi]) throw new Error(`${S}!${ref(c, 2)} header is "${label(S, c, 2)}"`);
      for (let r = 4; r <= 16; r++) {
        const head = label(S, 2, r);
        if (!head) continue;
        line({ period: FY[m], basis, site, family: "warehousing", head, channel: null, amount: amount(S, c, r), cell: `${S}!${ref(c, r)}` });
      }
      controls.push({ period: FY[m], basis, site, family: "warehousing", amount: amount(S, c, 3), cell: `${S}!${ref(c, 3)}`, what: "Grand Total" });
    }
  }
}
// Manpower+OT: rows 5 (Monthly OT) and 6 (Monthly Manpower Cost); each 6-column block carries a date in row 1 — the month is read
// from that date (the Storage & Handling tab reads it the same way). Blocks: D, J, P, … ; site × basis as in Warehousing.
{
  const S = "Manpower+OT__ WAREHOUSE";
  for (let k = 0; k < 8; k++) {
    const h = cellOf(S, 3 + k * 6, 0);
    if (typeof h?.v !== "number") continue;
    const period = serialMonth(h.v);
    for (const [si, site] of SITES.entries()) for (const [bi, basis] of BASES.entries()) {
      const c = 3 + k * 6 + si * 3 + bi;
      for (const [r, family] of [[4, "ot"], [5, "manpower"]])
        line({ period, basis, site, family, head: label(S, 2, r), channel: null, amount: amount(S, c, r), cell: `${S}!${ref(c, r)}`, note: `month from block header date ${ref(3 + k * 6, 0)}` });
      controls.push({ period, basis, site, family: "manpower+ot", amount: amount(S, c, 3), cell: `${S}!${ref(c, 3)}`, what: "Grand Total" });
    }
  }
  // months with no block in the tab: labour is still expected — record it as missing so it shows as a coverage gap, never as ₹0
  const have = new Set(lines.filter((l) => l.family === "manpower").map((l) => l.period));
  for (const period of FY.slice(0, 8).filter((p) => !have.has(p)))
    for (const site of SITES) for (const basis of BASES) for (const [family, head] of [["ot", "Monthly OT"], ["manpower", "Monthly Manpower Cost"]])
      line({ period, basis, site, family, head, channel: null, amount: null, cell: `${S}!(no month block)`, note: "no block for this month in the source tab" });
}
// Packaging: rows 5–8 = channel lines (no site split → Both); 3-column month blocks from C, May → Nov. Row 4 = control.
{
  const S = "Packaging";
  const CH = { Shopify: "B2C Shopify", Marketplace: "B2C Marketplace", "B2B MP": "B2B Marketplace", Store: "B2B Retail" };
  for (let k = 0; k < 7; k++) for (const [bi, basis] of BASES.entries()) {
    const c = 2 + k * 3 + bi, period = FY[k + 1];
    for (let r = 4; r <= 7; r++) {
      const head = label(S, 1, r);
      if (!(head in CH)) throw new Error(`${S}!${ref(1, r)}: unknown channel line "${head}"`);
      line({ period, basis, site: "Both", family: "packaging", head, channel: CH[head], amount: amount(S, c, r), cell: `${S}!${ref(c, r)}` });
    }
    controls.push({ period, basis, site: "Both", family: "packaging", amount: amount(S, c, 3), cell: `${S}!${ref(c, 3)}`, what: "At channel level" });
  }
}
// Workbook snapshot controls (observations, not imported): Storage & Handling tab totals as recorded on the day.
const SH = "WH-Storage & Handling Cost";
const shCols = Object.fromEntries(FY.map((p, i) => [p, 3 + i]));
const shRows = { South: { total: 8, storage: 9, handling: 10, unallocated: 11, warehousing: 7 }, North: { total: 24, storage: 25, handling: 26, unallocated: 27, warehousing: 23 }, Both: { total: 40, storage: 41, handling: 42, unallocated: 43, warehousing: 39 } };
const workbook = [];
for (const [site, rows] of Object.entries(shRows)) for (const [p, c] of Object.entries(shCols))
  for (const [what, r] of Object.entries(rows)) { const v = amount(SH, c, r); if (v != null) workbook.push({ period: p, site, what, amount: v, cell: `${SH}!${ref(c, r)}` }); }

// leaves must add up to the sheet's own subtotal wherever the subtotal is filled
const sum = (xs) => Math.round(xs.reduce((a, x) => a + (x.amount ?? 0), 0) * 100) / 100;
const fam = { "manpower+ot": ["manpower", "ot"] };
const mismatches = controls.filter((k) => k.amount != null).map((k) => {
  const leaves = lines.filter((l) => l.period === k.period && l.basis === k.basis && l.site === k.site && (fam[k.family] ?? [k.family]).includes(l.family));
  return { ...k, leaves: sum(leaves), diff: Math.round((k.amount - sum(leaves)) * 100) / 100 };
}).filter((k) => Math.abs(k.diff) >= 0.01);

const out = {
  snapshot: { id: `costmaster-${date}`, file: basename(path), sha256: createHash("sha256").update(buf).digest("hex"), taken: date,
    source: "Central Operations Cost Master Sheet FY 26-27 › Warehousing, Manpower+OT__ WAREHOUSE, Packaging" },
  lines, controls, workbook, mismatches,
};
const file = `src/db/seed/wcm-costmaster-${date}.json`;
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`${file}: ${lines.length} lines (${lines.filter((l) => l.amount == null).length} missing), ${controls.length} controls, ${mismatches.length} control mismatches`);
for (const m of mismatches) console.log("  mismatch", m.cell, m.period, m.site, m.basis, "control", m.amount, "leaves", m.leaves, "diff", m.diff);
