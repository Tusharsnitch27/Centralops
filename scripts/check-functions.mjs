// Self-check: shared maths for the AOP Functions view.
// node --experimental-strip-types scripts/check-functions.mjs
import assert from "node:assert/strict";
import { unitsPerHead, idealHeads, manpowerGap, perUnit, zoneClass, dearerWh, longTailPremium } from "../src/server/functions/math.ts";
import { workbookActual, workbookMonthVolumes } from "../src/server/functions/workbookHistory.ts";

const close = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) < d, `${a} ≠ ${b}`);
close(unitsPerHead([{ ipp: 1000, unit: "unit" }, { ipp: 1600, unit: "unit" }, { ipp: 100, unit: "box" }]), 510.64);
close(unitsPerHead([{ ipp: 80, unit: "unit", pass: 0.15 }]), 533.33);
assert.equal(unitsPerHead([{ ipp: null, unit: "unit" }]), null);
assert.deepEqual(idealHeads(10000, 512.82), { floor: 20, roll: 22 });
assert.equal(idealHeads(null, 500), null);

// ₹ per head-day = 23000 ÷ 23 = 1000. I 500, Pavg 9000 ÷ 500 × 23 = 414, N 200000 ÷ 500 = 400, H 5000 ÷ 500 = 10, A 600
const input = { salary: 23000, uph: 500, projAvg: 9000, days: 23, processed: 200000, heldUpUnits: 5000, actualHeadDays: 600, idealHeadDays: 500 };
const by = (g, c) => g.find((p) => p.cause === c);
const total = (g) => g.reduce((a, p) => a + (p.rupees ?? 0), 0);
const g = manpowerGap(input);
close(by(g, "plan_peak").rupees, -86000);
close(by(g, "volume").rupees, -14000);
close(by(g, "held_up").rupees, 10000);
close(by(g, "below_ipp").rupees, 190000);
assert.equal(by(g, "absenteeism").rupees, null);
close(by(g, "other").rupees, 0);
close(total(g), 100000); // = (A − I) × 1000 exactly
assert.equal(by(g, "erratic"), undefined);
const g2 = manpowerGap({ ...input, heldUpUnits: null });
assert.equal(by(g2, "held_up").rupees, null);
close(by(g2, "below_ipp").rupees, 200000);
close(by(g2, "other").rupees, 0);
close(total(g2), 100000);

// ad-hoc work: 30 head-days come out of output per head; the causes still add up to A − I
const g3 = manpowerGap({ ...input, adhocHeadDays: 30 });
close(by(g3, "adhoc").rupees, 30000);
close(by(g3, "below_ipp").rupees, 160000);
close(total(g3), 100000);
assert.equal(by(g, "adhoc").rupees, null);
assert.equal(perUnit(100000, 15, 18000), null);
assert.equal(perUnit(100000, 20000, 18000), 5);
assert.equal(zoneClass("North", "NORTH"), "home");
assert.equal(zoneClass("North", "SOUTH"), "cross");
assert.equal(zoneClass("South", "WEST"), "eastwest");
assert.equal(zoneClass("North", "EXCLUDED"), "unmapped");
// West in a month: North ₹14/unit for 1,000 units, South ₹10/unit for 500 → South is the ideal; extra = 1,000 × ₹4
assert.deepEqual(dearerWh({ North: 14, South: 10 }, { North: 1000, South: 500 }), { cheaper: "South", units: 1000, rupees: 4000 });
assert.equal(dearerWh({ North: null, South: 10 }, { North: 1000, South: 500 }), null);
// A: apparel ₹80/ship, 10 shoes at ₹200 → +₹1,200; B: no apparel → its 5 shoes unpriced; winterwear is not long tail
assert.deepEqual(longTailPremium([{ courier: "A", grp: "Apparel only", ships: 100, cost: 8000 }, { courier: "A", grp: "Shoes", ships: 10, cost: 2000 },
  { courier: "A", grp: "Winterwear", ships: 10, cost: 1200 }, { courier: "B", grp: "Shoes", ships: 5, cost: 900 }], ["Shoes"]), { rupees: 1200, ships: 10, unpriced: 5 });
assert.equal(zoneClass("South", null), "unmapped");
console.log("functions math OK");

// Task 4: aggregation of day rows to month points, and the rulebook slot's processing weekday
import { toMonthPoints, toDayPoints, processingWeekday, onRoll } from "../src/server/functions/aggregate.ts";
const day = (d, projected, processed, presentHeads, site = "South") => ({ day: d, site, projected, received: null, processed, issues: null, presentHeads, overlay: null });
assert.deepEqual(workbookMonthVolumes("b2b_retail", "2026-04", ["South", "North"], []),
  { projected: 537196, processed: 602654, usedProjection: true, usedProcessed: true });
