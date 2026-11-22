// Pure processing-cost maths (no server imports) — used by processing.ts and the client lever panel.
// Formulas: see the header of processingTypes.ts (Cost Master › YLK_ / TAURU_Processing Costs).
import type { Levers, ProcRow, StreamBlock, StreamKey, Wh } from "./processingTypes";

export interface Norm { targetPerDay: number | null; workingDays: number; avgSalary: number | null }
export interface MonthIn {
  sopProj: number | null; plannedMp: number | null; finalOutput: number | null; salary: number | null;
  actualMp: number | null;
  /** share of the month the actual MP covers (attendance month-to-date); 1 = full month */
  actualShare?: number;
}

const div = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : a / b);

/** Units one head processes in a month. */
export const outputPerHead = (n: Norm) => (n.targetPerDay == null ? null : n.targetPerDay * n.workingDays);

/** One process line, exactly as the sheet computes it. */
export function computeRow(n: Norm, m: MonthIn) {
  const oph = outputPerHead(n);
  const salary = m.salary ?? n.avgSalary;
  const mpRequired = m.sopProj != null && oph ? Math.ceil(m.sopProj / oph) : null;
  const plannedMp = m.plannedMp ?? mpRequired;
  const plannedExp = plannedMp != null && salary != null ? plannedMp * salary : null;
  const plannedCpi = div(plannedExp, m.sopProj);
  const actualExp = m.actualMp != null && salary != null ? m.actualMp * salary * (m.actualShare ?? 1) : null;
  const actualCpi = div(actualExp, m.finalOutput);
  return {
    outputPerHead: oph, idealCpi: div(n.avgSalary, oph), mpRequired, plannedMp, plannedExp, plannedCpi, actualExp, actualCpi,
    volumeAdherence: div(m.finalOutput, m.sopProj), mpAdherence: div(m.actualMp, plannedMp),
    costImpact: plannedCpi != null && actualCpi != null && m.finalOutput != null ? (plannedCpi - actualCpi) * m.finalOutput : null,
  };
}

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
const maxOrNull = (xs: (number | null)[]) => (xs.some((x) => x != null) ? Math.max(...xs.filter((x): x is number => x != null)) : null);

/** Stream roll-up: CPI = Σ process CPI (sheet rule); volume = the stream's (largest process) volume. */
export function rollupStream(rows: ProcRow[]): Pick<StreamBlock, "sopProj" | "finalOutput" | "plannedMp" | "actualMp" | "idealCpi" | "plannedCpi" | "actualCpi" | "volumeAdherence"> {
  const sopProj = maxOrNull(rows.map((r) => r.sopProj)), finalOutput = maxOrNull(rows.map((r) => r.finalOutput));
  return {
    sopProj, finalOutput, plannedMp: rows.reduce((a, r) => a + (r.plannedMp ?? 0), 0), actualMp: sumOrNull(rows.map((r) => r.actualMp)),
    idealCpi: sumOrNull(rows.map((r) => r.idealCpi)), plannedCpi: sumOrNull(rows.map((r) => r.plannedCpi)), actualCpi: sumOrNull(rows.map((r) => r.actualCpi)),
    volumeAdherence: div(finalOutput, sopProj),
  };
}

/**
 * What-if for one line: volume scales the projection, productivity the target, adherence the realised output,
 * salary the cost; headcountDelta adds heads on top of the re-derived MP requirement. Plan is re-derived from the norms.
 */
export function applyLevers(r: ProcRow, l: Levers): ProcRow {
  const n: Norm = { targetPerDay: r.targetPerDay == null ? null : r.targetPerDay * l.productivity, workingDays: r.workingDays, avgSalary: r.avgSalary == null ? null : r.avgSalary * l.salary };
  const sopProj = r.sopProj == null ? null : r.sopProj * l.volume;
  const req = sopProj != null && outputPerHead(n) ? Math.ceil(sopProj / outputPerHead(n)!) : r.plannedMp; // fixed lines (Capacity) keep their MP
  const plannedMp = req == null ? null : Math.max(0, req + l.headcountDelta);
  const finalOutput = sopProj == null ? null : sopProj * (r.volumeAdherence ?? 1) * l.adherence;
  const c = computeRow(n, { sopProj, plannedMp, finalOutput, salary: n.avgSalary, actualMp: plannedMp });
  return { ...r, ...c, targetPerDay: n.targetPerDay, avgSalary: n.avgSalary, sopProj, finalOutput, actualMp: plannedMp };
}

