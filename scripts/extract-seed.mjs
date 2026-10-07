// One-off: turns the two source workbooks into JSON seed files (src/db/seed/*.json).
// node scripts/extract-seed.mjs "<Cost Master.xlsx>" "<S&OP Projection.xlsx>"
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";

const [costPath, sopPath] = process.argv.slice(2);
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
const period = (m) => { const i = MONTHS.indexOf(m); return `${i < 9 ? 2026 : 2027}-${String(((i + 3) % 12) + 1).padStart(2, "0")}-01`; };
const num = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "`" || s === "SAMPLE" || /not yet/i.test(s) || s.startsWith("#")) return null;
  const usd = s.endsWith("$");
  const n = Number(s.replace(/[$,₹\s]/g, ""));
  return Number.isFinite(n) ? (usd ? Math.round(n * 88) : n) : null;
};
const rows = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const serialMonth = (s) => { const d = XLSX.SSF.parse_date_code(s); return `${d.y}-${String(d.m).padStart(2, "0")}-01`; };

/* ---------------- AOP: Central Ops cost FY 26-27 ---------------- */
const cost = XLSX.readFile(costPath);
const functions = [];
const fn = (name, owners, cutoff) => { const f = { name, owners, cutoff, sections: [] }; functions.push(f); return f; };
const sec = (f, name) => { const s = { name, items: [] }; f.sections.push(s); return s; };
const put = (s, name, values, attrs = {}) => {
  const vals = values.filter((v) => v.plan != null || v.forecast != null || v.actual != null);
  if (!vals.length && !attrs.keepEmpty) return;
  s.items.push({ name: clean(name), values: vals, attrs });
};

const owners = rows(cost, "Owners & Guidelines").slice(1, 9).filter((r) => r[1]).map((r) => ({ fn: clean(r[1]), owners: clean(r[2]), cutoff: clean(r[3]), remarks: clean(r[4]) }));
const guidelines = rows(cost, "Owners & Guidelines").slice(12, 21).map((r) => clean(r[1])).filter(Boolean);
const own = (n) => owners.find((o) => o.fn.toLowerCase().startsWith(n.toLowerCase()));

