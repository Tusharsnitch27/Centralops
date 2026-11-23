// One-off: Apr–Oct 2026 present heads per day × site × function → src/db/seed/mp-daily-backfill.json (aggregates only; no names /
// codes leave this script). Not run by the app; seeded by src/server/seed/mpDailyBackfill.ts.
//   node --max-old-space-size=700 scripts/attendance-backfill.mjs <att.sql> [out.json]
//
// Sources (Malhar, 23 Nov):
//   2026-04-25 … 2026-10-28  attendance app DB (pg_dump of 29 Oct, plain SQL; the system the live attendance API reads), all sites.
//     COPY public.attendance_header (id, attendance_date, facility NORTH/WH1/WH2, department = mp_func_map.func, …, marked_at, …, shift)
//     COPY public.attendance_detail (id, attendance_header_id, …, employee_code, …, attendance_status, …)
//     Present: 'Present', 'Work On Holiday', 'Work on Week Off' = 1; 'Half Day' = 0.5; everything else 0 (Week Off, Holiday, leaves,
//     LOP, Absent, Absconding, Compensatory Off …). Each employee_code counts once per day × facility: across Day / Night headers the
//     row with the higher present value wins, ties → first header by marked_at; an employee under two departments the same day goes
//     to that header's department (cases counted and printed).
//   2026-04-01 … 2026-04-24  site attendance workbooks (Downloads, 23 Nov copies):
//     South "YLK ATTENDANCE MASTER DATA (1).xlsx", sheets "Attendance 3-4 (Mar-April)" and "Attendance 4-5 (April-May)" (cycle 26th → 25th);
//       header row 0, columns by name (Facility, Employee id / Employee Number); "3-4" has no Department header, so the department column
//       is the one holding the most department names. Site from Facility ("WH2 (ON ROLE)" → WH2); rows without Facility are skipped.
//     North "Copy of Snitch Attendance Tracker Tauru GGN.xlsx", sheet "Attendance_2026": header row 4 (Emp Id col C, Department col F),
//       day columns = Excel serials; "-" = not on the rolls.
//     Present: P, WOW, WHD, WHN (worked holiday day / night) = 1 (South); D, N = 1 (North); H/D (South) and a 0.5 cell (North) = 0.5;
//     everything else 0 — H is a holiday in both workbooks (whole site on 1 May / 15 Aug / 2 Oct / 20 Oct), not a half day.
//     Department → func: B2C / B2C Forward / B2C_FORWARD → B2C Forward; B2B_Retail / B2B Forward / B2B_FORWARD → B2B Forward;
//     B2C_Return / B2C Return / B2C_RETURN → B2C Return; Retail_return / B2B Return / B2B_RETURN → B2B Return; Inward; Inventory;
//     LOGISTICS → Logistics; ADMIN → Admin; Ops, Helper, Local_Logistic, HOUSEKEEPING, SECURITY, EXECUTIVE, ASSISTANT MANGER, MANAGER,
//     ERP, IRONER → Ops (Malhar, 23 Nov; Manifest / Loading-Unloading keep the sheet's department).
import XLSX from "xlsx";
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";

const [dump, outPath = "src/db/seed/mp-daily-backfill.json"] = process.argv.slice(2);
if (!dump) throw new Error("usage: attendance-backfill.mjs <att.sql> [out.json]");
const DL = `${homedir()}/Downloads`;
const FROM = "2026-04-01", SPLIT = "2026-04-25", TO = "2026-10-28";
const heads = new Map(); // day|site|func → heads
const put = (d, site, func, v) => { if (v) heads.set(`${d}|${site}|${func}`, (heads.get(`${d}|${site}|${func}`) ?? 0) + v); };

// ── attendance app dump ──
const copyBlock = async (table, onRow) => {
  let on = false;
  for await (const l of createInterface({ input: createReadStream(dump, "utf8"), crlfDelay: Infinity })) {
    if (l.startsWith(`COPY public.${table} `)) { on = true; continue; }
    if (!on) continue;
    if (l === "\\.") break;
    onRow(l.split("\t"));
  }
};
const H = new Map(); // header id → [day, site, func, marked_at]
await copyBlock("attendance_header", (c) => { if (c[1] >= SPLIT && c[1] <= TO) H.set(c[0], [c[1], c[2], c[3], c[5]]); });
const STATUS = { Present: 1, "Work On Holiday": 1, "Work on Week Off": 1, "Half Day": 0.5 };
const pick = new Map(); // day|site|code → { v, at, func, funcs }
await copyBlock("attendance_detail", (c) => {
  const h = H.get(c[1]);
  if (!h) return;
  const [d, site, func, at] = h, k = `${d}|${site}|${c[3]}`, v = STATUS[c[5]] ?? 0, cur = pick.get(k);
  if (!cur) return void pick.set(k, { v, at, func, funcs: new Set([func]) });
  cur.funcs.add(func);
  if (v > cur.v || (v === cur.v && at < cur.at)) Object.assign(cur, { v, at, func });
});
let twoDepts = 0;
for (const [k, p] of pick) { const [d, site] = k.split("|"); put(d, site, p.func, p.v); if (p.funcs.size > 1) twoDepts++; }
pick.clear();

