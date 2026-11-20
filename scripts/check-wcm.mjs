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

console.log("wcm OK", { octBoth: oct.Both.source / 100, julKnown: jul.source / 100, julMissingLabourLines: 4, julPackaging: pt.source / 100 });
