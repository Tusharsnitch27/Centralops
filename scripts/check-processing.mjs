// Self-check: processingMath reproduces the Cost Master for South · B2C Shopify · Picker · Oct'25.
// node --experimental-strip-types scripts/check-processing.mjs
import assert from "node:assert/strict";
import { computeRow, outputPerHead, applyLevers, ruleSplit, matchIpp, passShare } from "../src/server/aop/processingMath.ts";

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
// SPF: only ~15 % of B2C return units pass it, so generic heads weight its 1/IPP by 0.15 (South: no named designations match)
const R = (process, target) => ({ stream: "B2C Returns Shopify", process, department: "B2C Return", target, volume: 100 });
const spf = ruleSplit("South", [R("Receiving", 2700), R("Processing", 300), R("SPF", 80)], new Map([["B2C Return", 22]]));
close(spf.get("B2C Returns Shopify|SPF"), 22 * (0.15 / 80) / (1 / 2700 + 1 / 300 + 0.15 / 80), 1e-9);
assert.ok(spf.get("B2C Returns Shopify|SPF") < 22 * 0.4, "SPF no longer takes most generic heads");
// heads needed = ⌈output × pass ÷ (IPP × working days × share of month)⌉ — SPF at 15 %
const nd = computeRow({ targetPerDay: 80, workingDays: 23, avgSalary: 20000 }, { sopProj: null, plannedMp: null, finalOutput: 10000, salary: 20000, actualMp: 5, actualShare: 0.5, pass: 0.15 });
assert.equal(nd.needMp, Math.ceil((10000 * 0.15) / (80 * 23 * 0.5)));
close(nd.needExp, nd.needMp * 20000 * 0.5, 1e-9);
// updated IPP master: exact stage, else stage starting with the process; box stages x 30; missing stays null
assert.equal(matchIpp("B2C Shopify", "Picker", [{ stream: "B2C Shopify", stage: "Picker", unit: "unit", ipp: 750 }]), 750);
assert.equal(matchIpp("B2C Returns Shopify", "Processing", [{ stream: "B2C Returns Shopify", stage: "Processing & QC", unit: "unit", ipp: 250 }]), 250);
assert.equal(matchIpp("Inward", "Unloader", [{ stream: "Inward", stage: "Unloader", unit: "box", ipp: 200 }]), 6000);
assert.equal(matchIpp("B2B Retail", "Loader", [{ stream: "B2B Retail", stage: "Picker", unit: "unit", ipp: 700 }]), null);
assert.equal(matchIpp("B2C Shopify", "Picker", [{ stream: "B2C Shopify", stage: "Picker", unit: "unit", ipp: null }]), null);
// exception stages at a 5 % pass (23 Nov 2026); SPF 15 %; everything else every unit
assert.equal(passShare("WPR"), 0.05);
assert.equal(passShare("WFR/CS escalation"), 0.05);
assert.equal(passShare("SPF"), 0.15);
assert.equal(passShare("Picker"), 1);
console.log("processing math OK", { mpRequired: r.mpRequired, plannedExp: r.plannedExp, plannedCpi: r.plannedCpi.toFixed(4), actualCpi: r.actualCpi.toFixed(4), adherence: r.volumeAdherence.toFixed(4) });
// attendance ahead of the sheet's planned MP when it covers ≥ 90 % of the month (28 of 30 days); otherwise the sheet, then attendance
import { actualMpOf } from "../src/server/aop/processingMath.ts";
const att = { mp: 30, src: "attendance" };
assert.deepEqual(actualMpOf(25.5, att, 28 / 30), { actualMp: 30, src: "attendance", attendance: true });
assert.deepEqual(actualMpOf(25.5, att, 3 / 31), { actualMp: 25.5, src: "sheet", attendance: false });
assert.deepEqual(actualMpOf(null, att, 3 / 31), { actualMp: 30, src: "attendance", attendance: true });
assert.deepEqual(actualMpOf(null, null, 1), { actualMp: null, src: null, attendance: false });
console.log("processing attendance-first OK");
