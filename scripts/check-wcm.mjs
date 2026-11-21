// Self-check: Warehouse Cost Master allocation maths + the 20 Nov 2026 Cost Master controls.
// node --experimental-strip-types scripts/check-wcm.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rate, rollup, sliceLine, splitPaise, checkSlices, toPaise } from "../src/server/wcm/math.ts";

const L = (id, family, amount, extra = {}) => ({ id, period: "2026-10-01", basis: "actual", site: "South", family, head: family === "ot" ? "Monthly OT" : "Monthly Manpower Cost", channel: null, amount, cell: id, ...extra });
const R = (id, family, head, slices, extra = {}) => ({ id, family, head, site: "*", from: "2026-04-01", to: null, slices, status: "approved", ...extra });
const run = (lines, rules) => rollup(lines, lines.flatMap((l) => sliceLine(l, rules)));

// No labour duplication: ₹100 salary + ₹20 OT; ₹80 → forward, ₹20 → verified storage labour, OT unmapped ⇒ ₹120 booked, ₹20 open.
const labour = [L("sal", "manpower", 100), L("ot", "ot", 20)];
const rule = R("r1", "manpower", "Monthly Manpower Cost", [{ fn: "Forward processing", channel: "B2C Shopify", shared: false, share: 0.8 }, { fn: "Storage & space", channel: null, shared: true, share: 0.2 }]);
let t = run(labour, [rule]);
assert.deepEqual([t.source, t.assigned, t.shared, t.unallocated], [12000, 8000, 2000, 2000]);
// a ₹90 modelled staffing estimate is not a source line → nothing changes; drafts never post
t = run(labour, [rule, R("d", "ot", "Monthly OT", [{ fn: "Returns", channel: "B2C Shopify", shared: false, share: 1 }], { status: "draft" })]);
assert.equal(t.source, 12000); assert.equal(t.unallocated, 2000);
// reassigning across functions keeps source and total constant
t = run(labour, [R("r2", "manpower", "Monthly Manpower Cost", [{ fn: "Returns", channel: "B2B Retail", shared: false, share: 0.5 }, { fn: "Inward", channel: null, shared: true, share: 0.5 }])]);
assert.equal(t.source, 12000); assert.equal(t.assigned + t.shared + t.unallocated, 12000);

// paise: ₹100.01 three ways, a signed credit, and a partial rule leave an exact residual
assert.deepEqual(splitPaise(10001, [1 / 3, 1 / 3, 1 / 3]), { parts: [3334, 3334, 3333], residual: 0 });
assert.deepEqual(splitPaise(-5000, [0.5, 0.5]), { parts: [-2500, -2500], residual: 0 });
assert.deepEqual(splitPaise(10000, [0.3]), { parts: [3000], residual: 7000 });
// function confirmed, channel open ⇒ stays Unallocated (with its function); explicit zero and missing are different states
const partial = sliceLine(L("p", "manpower", 50), [R("r3", "manpower", "Monthly Manpower Cost", [{ fn: "Returns", channel: null, shared: false, share: 1 }])]);
assert.equal(partial[0].kind, "unallocated"); assert.equal(partial[0].fn, "Returns");
t = run([L("z", "manpower", 0), L("m", "ot", null)], []);
assert.deepEqual([t.source, t.missing, t.lines], [0, 1, 2]);
assert.equal(checkSlices([{ fn: "Inward", channel: null, shared: true, share: 0.7 }, { fn: "Returns", channel: null, shared: true, share: 0.4 }]), "Shares add up to 110.00% — at most 100%");

// unit discipline: two sites ₹1,000/100 and ₹300/100 ⇒ Both ₹6.50 per common unit; mixed or missing units ⇒ unavailable
assert.equal(rate([{ paise: 100000, qty: 100, unit: "item" }, { paise: 30000, qty: 100, unit: "item" }]).value, 6.5);
assert.equal(rate([{ paise: 100000, qty: 100, unit: "item" }, { paise: 30000, qty: 10, unit: "box" }]).value, null);
assert.equal(rate([{ paise: 100000, qty: null, unit: "item" }]).reason, "output missing for part of the cost");