assert.deepEqual(workbookMonthVolumes("b2c_shopify", "2026-09", ["South", "North"], [day("2026-09-22", 1200, 2800, null)]),
  { projected: 1200 + 92795, processed: 175338, usedProjection: true, usedProcessed: true });
// returns have no workbook rows: putaway from April and the S&OP plan rows cover them
assert.deepEqual(workbookMonthVolumes("b2c_returns", "2026-09", ["South", "North"], []),
  { projected: null, processed: null, usedProjection: false, usedProcessed: false });
assert.deepEqual(workbookMonthVolumes("inwards", "2026-10", ["South"], [day("2026-10-15", 1200, 800, null)]),
  { projected: 1200, processed: 800, usedProjection: false, usedProcessed: false });
// Processing's volume where the review rows have no actual (Inward Apr–Aug): the workbook's full-month actual, per site; none → null
assert.equal(workbookActual("inwards", "2026-04-01", "North"), 426518);
assert.equal(workbookActual("inwards", "2026-08", "South"), 530229);
assert.equal(workbookActual("b2c_returns", "2026-04", "South"), null);
assert.equal(workbookActual("inwards", "2026-11", "South"), null);
// Both: a site missing the day makes received / projected missing, never the other site's half
{
  const rows = [{ ...day("2026-11-01", 100, null, 2), received: null }, { ...day("2026-11-01", 50, 0, 2, "North"), received: 0 }];
  const [b] = toDayPoints(rows, { "2026-11": 100 }, 23000);
  assert.equal(b.received, null); assert.equal(b.processed, null); assert.equal(b.projected, 150);
  const [b2] = toDayPoints([{ ...rows[0], received: 7 }, rows[1]], { "2026-11": 100 }, 23000);
  assert.equal(b2.received, 7);
}
const [mp] = toMonthPoints([day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2)], { "2026-11": 100 }, 23000);
assert.equal(mp.projected, 400);
// month view: planned day = avg 200 + 0.5 × (peak 300 − 200) = 250; on roll with weekly-off cover ⌈250 ÷ 100 × 30 ÷ 23 × 1.1⌉ = 4
assert.equal(mp.idealHeads, 4);
assert.equal(onRoll(300, 100, 30), 5);
assert.equal(onRoll(null, 100, 30), null);
assert.equal(mp.actualCost, 4000);
assert.equal(mp.costPerUnit, 10);
// no projection for the month → projected and ideal are missing, never 0
const [np] = toMonthPoints([day("2026-11-01", null, 200, 2)], { "2026-11": 100 }, 23000);
assert.equal(np.projected, null);
assert.equal(np.idealHeads, null);
assert.equal(np.idealCost, null);
// day mode: each day carries its month's planned day (avg 200 + 0.5 × (300 − 200) = 250 → 3 heads), Both = sum of the sites
const dp = toDayPoints([day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2), day("2026-11-01", 50, 100, 1, "North")], { "South|2026-11": 100, "North|2026-11": 50 }, 23000, "2026-11-01", "2026-11-01");
assert.equal(dp.length, 1);
assert.equal(dp[0].idealHeads, 4);
assert.equal(dp[0].actualHeads, 3);
// Processing's month actuals replace the attendance figure (ties to AOP › Processing)
const [op] = toMonthPoints([day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2)], { "2026-11": 100 }, 23000, undefined, undefined, { "South|2026-11": { heads: 7, cost: 9000 } });
assert.equal(op.actualHeads, 7);
assert.equal(op.actualCost, 9000);
assert.equal(processingWeekday("Monday 5 AM"), "Sunday");
assert.equal(processingWeekday("Sunday 5 AM"), "Saturday");
assert.equal(processingWeekday("Thursday 6 PM"), "Thursday");
assert.equal(processingWeekday(null), null);
assert.equal(processingWeekday("garbage"), null);
console.log("functions aggregate OK");
// Both: a part missing on either site is missing for Both (North has no attendance or scans that day)
const [bp] = toDayPoints([day("2026-11-01", 100, 200, 2), day("2026-11-01", 50, null, null, "North")], { "2026-11": 100 }, 23000, "2026-11-01", "2026-11-01");
assert.equal(bp.actualCost, null);
assert.equal(bp.actualHeads, null);
assert.equal(bp.processed, null);
console.log("functions Both OK");

