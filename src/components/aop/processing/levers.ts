// Client-safe what-if maths on the processing rows, using the contract formulas (processingTypes header).
// ponytail: kept here, not in server/aop/processingMath.ts, because that module's exports weren't fixed when this was written —
// swap to it if Agent C exposes an equivalent.
import type { Levers, StreamBlock } from "@/server/aop/processingTypes";

export interface LeverStream { stream: string; proj: number; output: number; mp: number; exp: number; plannedCpi: number | null; actualCpi: number | null }

/** Model each stream under the levers. Same formula for baseline (BASE_LEVERS) and scenario, so Δ is only the levers. */
export function model(streams: StreamBlock[], l: Levers): { rows: LeverStream[]; total: LeverStream } {
  const rows = streams.map((s) => {
    const proj = (s.sopProj ?? 0) * l.volume;
    const adh = (s.volumeAdherence ?? 1) * l.adherence;
    const output = proj * adh;
    let mp = 0, exp = 0;
    for (const r of s.rows) {
      const perHead = r.outputPerHead ? r.outputPerHead * l.productivity : null;
      const need = perHead ? Math.ceil(proj / perHead) : (r.plannedMp ?? 0); // rows without a target (e.g. fixed Capacity) keep their MP
      mp += need;
      exp += need * (r.avgSalary ?? 0) * l.salary;
    }
    return { stream: s.stream, proj, output, mp, exp, plannedCpi: proj ? exp / proj : null, actualCpi: output ? exp / output : null };
  });
  // ponytail: headcount ± is applied at the total only (not attributed to a stream); attribute per stream if leadership asks
  const salary = avgSalary(streams) * l.salary;
  const t = rows.reduce((a, r) => ({ ...a, proj: a.proj + r.proj, output: a.output + r.output, mp: a.mp + r.mp, exp: a.exp + r.exp }), { stream: "Total", proj: 0, output: 0, mp: l.headcountDelta, exp: l.headcountDelta * salary, plannedCpi: null as number | null, actualCpi: null as number | null });
  return { rows, total: { ...t, plannedCpi: t.proj ? t.exp / t.proj : null, actualCpi: t.output ? t.exp / t.output : null } };
}

function avgSalary(streams: StreamBlock[]) {
  const s = streams.flatMap((x) => x.rows).map((r) => r.avgSalary).filter((v): v is number => v != null && v > 0);
  return s.length ? s.reduce((a, v) => a + v, 0) / s.length : 0;
}

// self-check: node --experimental-strip-types src/components/aop/processing/levers.ts
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("levers.ts")) {
  const s = { stream: "B2C Shopify", channel: "", dept: "", sopProj: 202362, finalOutput: 192709, plannedMp: 0, actualMp: null, idealCpi: null, plannedCpi: null, actualCpi: null, volumeAdherence: 192709 / 202362,
    rows: [{ outputPerHead: 18400, avgSalary: 21983, plannedMp: 25.5 }] } as unknown as StreamBlock;
  const base = model([s], { volume: 1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 0 });
  // sheet: roundup(202362 / 18400) = 11 heads → 11 × 21983
  if (base.rows[0]!.mp !== 11 || Math.round(base.rows[0]!.exp) !== 241813) throw new Error(`levers self-check failed: ${JSON.stringify(base.rows[0])}`);
  const up = model([s], { volume: 1.1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 2 });
  if (up.rows[0]!.mp !== 13 || up.total.mp !== 15) throw new Error(`levers self-check failed: ${JSON.stringify(up.total)}`);
  console.log("levers ok");
}