/**
 * Department heads → stream × process (Malhar M, 22 Nov 2026; stored rows still win):
 *  stream  forward = Manish's Manpower Allocation tab (B2C SF / MP, B2B Retail / MP); B2B Return = all store returns (Retail);
 *          B2C Return = each returns stream's volume that month (final output, else S&OP projection; none → the B2C forward share)
 *  process = attendance designation where it names the process (employee master 22 Nov, counts in DESIG); everyone else
 *          (generic "Associate", supervisors, DEO) by IPP workload — one unit passes every stage, so a stage's share ∝ 1 ÷ IPP
 */
const ALLOC: Record<Wh, Partial<Record<StreamKey, number>>> = {
  North: { "B2C Shopify": 12, "B2C Marketplace": 8, "B2B Retail": 23.5, "B2B Marketplace": 7 },
  South: { "B2C Shopify": 16, "B2C Marketplace": 11, "B2B Retail": 25.5, "B2B Marketplace": 8 },
};
const DESIG: Record<Wh, Record<string, Record<string, number>>> = {
  North: { "B2B Forward": { pick: 33, pack: 15, load: 7, other: 8 }, "B2B Return": { process: 5, qc: 11, other: 4 }, "B2C Forward": { pick: 30, pack: 26, manifest: 10, other: 8 },
    "B2C Return": { process: 35, spf: 6, other: 2 }, Inventory: { putaway: 27, audit: 13, other: 10 }, Inward: { ratio: 11, unload: 10, other: 7 } },
  South: { "B2B Forward": { pick: 23, load: 4, other: 60 }, "B2B Return": { qc: 10, other: 20 }, "B2C Forward": { pick: 8, other: 63 },
    "B2C Return": { qc: 1, other: 23 }, Inventory: { other: 16 }, Inward: { putaway: 9, other: 19 } },
};
const PROC: Record<string, RegExp> = { pick: /pick/i, pack: /pack(er|ing)?$/i, manifest: /manifest/i, load: /^(loader|bagging)/i, qc: /qc/i, process: /^processing$/i,
  spf: /spf/i, putaway: /put.?away/i, ratio: /ratio/i, unload: /unload/i, audit: /audit|cc/i };
type PLine = { stream: StreamKey; process: string; department: string; target: number | null; volume: number | null };
export function ruleSplit(wh: Wh, lines: PLine[], heads: Map<string, number>) {
  const out = new Map<string, number>();
  for (const [dept, h] of heads) {
    const ls = lines.filter((l) => l.department === dept);
    if (!ls.length) continue;
    const streams = [...new Set(ls.map((l) => l.stream))];
    const vol = (st: StreamKey) => Math.max(0, ...ls.filter((l) => l.stream === st).map((l) => l.volume ?? 0));
    const w = (st: StreamKey) => dept === "B2B Return" ? (/retail/i.test(st) ? 1 : 0)
      : dept === "B2C Return" ? (streams.some((x) => vol(x) > 0) ? vol(st) : ALLOC[wh][/shopify/i.test(st) ? "B2C Shopify" : "B2C Marketplace"] ?? 1)
      : ALLOC[wh][st] ?? 1;
    const wTot = streams.reduce((a, st) => a + w(st), 0) || 1;
    const d = DESIG[wh][dept] ?? {}, total = Object.values(d).reduce((a, n) => a + n, 0) || 1;
    for (const st of streams) {
      const sl = ls.filter((l) => l.stream === st);
      const named = new Map(sl.map((l) => [l, Object.entries(PROC).filter(([g, re]) => d[g] && re.test(l.process)).reduce((a, [g]) => a + d[g]!, 0)]));
      const matched = new Set(Object.keys(PROC).filter((g) => d[g] && sl.some((l) => PROC[g]!.test(l.process))));
      const generic = total - [...matched].reduce((a, g) => a + d[g]!, 0);
      const inv = sl.map((l) => (l.target ? 1 / l.target : 0)), invTot = inv.reduce((a, x) => a + x, 0);
      for (const [i, l] of sl.entries()) {
        const share = (named.get(l)! + generic * (invTot ? inv[i]! / invTot : 1 / sl.length)) / total;
        out.set(`${l.stream}|${l.process}`, (h * w(st) / wTot) * share);
      }
    }
  }
  return out;
}