// Task 5 / Task 6 fix 1: an order re-timed to the nearest rulebook weekday forward (early) or back (breached), within 6 days
import { retimeToWeekday } from "../src/server/functions/aggregate.ts";
assert.equal(retimeToWeekday("2026-11-04", "Monday", "forward"), "2026-11-09"); // Wed → next Mon
assert.equal(retimeToWeekday("2026-11-04", "Monday", "back"), "2026-11-02");
assert.equal(retimeToWeekday("2026-11-04", "Wednesday", "forward"), "2026-11-04");
assert.equal(retimeToWeekday("2026-11-04", "Wednesday", "back"), "2026-11-04");
assert.equal(retimeToWeekday("2026-11-06", "Monday", "forward"), "2026-11-09"); // Fri early for Monday → the coming Monday, not the past one
assert.equal(retimeToWeekday("2026-11-08", "Monday", "forward"), "2026-11-09");
assert.equal(retimeToWeekday("2026-11-04", "Saturday", "back"), "2026-10-31");
assert.equal(retimeToWeekday("2026-11-04", "Someday", "forward"), "2026-11-04");
console.log("functions retime OK");

// Fix round 1: a month's ₹ shared to the window by processed units
import { unitShare } from "../src/server/functions/aggregate.ts";
assert.equal(unitShare(1000, 400, 100), 250);
assert.equal(unitShare(1000, 0, 100), null);
assert.equal(unitShare(1000, null, 100), null);
assert.equal(unitShare(null, 400, 100), null);
console.log("functions unit share OK");
// grey lines name site-months as short runs
import { spans } from "../src/server/functions/aggregate.ts";
const both = ["South", "North"];
assert.equal(spans(["South|2026-04", "North|2026-04", "South|2026-05", "North|2026-05", "South|2026-06", "North|2026-06", "North|2026-10"], both), "Apr–Jun 2026 (both sites), North Oct 2026");
assert.equal(spans(["South|2026-12", "South|2027-01"], ["South"]), "Dec 2026–Jan 2027");
assert.equal(spans(["South|2026-09-01"], both), "South Sep 2026");
console.log("functions spans OK");
// B2C Shopify courier gap: each courier against its own Jul–Sep cost per shipment
import { courierSplit } from "../src/server/functions/aggregate.ts";
const lg = [{ courier: "A", month: "2026-07-01", cost: 100, fwd: 10 }, { courier: "A", month: "2026-08-01", cost: 300, fwd: 10 }, { courier: "A", month: "2026-10-01", cost: 300, fwd: 10 },
  { courier: "B", month: "2026-10-01", cost: 50, fwd: 10 }];
const jas = ["2026-07", "2026-08", "2026-09"];
const cs = courierSplit([{ month: "2026-11-01", courier: "A", n: 100 }], lg, jas); // baseline 400 ÷ 20 = 20; Nov rate = Oct 30 → (30 − 20) × 100
assert.equal(cs.parts.find((p) => p.cause === "courier_rate").rupees, 1000);
assert.equal(cs.parts.find((p) => p.cause === "other").rupees, 0);
const cs2 = courierSplit([{ month: "2026-11-01", courier: "A", n: 100 }, { month: "2026-11-01", courier: "B", n: 7 }], lg, jas); // B has no Jul–Sep
assert.equal(cs2.parts.find((p) => p.cause === "other").rupees, null);
assert.deepEqual(cs2.unpriced, [{ courier: "B", n: 7 }]);
assert.equal(courierSplit([{ month: "2026-11-01", courier: "B", n: 7 }], lg, jas).parts, null);
console.log("functions courier OK");
// gap pairs like the summary: a day with no attendance is left out of both sides, so Σ causes = Σ paired (actual − ideal)
import { windowGap } from "../src/server/functions/aggregate.ts";
const gr = [day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, null), day("2026-11-03", 200, 150, 3)];
const gpts = toDayPoints(gr, { "2026-11": 100 }, 23000, "2026-11-01", "2026-11-03");
const pairedGap = gpts.filter((p) => p.actualCost != null && p.idealCost != null).reduce((a, p) => a + p.actualCost - p.idealCost, 0);
const wg = windowGap("day", gr, { "2026-11": 100 }, 23000, ["South"], "2026-11-01", "2026-11-03");
close(wg.gap.reduce((a, p) => a + (p.rupees ?? 0), 0), pairedGap);
assert.deepEqual(wg.dropped, ["2026-11-02"]);
close(wg.gap.find((p) => p.cause === "other").rupees, 0);
console.log("functions gap pairing OK");
// month ₹/unit divides by Processing's units (sheet final output, else S&OP actual), never scanned output; none → null
const mrows = [day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2)];
assert.equal(toMonthPoints(mrows, { "2026-11": 100 }, 23000, undefined, undefined, undefined, undefined, { "South|2026-11": 500 })[0].costPerUnit, 8); // ₹4000 ÷ 500
assert.equal(toMonthPoints(mrows, { "2026-11": 100 }, 23000, undefined, undefined, undefined, undefined, { "South|2026-11": null })[0].costPerUnit, null);
assert.equal(toMonthPoints(mrows, { "2026-11": 100 }, 23000, undefined, undefined, undefined, undefined, { "South|2026-11": null })[0].idealCostPerUnit, null);
console.log("functions month per-unit OK");

