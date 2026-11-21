// Client-safe what-if maths on the processing rows, using the contract formulas (processingTypes header).
// ponytail: kept here, not in server/aop/processingMath.ts, because that module's exports weren't fixed when this was written —
// swap to it if Agent C exposes an equivalent.
import type { Levers, StreamBlock } from "@/server/aop/processingTypes";

export interface LeverStream { stream: string; proj: number; output: number; mp: number; exp: number; plannedCpi: number | null; actualCpi: number | null }

const need = (proj: number, perHead: number) => Math.ceil(proj / perHead);

/**
 * Model each stream under the levers, one site at a time (`sites` = Processing's per-site streams), then add sites by stream.
 * Baseline = Processing's planned MP and planned expense exactly (audit #6). Scenario = planned MP + the change in
 * ⌈projection ÷ output/head⌉ the levers cause, so a neutral scenario returns the baseline to the head and the rupee.
 */
export function model(sites: StreamBlock[][], l: Levers): { rows: LeverStream[]; total: LeverStream } {
  const by = new Map<string, LeverStream>();
  let salSum = 0, salHeads = 0;
  for (const streams of sites) for (const s of streams) {
    const proj = (s.sopProj ?? 0) * l.volume;
    const output = proj * (s.volumeAdherence ?? 1) * l.adherence;
    let mp = 0, exp = 0;
    for (const r of s.rows) {
      const pMp = r.plannedMp ?? 0, sal = r.avgSalary ?? 0, rp = r.sopProj ?? s.sopProj ?? 0;
      // rows without a target (e.g. fixed Capacity) keep their planned MP
      const d = r.outputPerHead ? need(rp * l.volume, r.outputPerHead * l.productivity) - need(rp, r.outputPerHead) : 0;
      const m = Math.max(0, pMp + d);
      mp += m;
      exp += ((r.plannedExp ?? pMp * sal) + (m - pMp) * sal) * l.salary;
      if (sal > 0) { salSum += sal * pMp; salHeads += pMp; }
    }
    const c = by.get(s.stream) ?? { stream: s.stream, proj: 0, output: 0, mp: 0, exp: 0, plannedCpi: null, actualCpi: null };
    c.proj += proj; c.output += output; c.mp += mp; c.exp += exp;
    by.set(s.stream, c);
  }
  const rows = [...by.values()].map((r) => ({ ...r, plannedCpi: r.proj ? r.exp / r.proj : null, actualCpi: r.output ? r.exp / r.output : null }));
  // ponytail: headcount ± is applied at the total only (not attributed to a stream), at the planned-heads-weighted salary
  const salary = (salHeads ? salSum / salHeads : 0) * l.salary;
  const t = rows.reduce((a, r) => ({ ...a, proj: a.proj + r.proj, output: a.output + r.output, mp: a.mp + r.mp, exp: a.exp + r.exp }), { stream: "Total", proj: 0, output: 0, mp: l.headcountDelta, exp: l.headcountDelta * salary, plannedCpi: null as number | null, actualCpi: null as number | null });
  return { rows, total: { ...t, plannedCpi: t.proj ? t.exp / t.proj : null, actualCpi: t.output ? t.exp / t.output : null } };
}

// self-check: node --experimental-strip-types src/components/aop/processing/levers.ts
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("levers.ts")) {
  const blk = (plannedMp: number, oph: number, sal: number) => ({ stream: "B2C Shopify", sopProj: 202362, volumeAdherence: 192709 / 202362,
    rows: [{ sopProj: 202362, outputPerHead: oph, avgSalary: sal, plannedMp, plannedExp: plannedMp * sal }] }) as unknown as StreamBlock;
  const south = [blk(25.5, 18400, 21983)], north = [blk(9, 12000, 20000)];
  const base = model([south, north], { volume: 1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 0 });
  // neutral = Processing's planned MP / expense, summed over sites (not recomputed, not averaged)
  if (base.rows[0]!.mp !== 34.5 || Math.round(base.rows[0]!.exp) !== Math.round(25.5 * 21983 + 9 * 20000)) throw new Error(`levers neutral failed: ${JSON.stringify(base.rows[0])}`);
  // +10% volume: South ⌈222598/18400⌉ − 11 = +2, North ⌈222598/12000⌉ − 17 = +2 → 38.5; +2 heads at the total
  const up = model([south, north], { volume: 1.1, productivity: 1, adherence: 1, salary: 1, headcountDelta: 2 });
  if (up.rows[0]!.mp !== 38.5 || up.total.mp !== 40.5) throw new Error(`levers +10% failed: ${JSON.stringify(up.total)}`);
  console.log("levers ok");
}
