// Self-check: processingMath reproduces the Cost Master for South · B2C Shopify · Picker · Oct'25.
// node --experimental-strip-types scripts/check-processing.mjs
import assert from "node:assert/strict";
import { computeRow, outputPerHead, applyLevers } from "../src/server/aop/processingMath.ts";

const n = { targetPerDay: 800, workingDays: 23, avgSalary: 21983 };
assert.equal(outputPerHead(n), 18400);
const r = computeRow(n, { sopProj: 202362, plannedMp: 25.5, finalOutput: 192709, salary: 21983, actualMp: 25.5 });
const close = (a, b, d = 1e-4) => assert.ok(Math.abs(a - b) < d, `${a} ≠ ${b}`);
assert.equal(r.mpRequired, 11);
close(r.plannedExp, 560566.5);
close(r.plannedCpi, 2.7701, 1e-4);
close(r.actualCpi, 2.9089, 1e-4);
close(r.volumeAdherence, 0.9523, 1e-4);
close(r.idealCpi, 21983 / 18400);
// neutral levers keep the plan re-derived from norms (MP = requirement)
const row = { stream: "B2C Shopify", process: "Picker", department: "B2C Forward", targetPerDay: 800, workingDays: 23, avgSalary: 21983, sopProj: 202362, plannedMp: 25.5, volumeAdherence: 0.9523 };
assert.equal(applyLevers(row, { volume: 1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 0 }).plannedMp, 11);
assert.equal(applyLevers(row, { volume: 2, productivity: 1, adherence: 1, salary: 1, headcountDelta: 0 }).plannedMp, 22);
console.log("processing math OK", { mpRequired: r.mpRequired, plannedExp: r.plannedExp, plannedCpi: r.plannedCpi.toFixed(4), actualCpi: r.actualCpi.toFixed(4), adherence: r.volumeAdherence.toFixed(4) });