// Task 2 (backfill): order placement against the next rulebook cutoff (Malhar, 25 Nov 2026): ≤ 48 h before = within (the window); 48–72 h = early;
// after the cutoff or > 72 h before (placed after the previous one) = breached
import { placementSla } from "../src/server/functions/aggregate.ts";
const wed = { cutoff: "Wednesday 12 PM" };
assert.equal(placementSla("2026-06-03T10:00", wed), "WITHIN_SLA");                 // the cutoff day, before 12 PM
assert.equal(placementSla("2026-06-03 14:00:00", wed), "BREACHED");                 // after it
assert.equal(placementSla("2026-06-01T12:00", wed), "WITHIN_SLA");                 // Monday 12 PM: exactly 48 h before
assert.equal(placementSla("2026-06-01T11:00", wed), "EARLY_CREATION");             // 49 h before
assert.equal(placementSla("2026-05-31T12:00", wed), "EARLY_CREATION");             // Sunday 12 PM: exactly 72 h
assert.equal(placementSla("2026-05-31T10:00", wed), "BREACHED");                   // 74 h: after the previous cutoff
assert.equal(placementSla("2026-05-30T15:00", { cutoff: "Monday 9 AM" }), "WITHIN_SLA");     // Saturday 3 PM for Monday 9 AM: 42 h
assert.equal(placementSla("2026-05-29T15:00", { cutoff: "Monday 9 AM" }), "EARLY_CREATION"); // Friday 3 PM: 66 h
assert.equal(placementSla("2026-06-03T10:00", null), null);
assert.equal(placementSla("2026-06-03T10:00", { cutoff: "" }), null);
console.log("functions placement OK");

// Task 3 (backfill): returns are two functions over disjoint streams; B2B returns' processed is null on a day the putaway feed
// has no row (only B2C returns-app rows), 0 when putaway ran with no B2B returns
import { FN } from "../src/server/functions/types.ts";
import { stageTotal } from "../src/server/functions/aggregate.ts";
assert.ok("b2c_returns" in FN && "b2b_returns" in FN && !("returns" in FN));
assert.ok(!FN.b2c_returns.streams.some((s) => FN.b2b_returns.streams.includes(s)));
assert.ok(!FN.b2c_returns.processed.streams.some((s) => FN.b2b_returns.processed.streams.includes(s)));
const b2cOnly = [{ day: "2026-08-10", site: "North", stream: "B2C Returns Shopify", event: "received", qty: 900 },
  { day: "2026-08-10", site: "North", stream: "B2C Returns Marketplace", event: "qc", qty: 400 }];
const b2b = FN.b2b_returns.processed;
const rp = stageTotal(b2cOnly, "North", "2026-08-10", b2b.event, b2b.streams);
assert.equal(rp, null);
assert.equal(toMonthPoints([{ ...day("2026-08-10", 100, rp, 2, "North"), received: rp }], { "2026-08": 100 }, 23000)[0].processed, null);
assert.equal(stageTotal([...b2cOnly, { day: "2026-08-10", site: "North", stream: "B2C Returns (channel open)", event: "putaway", qty: 700 }], "North", "2026-08-10", b2b.event, b2b.streams), 0);
assert.equal(stageTotal([{ day: "2026-08-10", site: "North", stream: "B2B Returns Retail", event: "putaway", qty: 50 }], "North", "2026-08-10", b2b.event, b2b.streams), 50);
console.log("functions returns split OK");
// B2B Marketplace dispatched comes from UC items only: SLA rows for other streams that day don't make it 0 — null until UC wrote the site-day
const mpSla = [{ day: "2026-11-22", site: "South", stream: "B2C Shopify", event: "dispatched", qty: 900, source: "warehouse_sla_performance" }];
const mpUc = { day: "2026-11-22", site: "South", stream: "B2C Shopify", event: "ordered", qty: 800, source: "uc_items" };
assert.equal(stageTotal(mpSla, "South", "2026-11-22", "dispatched", FN.b2b_marketplace.processed.streams), null);
assert.equal(stageTotal([...mpSla, mpUc], "South", "2026-11-22", "dispatched", FN.b2b_marketplace.processed.streams), 0);
assert.equal(stageTotal([...mpSla, mpUc, { ...mpUc, stream: "B2B Marketplace", event: "dispatched", qty: 40 }], "South", "2026-11-22", "dispatched", FN.b2b_marketplace.processed.streams), 40);
assert.equal(stageTotal(mpSla, "South", "2026-11-22", "dispatched", FN.b2c_shopify.processed.streams), 900);
console.log("functions B2B MP UC-only OK");

