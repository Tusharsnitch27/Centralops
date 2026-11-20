// One-off: Cost Master › YLK_ / TAURU_Processing Costs → src/db/seed/aop-processing-fy27.json
// node scripts/extract-processing.mjs "<Cost Master.xlsx>"
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) throw new Error("usage: node scripts/extract-processing.mjs <cost-master.xlsx>");
const wb = XLSX.readFile(path);
const TABS = { "YLK_Processing Costs": "South", "TAURU_Processing Costs": "North" };
const TEXT_MONTH = { october: "2025-10-01", november: "2025-11-01", december: "2025-12-01", january: "2026-01-01" };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?[\d,.]+$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : null);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// Text month headers (October … January) are Oct'25 → Jan'26 in every block (returns / inward / inventory blocks stop at
// Dec'25 and already carry final output for December); later months are date serials.
const monthOf = (v) => {
  if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, "0")}-01`; }
  return TEXT_MONTH[clean(v).toLowerCase()] ?? null;
};
function streamOf(family, channel, processes) {
  const ch = channel.toLowerCase(), returns = /return/i.test(family) || processes.includes("Receiving");
  if (ch === "inward") return "Inward";
  if (ch === "inventory") return "Inventory";
  const c = ch.startsWith("shopify") ? "Shopify" : ch.startsWith("retail") ? "Retail" : ch.startsWith("market") ? "Marketplace" : null;
  if (!c) return null;
  const fam = /b2c/i.test(family) ? "B2C" : "B2B";
  return returns ? `${fam} Returns ${c}` : `${fam} ${c === "Retail" ? "Retail" : c}`;
}

const norms = [], monthly = [], skipped = [];
for (const [tab, warehouse] of Object.entries(TABS)) {
  const r = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null, raw: true });
  const workingDays = num(r[0][2]) ?? 23;
  for (let i = 0; i < r.length; i++) {
    if (clean(r[i]?.[0]) !== "Function") continue;
    const family = clean(r[i - 5]?.[0]), channel = clean(r[i - 2]?.[0]), monthRow = r[i - 3] ?? [];
    const procRows = [];
    for (let j = i + 1; j < r.length; j++) {
      const a = clean(r[j]?.[0]);
      if (!a || a.includes(">") || (num(r[j][1]) == null && num(r[j][2]) == null)) break;
      procRows.push(j);
    }
    const processes = procRows.map((j) => clean(r[j][0]));
    const stream = streamOf(family, channel, processes);
    if (!stream) { skipped.push(`${tab} row ${i + 1}: ${family}/${channel}`); continue; }
    // month blocks: each starts where the "Planned" row carries a month header, from col Q (16)
    const blocks = [];
    for (let c = 16; c < monthRow.length; c++) { const p = monthOf(monthRow[c]); if (p) blocks.push([c, p]); }
    procRows.forEach((j, k) => {
      const x = r[j], process = processes[k];
      norms.push({ warehouse, stream, process, target_per_day: num(x[1]), working_days: workingDays, avg_salary: num(x[5]), ideal_output: num(x[3]), sort: k,
        ...(process === "Capacity" ? { note: "fixed monthly ₹ line: planned MP = 1, avg_salary = the lump amount" } : {}) });
      for (const [c, period] of blocks) {
        const v = { sop_proj: num(x[c]), planned_mp: num(x[c + 2]), planned_exp: num(x[c + 3]), final_output: num(x[c + 5]) };
        if (v.sop_proj == null && v.planned_mp == null && v.final_output == null) continue;
        monthly.push({ period, warehouse, stream, process, sop_proj: v.sop_proj, planned_mp: v.planned_mp, final_output: v.final_output,
          avg_salary: v.planned_mp ? Math.round((v.planned_exp ?? 0) / v.planned_mp) : null });
      }
    });
  }
}
writeFileSync("src/db/seed/aop-processing-fy27.json", JSON.stringify({ source: "Central Operations Cost Master Sheet FY 26-27 › YLK_ / TAURU_Processing Costs", norms, monthly }, null, 1));
const count = (a) => Object.entries(a.reduce((m, x) => ((m[`${x.warehouse} · ${x.stream}`] = (m[`${x.warehouse} · ${x.stream}`] ?? 0) + 1), m), {})).map(([k, n]) => `${k}: ${n}`).join("\n  ");
console.log(`norms ${norms.length}\n  ${count(norms)}\nmonthly ${monthly.length}\n  ${count(monthly)}\nskipped: ${skipped.join("; ") || "none"}`);
