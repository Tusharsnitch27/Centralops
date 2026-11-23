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