// Task 4 (backfill): month ₹/unit = Σ₹ ÷ Σunits over the same days — Processing's cost at its share of the month over volume × that share;
// with no Processing actuals, the attendance days' cost over volume × attendance days ÷ the month's days in the window. Ideal stays over the whole volume.
const oct = Array.from({ length: 31 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, 100, 200, i >= 28 ? 30 : null, "North"));
const octVol = { "North|2026-10": 235504 };
const [s3] = toMonthPoints(oct, { "2026-10": 100 }, 23000, undefined, undefined, { "North|2026-10": { heads: 40, cost: 132000, share: 3 / 31 } }, undefined, octVol);
close(s3.costPerUnit, 5.79, 0.01); // not 132000 ÷ 235504 = 0.56
close(s3.actualUnits, 235504 * 3 / 31);
close(s3.idealCostPerUnit, s3.idealCost / 235504);
const [s1] = toMonthPoints(oct, { "2026-10": 100 }, 23000, undefined, undefined, { "North|2026-10": { heads: 40, cost: 132000, share: 1 } }, undefined, octVol);
close(s1.costPerUnit, 132000 / 235504, 1e-9);
const [fb] = toMonthPoints(oct, { "2026-10": 100 }, 23000, undefined, undefined, undefined, undefined, octVol); // attendance 29–31 only
assert.equal(fb.actualCost, 3 * 30 * 1000);
close(fb.costPerUnit, 90000 / (235504 * 3 / 31), 1e-9);
console.log("functions same-days per-unit OK");

// Task 6 (backfill): the rulebook scenario moves only late orders (EARLY_CREATION / BREACHED); WITHIN_SLA and no-rule (null) orders keep their day
import { retimeOrders, scenarioDelta, placementShare } from "../src/server/functions/aggregate.ts";
const wedOrders = [ // Wed 4 Nov; slot "Monday 6 PM" → breached back to Mon 2 Nov, early forward to Mon 9 Nov
  { day: "2026-11-04", site: "South", tat: "Monday 6 PM", sla: "BREACHED", qty: 10 },
  { day: "2026-11-04", site: "South", tat: "Monday 6 PM", sla: "EARLY_CREATION", qty: 5 },
  { day: "2026-11-04", site: "South", tat: "Monday 6 PM", sla: "WITHIN_SLA", qty: 7 },
  { day: "2026-11-04", site: "South", tat: "Monday 6 PM", sla: null, qty: 3 },
  { day: "2026-11-04", site: "South", tat: null, sla: "BREACHED", qty: 2 }, // no slot: stays
];
const rt = retimeOrders(wedOrders, "2026-11-01", "2026-11-30");
assert.equal(rt.find((r) => r.day === "2026-11-02").received, 10);
assert.equal(rt.find((r) => r.day === "2026-11-09").received, 5);
assert.equal(rt.find((r) => r.day === "2026-11-04").received, 12); // 7 within + 3 no rule + 2 no slot
assert.equal(rt.length, 3);
// manpower part shows while freight is missing (Nov has no LR file); the total is missing, never manpower alone
const sd = scenarioDelta([{ asIsCost: 1000, cost: 600 }, { asIsCost: 500, cost: 700 }], [null], 100);
assert.equal(sd.deltaManpower, 200);
assert.equal(sd.manpowerPerUnit, 2);
assert.equal(sd.deltaFreight, null);
assert.equal(sd.deltaRupees, null);
assert.equal(sd.deltaPerUnit, null);
const sd2 = scenarioDelta([{ asIsCost: 1000, cost: 600 }], [50, 30], 100);
assert.equal(sd2.deltaFreight, 80);
assert.equal(sd2.deltaRupees, 480);
assert.equal(sd2.deltaPerUnit, 4.8);
assert.equal(scenarioDelta([], [], 100).deltaManpower, null);
assert.equal(scenarioDelta([{ asIsCost: 1000, cost: 600 }], [5], null).manpowerPerUnit, null);
// "Ordered in rulebook window": within ÷ units judged; no-rule (null) units are out of the denominator
assert.deepEqual(placementShare([{ sla: "WITHIN_SLA", qty: 20 }, { sla: "BREACHED", qty: 60 }, { sla: "EARLY_CREATION", qty: 20 }, { sla: null, qty: 100 }]), { overlay: 20, overlayBase: 100 }); // early (48–72 h) is outside the window
assert.deepEqual(placementShare([{ sla: null, qty: 100 }]), { overlay: null, overlayBase: null });
console.log("functions rulebook scenario OK");

