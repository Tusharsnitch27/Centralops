// Self-check: shared maths for the AOP Functions view.
// node --experimental-strip-types scripts/check-functions.mjs
import assert from "node:assert/strict";
import { unitsPerHead, idealHeads, manpowerGap, perUnit, zoneClass } from "../src/server/functions/math.ts";

const close = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) < d, `${a} ≠ ${b}`);
close(unitsPerHead([{ ipp: 1000, unit: "unit" }, { ipp: 1600, unit: "unit" }, { ipp: 100, unit: "box" }]), 510.64);
close(unitsPerHead([{ ipp: 80, unit: "unit", pass: 0.15 }]), 533.33);
assert.equal(unitsPerHead([{ ipp: null, unit: "unit" }]), null);
assert.deepEqual(idealHeads(10000, 512.82), { floor: 20, roll: 22 });
assert.equal(idealHeads(null, 500), null);

const input = { salary: 21983, workDays: 23, uph: 500, proj: { peak: 12000, avg: 9000 }, act: { peak: 15000, avg: 10000 }, processed: 200000, heldUpUnits: 5000, actualHeadDays: 600, idealFloor: 24 };
const by = (g, c) => g.find((p) => p.cause === c);
const total = (g) => g.reduce((a, p) => a + (p.rupees ?? 0), 0);
const g = manpowerGap(input);
close(by(g, "volume").rupees, 43966, 1);
close(by(g, "erratic").rupees, 87932, 1);
close(by(g, "held_up").rupees, 9558, 1);
close(by(g, "below_ipp").rupees, 181599, 1);
assert.equal(by(g, "absenteeism").rupees, null);
close(total(g), 45877, 1);
const g2 = manpowerGap({ ...input, heldUpUnits: null });
assert.equal(by(g2, "held_up").rupees, null);
close(total(g2), 45877, 1);

assert.equal(perUnit(100000, 15, 18000), null);
assert.equal(perUnit(100000, 20000, 18000), 5);
assert.equal(zoneClass("North", "NORTH"), "home");
assert.equal(zoneClass("North", "SOUTH"), "cross");
assert.equal(zoneClass("South", "WEST"), "unmapped");
assert.equal(zoneClass("South", null), "unmapped");
console.log("functions math OK");

// Task 4: aggregation of day rows to month points, and the rulebook slot's processing weekday
import { toMonthPoints, toDayPoints, processingWeekday } from "../src/server/functions/aggregate.ts";
const day = (d, projected, processed, presentHeads, site = "South") => ({ day: d, site, projected, received: null, processed, issues: null, presentHeads, overlay: null });
const [mp] = toMonthPoints([day("2026-11-01", 100, 200, 2), day("2026-11-02", 300, 200, 2)], { "2026-11": 100 }, 23000);
assert.equal(mp.projected, 400);
assert.equal(mp.idealHeads, 3);
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
