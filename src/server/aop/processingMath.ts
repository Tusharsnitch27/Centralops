// Pure processing-cost maths (no server imports) — used by processing.ts and the client lever panel.
// Formulas: see the header of processingTypes.ts (Cost Master › YLK_ / TAURU_Processing Costs).
import type { Levers, ProcRow, StreamBlock } from "./processingTypes";

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