// Functions overview (actuals): pools add back, missing stays null, the total counts each head once
{
  const { poolShare, dayCells, perTxn, salaryPerHead, OVERVIEW_FN } = await import("../src/server/functions/overviewMath.ts");
  for (const s of ["South", "North"]) {
    close(poolShare("b2b_retail", s) + poolShare("b2b_marketplace", s), 1);
    close(poolShare("b2c_shopify", s) + poolShare("b2c_marketplace", s), 1);
    assert.equal(poolShare("inwards", s), 1);
  }
  close(poolShare("b2b_marketplace", "North"), 7 / 30.5);
  const H = [{ day: "2026-10-05", site: "North", dept: "B2B Forward", heads: 61 }, { day: "2026-10-05", site: "North", dept: "Inward", heads: 20 },
    { day: "2026-10-05", site: "North", dept: "Admin", heads: 3 }];
  const S = [{ day: "2026-10-05", site: "North", stream: "B2B Retail", event: "dispatched", qty: 900, source: "warehouse_sla_performance" },
    { day: "2026-10-05", site: "North", stream: "Inward", event: "putaway", qty: 2000, source: "putaway_tracking" }];
  const c = dayCells("North", H, S);
  close(c.b2b_retail.heads + c.b2b_marketplace.heads, 61);              // the shared pool, split and added back
  assert.equal(c.total.heads, 84);                                        // every department once
  close(Object.keys(OVERVIEW_FN).reduce((a, f) => a + c[f].heads, 0) + c.support.heads, 84); // functions + support = total
  assert.equal(c.b2b_retail.txn, 900);
  assert.equal(c.b2c_shopify.txn, 0);                                     // the forward feed ran that day: no Shopify packages = 0
  assert.equal(c.b2b_marketplace.txn, null);                              // B2B MP dispatch is UC-items only: no UC row = not covered
  assert.equal(c.b2c_returns.txn, 0);                                     // the putaway feed ran that day (Inward pieces): no B2C return pieces = 0
  assert.equal(c.support.txn, 0);                                         // putaway feed ran, no inventory audit moves = 0
  assert.equal(dayCells("North", H, [S[0]]).b2c_returns.txn, null);      // no putaway rows that day at all: unknown, never 0
  assert.equal(c.total.txn, 2900);                                        // the total is the rows' sum (900 dispatched + 2,000 put away + 0s)
  assert.equal(c.total.complete, false);                                  // …but B2B MP is uncovered, so the day is left out of the total's ₹ per item
  assert.equal(c.b2c_returns.heads, 0);                                   // attendance came in without B2C Return heads: a real 0
  const none = dayCells("North", [], S);
  assert.equal(none.total.heads, null); assert.equal(none.inwards.heads, null); // no attendance at all: unknown
  assert.equal(perTxn(100000, 0), null); assert.equal(perTxn(null, 10), null); assert.equal(perTxn(100000, 4000), 25);
  close(salaryPerHead(4_000_000, 4600), 20000);                           // 200 head-months (4,600 head-days ÷ 23) at ₹20,000
  console.log("functions overview OK");
}

// minimum crew: in the ideal and the actual alike — the causes still add to A − I, the crew leaves output per head, not the plan
{
  const { manpowerGap: mg } = await import("../src/server/functions/math.ts");
  const { crewOf } = await import("../src/server/functions/teams.ts");
  const { toMonthPoints: tmp } = await import("../src/server/functions/aggregate.ts");
  const base = { salary: 23000, uph: 500, projAvg: 9000, days: 23, processed: 200000, heldUpUnits: null, actualHeadDays: 600 };
  const g0 = mg({ ...base, idealHeadDays: 500 }), g1 = mg({ ...base, idealHeadDays: 520, crewHeadDays: 20 }); // ideal = workload 500 + crew 20
  const tot = (g) => g.reduce((a, p) => a + (p.rupees ?? 0), 0), by1 = (g, c) => g.find((p) => p.cause === c).rupees;
  close(tot(g1), 80000);                                       // (600 − 520) head-days × ₹1,000
  close(by1(g1, "plan_peak"), by1(g0, "plan_peak"));           // workload vs workload: unchanged by the crew
  close(by1(g1, "below_ipp"), by1(g0, "below_ipp") - 20000);   // 20 crew head-days out of output per head
  close(by1(g1, "other"), 0);
  close(crewOf("b2b_retail", "North") + crewOf("b2b_marketplace", "North"), 7); // B2B Forward's crew of 7, split and added back
  assert.equal(crewOf("inwards", "North"), 6);
  assert.equal(crewOf("inwards", "South"), null);              // South not validated: no crew assumed
  const d = (day, p) => ({ day, site: "North", projected: p, received: null, processed: 200, issues: null, presentHeads: 2, overlay: null });
  const [a0] = tmp([d("2026-11-01", 100), d("2026-11-02", 300)], { "2026-11": 100 }, 23000);
  const [a1] = tmp([d("2026-11-01", 100), d("2026-11-02", 300)], { "2026-11": 100 }, 23000, undefined, undefined, undefined, undefined, undefined, { North: 6 });
  assert.equal(a1.idealHeads, a0.idealHeads + 6);             // on roll: + the crew
  console.log("functions minimum crew OK");
}