// ── workbooks, 1–24 Apr ──
const DEPT = {
  "B2C Forward": "B2C Forward", B2C: "B2C Forward", "B2B Forward": "B2B Forward", B2B_Retail: "B2B Forward",
  "B2C Return": "B2C Return", B2C_Return: "B2C Return", "B2B Return": "B2B Return", Retail_return: "B2B Return",
  Inward: "Inward", Inventory: "Inventory", Ops: "Ops", Helper: "Ops", Local_Logistic: "Ops",
  B2C_FORWARD: "B2C Forward", B2B_FORWARD: "B2B Forward", B2C_RETURN: "B2C Return", B2B_RETURN: "B2B Return",
  INWARD: "Inward", INVENTORY: "Inventory", LOGISTICS: "Logistics", ADMIN: "Admin",
  HOUSEKEEPING: "Ops", SECURITY: "Ops", EXECUTIVE: "Ops", "ASSISTANT MANGER": "Ops", MANAGER: "Ops", ERP: "Ops", IRONER: "Ops",
};
const present = (v) => {
  if (v === 0.5) return 0.5;
  const c = String(v ?? "").trim().toUpperCase();
  return ["P", "WOW", "WHD", "WHN", "D", "N"].includes(c) ? 1 : c === "H/D" || c === "0.5" ? 0.5 : 0;
};
const serial = (n) => new Date(Date.UTC(1899, 11, 30) + n * 864e5).toISOString().slice(0, 10);
const dayCols = (h) => h.map((c, i) => [i, c]).filter(([, c]) => typeof c === "number" && c > 40000).map(([i, c]) => [i, serial(c)]).filter(([, d]) => d >= FROM && d < SPLIT);
const sheet = (f, sh) => XLSX.utils.sheet_to_json(XLSX.readFile(f, { sheets: [sh], dense: true }).Sheets[sh], { header: 1, defval: null, raw: true, blankrows: true });
const seen = new Set(), unmapped = new Map();
const wb = (d, site, func, emp, v) => { const k = `${emp}|${d}`; if (!seen.has(k)) { seen.add(k); put(d, site, func, present(v)); } };
const south = `${DL}/YLK ATTENDANCE MASTER DATA (1).xlsx`;
for (const sh of XLSX.readFile(south, { bookSheets: true }).SheetNames.filter((s) => /^Attendance (3-4|4-5) \(/.test(s))) {
  const rows = sheet(south, sh), h = rows[0];
  const fac = h.indexOf("Facility"), emp = h.findIndex((c) => /^employee (id|number)$/i.test(String(c ?? "").trim()));
  let dep = h.indexOf("Department");
  if (dep < 0) { const score = h.map((_, i) => rows.filter((r) => DEPT[String(r?.[i] ?? "").trim()]).length); dep = score.indexOf(Math.max(...score)); }
  const days = dayCols(h);
  for (const r of rows.slice(1)) {
    const site = String(r?.[fac] ?? "").match(/WH[12]/)?.[0];
    if (!site) continue;
    const d0 = String(r[dep] ?? "").trim(), func = DEPT[d0];
    if (!func) { unmapped.set(`South: ${d0}`, (unmapped.get(`South: ${d0}`) ?? 0) + 1); continue; }
    for (const [i, d] of days) wb(d, site, func, r[emp], r[i]);
  }
}
{
  const rows = sheet(`${DL}/Copy of Snitch Attendance Tracker Tauru GGN.xlsx`, "Attendance_2026"), days = dayCols(rows[4]);
  for (const r of rows.slice(5)) {
    if (!r?.[2]) continue;
    const d0 = String(r[5] ?? "").trim(), func = DEPT[d0.toUpperCase()];
    if (!func) { unmapped.set(`North: ${d0}`, (unmapped.get(`North: ${d0}`) ?? 0) + 1); continue; }
    for (const [i, d] of days) wb(d, "NORTH", func, `N${r[2]}`, r[i]);
  }
}

const out = [...heads].map(([k, v]) => { const [day, site, func] = k.split("|"); return { day, site, func, heads: v }; })
  .sort((a, b) => a.day.localeCompare(b.day) || a.site.localeCompare(b.site) || a.func.localeCompare(b.func));
writeFileSync(outPath, `[\n${out.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);

console.log(`${out.length} rows ${out[0]?.day} … ${out.at(-1)?.day} · ${twoDepts} employee-days under two departments (dump)`);
if (unmapped.size) console.log("UNMAPPED:", JSON.stringify(Object.fromEntries(unmapped)));
const m = new Map();
for (const r of out) { const k = `${r.day.slice(0, 7)}|${r.site}|${r.func}`; const a = m.get(k) ?? { s: 0, n: 0 }; a.s += r.heads; a.n++; m.set(k, a); }
console.log("month   site  func         avg heads  days");
for (const [k, a] of [...m].sort()) { const [mo, s, fn] = k.split("|"); console.log(`${mo} ${s.padEnd(5)} ${fn.padEnd(12)} ${(a.s / a.n).toFixed(1).padStart(8)} ${String(a.n).padStart(5)}`); }
const oct = new Map();
for (const r of out.filter((r) => r.day >= "2026-10-01")) oct.set(`${r.site}|${r.func}`, (oct.get(`${r.site}|${r.func}`) ?? 0) + r.heads / 28);
console.log("OCT", JSON.stringify(Object.fromEntries([...oct].sort().map(([k, v]) => [k, +v.toFixed(1)]))));