// 20 Nov 2026 workbook controls: every leaf ties to its sheet subtotal (±1 paisa rounding) and Oct / Jul reproduce
const d = JSON.parse(readFileSync(new URL("../src/db/seed/wcm-costmaster-2026-11-20.json", import.meta.url)));
assert.ok(d.mismatches.every((m) => Math.abs(m.diff) <= 0.01), "a leaf set no longer ties to its sheet subtotal");
const lines = d.lines.map((l, i) => ({ ...l, id: String(i) }));
const book = (p, site) => lines.filter((l) => l.period === p && l.basis === "actual" && l.family !== "packaging" && (site === "Both" || l.site === site));
const oct = { South: run(book("2026-10-01", "South"), []), North: run(book("2026-10-01", "North"), []), Both: run(book("2026-10-01", "Both"), []) };
const wb = (site, what) => toPaise(d.workbook.find((w) => w.period === "2026-10-01" && w.site === site && w.what === what).amount);
for (const site of ["South", "North", "Both"]) {
  assert.equal(oct[site].source, wb(site, "total"), `Oct ${site} recorded total`);
  // workbook overlap: storage + handling already cover the total, yet it shows extra "awaiting allocation" on top
  assert.equal(wb(site, "storage") + wb(site, "handling") + wb(site, "unallocated") - wb(site, "total"), wb(site, "unallocated"));
}
assert.equal(oct.Both.source, toPaise(14112611));
const jul = run(book("2026-07-01", "Both"), []);
assert.equal(jul.source, toPaise(4591195)); // known Warehousing actuals
assert.equal(book("2026-07-01", "Both").filter((l) => l.family !== "warehousing" && l.amount == null).length, 4); // MP + OT × 2 sites missing
const pk = lines.filter((l) => l.period === "2026-07-01" && l.basis === "actual" && l.family === "packaging");
const pt = run(pk, []);
assert.equal(pt.source, toPaise(3031245.38)); assert.equal(pt.assigned, pt.source); // channel named on the line ⇒ direct

// Daily deployment: 10 DE → 6 forward, 2 returns, 1 confirmed idle, 1 unassigned; an 11th DE or a duplicate target is rejected
const { checkPool, stageKpi, proposeSplit, stageKey, idleKey } = await import("../src/server/wcm/ops.ts");
const pool = [{ target: stageKey("B2C Shopify", "Picker"), de: 6 }, { target: stageKey("B2C Returns Shopify", "Receiving"), de: 2 }, { target: idleKey("No demand"), de: 1 }];
assert.deepEqual(checkPool(10, pool), { assigned: 8, idle: 1, unassigned: 1, error: null });
assert.match(checkPool(10, [...pool, { target: stageKey("B2C Shopify", "Packer"), de: 2 }]).error, /only 10 DE/);
assert.match(checkPool(10, [pool[0], pool[0]]).error, /twice/);
// target 700 × 6 DE = 4,200 capacity; 3,500 output ⇒ 83.33 %, 700 unused (not all of it idle); unknown output ⇒ unavailable, not 0
const k = stageKpi(6, 700, 3500);
assert.equal(k.capacity, 4200); assert.equal(k.unused, 700); assert.equal(Math.round(k.utilisation * 10000) / 100, 83.33);
const u = stageKpi(6, 700, null);
assert.equal(u.utilisation, null); assert.equal(u.why, "no output feed for this stage");
// proposal never exceeds what is present
const p = proposeSplit(5, [{ target: "stage:a|x", required: 4 }, { target: "stage:a|y", required: 4 }]);
assert.ok(p.reduce((a, l) => a + l.de, 0) <= 5);

