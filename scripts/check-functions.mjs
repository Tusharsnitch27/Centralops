// Self-check: shared maths for the AOP Functions view.
// node --experimental-strip-types scripts/check-functions.mjs
import assert from "node:assert/strict";
import { unitsPerHead, idealHeads, manpowerGap, perUnit, zoneClass } from "../src/server/functions/math.ts";
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

assert.equal(perUnit(100000, 15, 18000), null);
assert.equal(perUnit(100000, 20000, 18000), 5);
assert.equal(zoneClass("North", "NORTH"), "home");
assert.equal(zoneClass("North", "SOUTH"), "cross");
assert.equal(zoneClass("South", "WEST"), "unmapped");
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
const [mp] = toMonthPoints([day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2)], { "2026-11": 100 }, 23000);
assert.equal(mp.projected, 400);
// month view: on roll with weekly-off cover, ⌈300 ÷ 100 × 30 ÷ 23 × 1.1⌉ = 5 (on the floor ⌈300 ÷ 100⌉ = 3)
assert.equal(mp.idealHeads, 5);
assert.equal(onRoll(300, 100, 30), 5);
assert.equal(onRoll(null, 100, 30), null);
assert.equal(mp.actualCost, 4000);
assert.equal(mp.costPerUnit, 10);
// no projection for the month → projected and ideal are missing, never 0
const [np] = toMonthPoints([day("2026-11-01", null, 200, 2)], { "2026-11": 100 }, 23000);
assert.equal(np.projected, null);
assert.equal(np.idealHeads, null);
assert.equal(np.idealCost, null);
// day mode: each day carries its month's peak (300 → 3 heads), Both = sum of the sites
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

// Task 2 (backfill): order placement against the rulebook cutoff, as retail_journey_spine flags it (Sep–Nov rows):
// on the cutoff day before the cutoff = within; 1–2 days ahead = early (Friday counts for a Monday cutoff); later or further ahead = breached
import { placementSla } from "../src/server/functions/aggregate.ts";
const wed = { cutoff: "Wednesday 12 PM" };
assert.equal(placementSla("2026-06-03T10:00", wed), "WITHIN_SLA");
assert.equal(placementSla("2026-06-03 14:00:00", wed), "BREACHED");
assert.equal(placementSla("2026-06-01T10:00", wed), "EARLY_CREATION"); // Monday, 2 days ahead
assert.equal(placementSla("2026-05-31T10:00", wed), "BREACHED"); // Sunday, 3 days ahead: after the previous cutoff
assert.equal(placementSla("2026-05-29T15:00", { cutoff: "Monday 9 AM" }), "EARLY_CREATION"); // Friday for Monday
assert.equal(placementSla("2026-05-28T15:00", { cutoff: "Monday 9 AM" }), "BREACHED");
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
assert.deepEqual(placementShare([{ sla: "WITHIN_SLA", qty: 20 }, { sla: "BREACHED", qty: 60 }, { sla: "EARLY_CREATION", qty: 20 }, { sla: null, qty: 100 }]), { overlay: 20, overlayBase: 100 });
assert.deepEqual(placementShare([{ sla: null, qty: 100 }]), { overlay: null, overlayBase: null });
console.log("functions rulebook scenario OK");