// Warehousing: month blocks of 6 cols (site × Budget/Provision/Actual), Apr..Oct
{
  const o = own("Warehousing");
  const f = fn("Warehousing & Fulfilment", o.owners, o.cutoff);
  const r = rows(cost, "Warehousing");
  for (const [si, site] of ["YLK 1 & 2 (South)", "North Warehouse"].entries()) {
    const s = sec(f, site);
    for (let i = 4; i <= 16; i++) {
      const name = r[i]?.[1]; if (!name) continue;
      const values = [];
      for (let m = 0; m < 7; m++) { const c = 2 + m * 6 + si * 3; values.push({ period: period(MONTHS[m]), plan: num(r[i][c]), forecast: num(r[i][c + 1]), actual: num(r[i][c + 2]) }); }
      put(s, name, values.filter((v) => (v.plan ?? 0) !== 0 || (v.actual ?? 0) !== 0 || (v.forecast ?? 0) !== 0));
    }
  }
}
// Staffing: warehouse manpower & OT (Aug..Mar blocks) + HQ actuals from Master Cost Sheet
{
  const o = own("Staffing");
  const f = fn("Staffing", o.owners, o.cutoff);
  const r = rows(cost, "Manpower+OT__ WAREHOUSE");
  const months = r[0].filter((v) => typeof v === "number").map(serialMonth);
  for (const [si, site] of ["YLK 1 & 2 (South)", "North Warehouse"].entries()) {
    const s = sec(f, `Warehouse manpower · ${site}`);
    for (const i of [5, 4]) {
      const values = months.map((p, m) => { const c = 2 + m * 6 + si * 3; return { period: p, plan: num(r[i][c]), forecast: num(r[i][c + 1]) || null, actual: num(r[i][c + 2]) || null }; });
      put(s, clean(r[i][1]), values);
    }
  }
  const m = rows(cost, "Master Cost Sheet");
  const s = sec(f, "HQ & Operations");
  const hq = m.find((x) => clean(x[2]) === "HQ");
  put(s, "HQ staffing cost", ["Apr", "May", "Jun"].map((mo, k) => ({ period: period(mo), plan: null, forecast: null, actual: num(hq[3 + k]) })));
}
// Logistics: B2C / B2B vendor rows, May..Oct, 3 cols per month
{
  const o = own("Logistics");
  const f = fn("Logistics", o.owners, o.cutoff);
  const r = rows(cost, "Logistics");
  let s = null;
  for (let i = 4; i < r.length; i++) {
    const a = clean(r[i][0]), b = clean(r[i][1]);
    if (a === "B2C" || a === "B2B") { s = sec(f, a); continue; }
    if (!s || !b || b === "-" || /add additional/i.test(b)) { if (a && !/b2/i.test(a) && s) s = null; continue; }
    const values = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((mo, k) => ({ period: period(mo), plan: num(r[i][2 + k * 3]), forecast: num(r[i][3 + k * 3]), actual: num(r[i][4 + k * 3]) }));
    put(s, b, values);
  }
}
// SaaS
{
  const o = own("SaaS");
  const f = fn("SaaS", o.owners, o.cutoff);
  const r = rows(cost, "Software_SaaS");
  const s = sec(f, "Subscriptions");
  for (let i = 3; i < r.length; i++) {
    const name = clean(r[i][0]); if (!name || /add other/i.test(name)) continue;
    const usd = r[i].some((v) => typeof v === "string" && v.endsWith("$"));
    const values = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((mo, k) => ({ period: period(mo), plan: num(r[i][1 + k * 3]), forecast: num(r[i][2 + k * 3]), actual: num(r[i][3 + k * 3]) }));
    put(s, name, values, usd ? { note: "Billed in USD; converted at ₹88/$" } : {});
  }
}
// Packaging (channel-level guesstimates)
{
  const o = own("Packaging");
  const f = fn("Packaging", o.owners, o.cutoff);
  const r = rows(cost, "Packaging");
  const s = sec(f, "Channel level");
  for (let i = 4; i <= 7; i++) {
    const name = clean(r[i][0]);
    const values = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"].map((mo, k) => ({ period: period(mo), plan: num(r[i][1 + k * 3]), forecast: num(r[i][2 + k * 3]) || null, actual: num(r[i][3 + k * 3]) || null }));
    put(s, name, values);
  }
}
// One-time / fixed assets (RFID rows → RFID function)
{
  const o = own("Fixed");
  const rf = own("RFID");
  const f = fn("Fixed Assets & One-time", o.owners, o.cutoff);
  const rfid = fn("RFID", rf.owners, rf.cutoff);
  const r = rows(cost, "One time  Fixed Asset expense");
  const months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
  const secs = new Map();
  for (let i = 4; i < r.length; i++) {
    const bucket = clean(r[i][1]), item = clean(r[i][2]), subject = clean(r[i][3]);
    if (!bucket) continue;
    const isRfid = /rfid/i.test(bucket);
    const target = isRfid ? rfid : f;
    const key = `${isRfid}|${bucket}`;
    if (!secs.has(key)) secs.set(key, sec(target, bucket));
    const values = months.map((mo, k) => ({ period: period(mo), plan: num(r[i][4 + k * 3]), forecast: num(r[i][5 + k * 3]), actual: num(r[i][6 + k * 3]) }));
    put(secs.get(key), item, values, { reference: subject || undefined, keepEmpty: true });
  }
  for (const fx of [f, rfid]) fx.sections = fx.sections.filter((s) => s.items.length);
}
const credit = rows(cost, "Cost_Savings").slice(1).filter((r) => r[2] && r[5] !== "SAMPLE" && num(r[4]))
  .map((r) => ({ fn: clean(r[0]) || "Logistics", month: clean(r[1]), partner: clean(r[2]), type: clean(r[3]), amount: num(r[4]), received: num(r[5]), remarks: clean(r[7]), owner: clean(r[9]) }));
const incidents = rows(cost, "Incident_Expenses").slice(1).filter((r) => r[0] && num(r[5]))
  .map((r) => ({ fn: clean(r[0]), month: clean(r[1]), channel: clean(r[2]), type: clean(r[3]), reason: clean(r[4]), amount: num(r[5]), remarks: clean(r[6]), owner: clean(r[7]) }));