// B2B Forward split by the month's workload (items ÷ units per head), in the overview and in Processing's rule split alike
{
  const { workloadShare } = await import("../src/server/functions/overviewMath.ts");
  const { ruleSplit } = await import("../src/server/aop/processingMath.ts");
  const sh = workloadShare([{ items: 9000, uph: 450 }, { items: 2000, uph: 500 }]);   // 20 and 4 head-days of work
  close(sh[0], 20 / 24); close(sh[1], 4 / 24);
  assert.equal(workloadShare([{ items: 9000, uph: 450 }, { items: null, uph: 500 }]), null); // unknown part: keep the fixed weights
  const lines = [{ stream: "B2B Retail", process: "Picker", department: "B2B Forward", target: 1000, volume: 30000 },
    { stream: "B2B Marketplace", process: "Picker", department: "B2B Forward", target: 1000, volume: 10000 }];
  const out = ruleSplit("North", lines, new Map([["B2B Forward", 40]]));
  close(out.get("B2B Retail|Picker"), 30); close(out.get("B2B Marketplace|Picker"), 10); // 3 : 1 workload, not the fixed 23.5 : 7
  const none = ruleSplit("North", lines.map((l) => ({ ...l, volume: l.stream === "B2B Marketplace" ? null : l.volume })), new Map([["B2B Forward", 30.5]]));
  close(none.get("B2B Marketplace|Picker"), 7);                                        // no Marketplace volume: fixed weights
  console.log("functions B2B workload split OK");
}

// SLA maths (25 Nov 2026): projection-sized team, carry-over breaches, heads by TAT, SLA share
{
  const { projectionTeam, simulateBacklog, tatHeads, slaShare, teamRupees } = await import("../src/server/functions/slaMath.ts");
  assert.equal(projectionTeam(1000, 250), 4);
  assert.equal(projectionTeam(null, 250), null); assert.equal(projectionTeam(1000, 0), null);
  const d = (v, c = 100) => ({ day: "x", volume: v, capacity: c });
  assert.deepEqual(simulateBacklog([d(100), d(100)], 1), { exceedDays: 0, breachUnits: 0, total: 200 });
  assert.deepEqual(simulateBacklog([d(150), d(50)], 1), { exceedDays: 1, breachUnits: 0, total: 200 });        // 50 carried one day: within the TAT
  assert.deepEqual(simulateBacklog([d(200), d(100), d(100)], 1), { exceedDays: 1, breachUnits: 0, total: 400 });   // oldest first: day 1's 100 clears on day 2
  assert.deepEqual(simulateBacklog([d(300), d(100), d(100)], 1), { exceedDays: 1, breachUnits: 100, total: 500 }); // 100 of day 1 still open after day 2
  assert.equal(simulateBacklog([d(150), d(null), d(50)], 1).total, 200);                                         // a gap day is skipped
  assert.deepEqual(simulateBacklog([d(300, 100), d(0, 100), d(0, 100)], 0), { exceedDays: 1, breachUnits: 200, total: 300 }); // same-day TAT
  assert.equal(tatHeads([100, 300, 100], 0, 100), 3);
  assert.equal(tatHeads([100, 300, 100], 1, 100), 2);
  assert.ok(Math.abs(tatHeads([100, 300, 100], 2, 100) - 5 / 3) < 1e-9);
  assert.equal(tatHeads([100, null, 300], 1, 100), 2);  // unknown days are skipped, known days stay consecutive
  assert.equal(tatHeads([100], 1, null), null);
  assert.deepEqual(slaShare([{ within: 80, judged: 100 }, { within: null, judged: 50 }, { within: 10, judged: 100 }]), { pct: 45, judged: 200 });
  assert.deepEqual(slaShare([]), { pct: null, judged: null });
  assert.equal(teamRupees(4, 30, 23000), 120000);   // heads × days × salary ÷ 23
  assert.equal(teamRupees(null, 30, 23000), null);
  console.log("functions SLA maths OK");
}

