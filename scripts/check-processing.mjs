// Self-check: processingMath reproduces the Cost Master for South · B2C Shopify · Picker · Oct'25.
// node --experimental-strip-types scripts/check-processing.mjs
import assert from "node:assert/strict";
import { computeRow, outputPerHead, applyLevers, ruleSplit } from "../src/server/aop/processingMath.ts";

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
// 22 Nov rule split: North B2C Forward 74 heads → SF 60 % / MP 40 %; designations (30 pick, 26 pack, 10 manifest, 8 other by 1/IPP)
const L = (stream, process, target) => ({ stream, process, department: "B2C Forward", target, volume: null });
const sp = ruleSplit("North", [L("B2C Shopify", "Picker", 650), L("B2C Shopify", "Packer", 750), L("B2C Shopify", "Manifest", 1500), L("B2C Marketplace", "Picker", 650), L("B2C Marketplace", "Packer", 600), L("B2C Marketplace", "Manifest", 1500)], new Map([["B2C Forward", 74]]));
close([...sp.values()].reduce((a, x) => a + x, 0), 74, 1e-9);
close(sp.get("B2C Shopify|Picker") + sp.get("B2C Shopify|Packer") + sp.get("B2C Shopify|Manifest"), 74 * 0.6, 1e-9);
close(sp.get("B2C Shopify|Picker"), 74 * 0.6 * (30 + 8 * (1 / 650) / (1 / 650 + 1 / 750 + 1 / 1500)) / 74, 1e-9);
// B2B Return → store returns only
const br = ruleSplit("South", [{ stream: "B2B Returns Retail", process: "Processing", department: "B2B Return", target: 1500, volume: null }, { stream: "B2B Returns Marketplace", process: "Processing", department: "B2B Return", target: 1500, volume: null }], new Map([["B2B Return", 30]]));
assert.equal(br.get("B2B Returns Marketplace|Processing"), 0);
close(br.get("B2B Returns Retail|Processing"), 30, 1e-9);
console.log("processing math OK", { mpRequired: r.mpRequired, plannedExp: r.plannedExp, plannedCpi: r.plannedCpi.toFixed(4), actualCpi: r.actualCpi.toFixed(4), adherence: r.volumeAdherence.toFixed(4) });