writeFileSync("src/db/seed/aop-cost-fy27.json", JSON.stringify({ name: "Central Ops Cost · FY 26-27", fy_start: "2026-04-01", owners, guidelines, functions, credit_notes: credit, incidents }, null, 1));
console.log("AOP:", functions.map((f) => `${f.name}: ${f.sections.reduce((a, s) => a + s.items.length, 0)} items`).join(" | "), `| credit notes ${credit.length} | incidents ${incidents.length}`);

/* ---------------- S&OP FY'27 ---------------- */
const sop = XLSX.readFile(sopPath);
const idx = rows(sop, "S&OP Index");
const statusMonths = idx[13].slice(14, 17).map(serialMonth);
const pocs = idx.slice(14, 22).filter((r) => r[12]).map((r) => ({ stream: clean(r[12]), poc: clean(r[13]), status: Object.fromEntries(statusMonths.map((m, k) => [m, clean(r[14 + k])])) }));
const methodology = rows(sop, "AssumptionsMethodology").slice(1, 8).map((r) => ({ sheet: clean(r[1]), owners: clean(r[3]), text: clean(r[4]) }));
const monthlyTable = (name, start, end, stream) => {
  const r = rows(sop, name); const hdr = r[start - 1]; const out = [];
  for (let i = start; i <= end; i++) {
    const label = clean(r[i]?.[1]); if (!label || /grand total|channel name$/i.test(label)) continue;
    const values = [];
    hdr.forEach((h, c) => { if (typeof h === "number" && h > 40000) { const v = num(r[i][c]); if (v != null) values.push({ period: serialMonth(h), projection: v }); } });
    out.push({ stream, line: label, values });
  }
  return out;
};
const lines = [
  ...monthlyTable("B2C Channel-ItemOrder Data Summ", 2, 15, "B2C Forward"),
  ...monthlyTable("B2C Channel-ItemOrder Data Summ", 21, 28, "B2C Returns"),
  ...monthlyTable("B2B MP Channel", 2, 11, "B2B Marketplace"),
];
// Retail weekly NSO table (cols 10..16)
const retail = rows(sop, "B2B Retail Store").slice(2).filter((r) => typeof r[11] === "string" && /WK/.test(r[11]))
  .map((r) => ({ week: r[11], nso: num(r[12]), nso_inventory: num(r[14]), replenishment: num(r[15]), total: num(r[16]) }));
// Category projections by WH, monthly grand totals
const cat = rows(sop, "Cat Level NorthSouth Projection");
const categories = [];
for (let i = 0; i < cat.length; i++) {
  const t = clean(cat[i]?.[1]); const m = t.match(/^(\w{3})-(\d{2}) Projection/); if (!m) continue;
  const names = cat[i + 1]; const gt = cat.slice(i + 3, i + 12).find((r) => /^Grand Total/i.test(clean(r?.[0])));
  if (!gt) continue;
  const p = period(m[1]);
  for (let c = 3; c < names.length; c += 2) { const n = clean(names[c]); if (!n) continue; const N = num(gt[c]) ?? 0, S = num(gt[c + 1]) ?? 0; if (N || S) categories.push({ period: p, category: n, north: N, south: S }); }
}
const liquidation = rows(sop, "Liquidation Projection").slice(2).filter((r) => r[1]).map((r) => ({ week: r[1], period: serialMonth(r[2]), proj_north: num(r[3]), proj_south: num(r[4]), act_north: num(r[7]), act_south: num(r[8]) }));
const capacity = rows(sop, "WH_Capacity_Monthly").slice(2).filter((r) => typeof r[1] === "number" && r[2])
  .map((r) => ({ period: serialMonth(r[1]), department: clean(r[2]), req_south: num(r[3]), req_north: num(r[4]), act_south: num(r[6]), act_north: num(r[7]) }))
  .filter((r) => r.req_south != null || r.req_north != null);
writeFileSync("src/db/seed/sop-fy27.json", JSON.stringify({ pocs, status_months: statusMonths, methodology, lines, retail, categories, liquidation, capacity }, null, 1));
console.log("S&OP:", lines.length, "lines |", retail.length, "retail weeks |", categories.length, "category-month rows |", liquidation.length, "liq weeks |", capacity.length, "capacity rows");