// Pointers (25 Nov 2026): team at the projected average day, its ₹ against actual, breaches when volume runs above, heads by TAT
{
  const { pointers } = await import("../src/server/functions/slaMath.ts");
  const row = (day, received, presentHeads = 5) => ({ day, site: "South", projected: 100, received, processed: received, presentHeads });
  const rows = [row("2026-11-01", 100), row("2026-11-02", 300), row("2026-11-03", 100), row("2026-11-04", 100)];
  const p = pointers({ rows, monthRows: rows, sites: ["South"], uph: () => 50, salary: () => 23000, tatDays: 1, capacityPerDay: null,
    sla: [{ within: 90, judged: 100 }], actual: { rupees: 20000, units: 600, heads: 5 } });
  assert.deepEqual(p.sla, { pct: 90, judged: 100, missed: 10, tatDays: 1 });
  assert.equal(p.team.heads, 2);                       // 100 a day ÷ 50 per head
  assert.equal(p.team.rupees, 8000);                   // 2 heads × 4 days × 23,000 ÷ 23
  assert.equal(p.team.saving, 12000);
  assert.deepEqual(p.above, { exceedDays: 1, breachUnits: 100, total: 600, pct: 100 / 6 }); // day 2's 300: 100 still open after a day
  assert.deepEqual(p.byTat.map((t) => +t.heads.toFixed(6)), [6, 4, 3.333333, 3]);  // peak 300; best 2-day 200; 3-day 166.7; 4-day 150 — ÷ 50
  assert.equal(p.byTat[1].current, true);
  const none = pointers({ rows, monthRows: rows, sites: ["South"], uph: () => null, salary: () => 23000, tatDays: null, capacityPerDay: 5000, sla: [], actual: { rupees: null, units: null, heads: null } });
  assert.equal(none.team, null); assert.deepEqual(none.byTat, []); assert.equal(none.sla.pct, null);
  console.log("functions pointers OK");
}

// Pre-pack ROI (25 Nov 2026)
{
  const { prepackRoi } = await import("../src/server/functions/slaMath.ts");
  const r = prepackRoi([
    { month: "2026-10-01", site: "South", kind: "inward_pp", hours: 2, pieces: 300, packs: null },
    { month: "2026-11-01", site: "South", kind: "inward_pp", hours: 4, pieces: 100, packs: null },
    { month: "2026-10-01", site: "South", kind: "inward_solid", hours: 1, pieces: 500, packs: null },
    { month: "2026-10-01", site: "South", kind: "retail_pp", hours: null, pieces: 400, packs: 100 },
  ], () => 300, () => 23000);
  assert.deepEqual(r.inward, { ppPieces: 400, ppHours: 2.5, solidPieces: 500, solidHours: 1 });
  assert.equal(r.retail.saving, 1000);              // 300 handlings saved ÷ 300 per head-day × ₹1,000 a head-day
  assert.equal(prepackRoi([], () => 300, () => 23000).retail.saving, null);
  console.log("functions pre-pack ROI OK");
}

// Review fixes (25 Nov 2026): no "above" line without a team; TAT ₹ over the same costed days as the team ₹
{
  const { pointers } = await import("../src/server/functions/slaMath.ts");
  const row = (day, presentHeads) => ({ day, site: "South", projected: null, received: 100, processed: 100, presentHeads });
  const noProj = pointers({ rows: [row("2026-11-01", 5)], monthRows: [row("2026-11-01", 5)], sites: ["South"], uph: () => 50, salary: () => 23000, tatDays: 1, capacityPerDay: null,
    sla: [], actual: { rupees: 5000, units: 100, heads: 5 } });
  assert.equal(noProj.team, null); assert.equal(noProj.above, null);   // no projection: no team, no breach line (never "0 days, 0 units")
  const r2 = (day, presentHeads) => ({ day, site: "South", projected: 100, received: 100, processed: 100, presentHeads });
  const rows = [r2("2026-11-01", 5), r2("2026-11-02", null)];         // attendance on one of two days
  const p = pointers({ rows, monthRows: rows, sites: ["South"], uph: () => 50, salary: () => 23000, tatDays: 1, capacityPerDay: null, sla: [], actual: { rupees: 5000, units: 100, heads: 5 } });
  assert.equal(p.team.rupees, 2000);                                   // 2 heads × 1 costed day × 1,000
  assert.equal(p.byTat[0].rupees, 2000);                               // same day, peak 100 ÷ 50 = 2 heads × the same 1 costed day
  console.log("functions review fixes OK");
}