// Auto split from attendance roles (pool B2C Forward · Day, 30 DE present)
const { autoSplit } = await import("../src/server/wcm/ops.ts");
const st = [
  { target: stageKey("B2C Shopify", "Picker"), stage: "Picker", required: 9 }, { target: stageKey("B2C Marketplace", "Picker"), stage: "Picker", required: 3 },
  { target: stageKey("B2C Shopify", "Packer"), stage: "Packer", required: 6 }, { target: stageKey("B2C Shopify", "Manifest"), stage: "Manifest", required: 2 },
];
const de = (r, t) => r.lines.find((l) => l.target === t)?.de ?? 0;
// 8 pickers split 3:1 by required DE across channels; 4 manifest → the single Manifest stage; 2 DEO never assigned;
// 10 Unclassified fill the gap: pickers need 12 − 8 = 4, packer 6, manifest 0 ⇒ 4 + 6 = 10 placed
let a = autoSplit(30, [{ role: "Picker", de: 8 }, { role: "Manifest", de: 4 }, { role: "DEO", de: 2 }, { role: "Unclassified", de: 10 }], st);
assert.equal(de(a, st[0].target), 9); assert.equal(de(a, st[1].target), 3); assert.equal(de(a, st[2].target), 6); assert.equal(de(a, st[3].target), 4);
assert.equal(a.byRole, 12); assert.equal(a.byWorkload, 10);
assert.equal(checkPool(30, a.lines).unassigned, 8); // 2 DEO + 6 present with no role row stay visible as unassigned
// several channels with no measured output ⇒ channel unknown ⇒ unassigned (never guessed)
a = autoSplit(10, [{ role: "Return Processing", de: 10 }], [{ target: "stage:B2C Returns Shopify|Processing & QC", stage: "Processing & QC", required: null }, { target: "stage:B2C Returns Marketplace|Processing", stage: "Processing", required: null }]);
assert.equal(a.lines.length, 0);
// attendance moved between reads: never more than present
a = autoSplit(5, [{ role: "Picker", de: 8 }], st);
assert.ok(a.lines.reduce((x, l) => x + l.de, 0) <= 5);

// 3PL pricing: native units, region columns, unit-month storage, unpriced stages flagged (never ₹0)
const { priceMonth } = await import("../src/server/wcm/tpl.ts");
const vol = { inward: 1000, b2c_out: 2000, b2b_out: 500, storage_unit_days: 30000 };
let e = priceMonth("Emiza", "North", vol, 30);
assert.equal(e.lines.find((l) => l.stage === "inward").amount, 4000);           // Gurgaon ₹4.0
assert.equal(e.lines.find((l) => l.stage === "b2c_out").amount, 18000);         // Gurgaon ₹9
assert.equal(e.lines.find((l) => l.stage === "storage_unit_days").amount, 3000); // ₹0.10 per unit-day
assert.equal(e.lines.find((l) => l.stage === "b2b_out").amount, null); assert.equal(e.complete, false); assert.equal(e.priced, 25000);
const s = priceMonth("Shiprocket", "South", vol, 30);
assert.equal(s.lines.find((l) => l.stage === "storage_unit_days").amount, 3300); // 1,000 avg units × ₹3.30 / month
assert.equal(priceMonth("Emiza", "South", { inward: null }, 30).lines[0].flag, "volume missing");
assert.deepEqual([priceMonth("Shiprocket", "South", { b2c_orders: 10 }, 30).lines[0].amount, priceMonth("Shiprocket", "South", { b2c_orders: 10 }, 30).complete], [0, true]); // no stationery line ≠ missing rate

// Cost per day: direct lines to their side, shared by dispatched items, missing listed (never ₹0), totals tie
const { splitDay } = await import("../src/server/wcm/dayMath.ts");
const DL = (key, amount, side) => ({ key, label: key, amount, basis: amount == null ? "missing" : "measured", note: "", side });
const sd = splitDay([DL("mpB2C", 600, "B2C"), DL("mpB2B", 200, "B2B"), DL("wh", 1000, "shared"), DL("ot", null, "shared")], { b2c: 3000, b2b: 1000 }, { b2c: 100, b2b: 10 });
assert.deepEqual([sd.total, sd.shared, sd.b2c, sd.b2b], [1800, 1000, 1350, 450]);
assert.equal(sd.b2c + sd.b2b, sd.total); assert.deepEqual(sd.missing, ["ot"]);
assert.equal(sd.cpsB2c, 13.5); assert.equal(sd.cpuB2b, 0.45);
assert.equal(splitDay([DL("wh", 100, "shared")], { b2c: 0, b2b: 0 }, { b2c: 0 }).b2c, null); // no dispatch ⇒ no split, no CPS

console.log("wcm OK", { octBoth: oct.Both.source / 100, julKnown: jul.source / 100, julMissingLabourLines: 4, julPackaging: pt.source / 100 });
