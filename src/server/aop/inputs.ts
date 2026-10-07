import "server-only";
import { q } from "../db";
import { addMonths, today } from "@/lib/dates";
import { allItemsOf, sectionOwner, type ItemRow, type Model } from "./model";

/* Input collection: which function owners have updated their lines for an open period. */

import { dueDate, KIND_MEASURE, type InputKind } from "./deadlines";
export type { InputKind };
export interface FunctionInput {
  sectionId: string; name: string; ownerId: string | null; ownerName: string | null; ownerLabel: string | null;
  updated: number; total: number; status: "submitted" | "complete" | "partial" | "not_started" | "none";
  dueDate: string; late: boolean; submittedAt: string | null; missingItems: { id: string; name: string }[];
}
export interface InputPeriod { period: string; kind: InputKind; dueDate: string; functions: FunctionInput[]; updated: number; total: number; late: number }

/** Due date for a function's input (cycle deadline rules, with per-function overrides such as Logistics actuals on the 12th). */
export const dueFor = (m: Model, period: string, kind: InputKind, functionName?: string | null) => dueDate(m.cycle.deadlines, KIND_MEASURE[kind], period, functionName);

function expected(m: Model, it: ItemRow, period: string, kind: InputKind) {
  const v = it.vals[period];
  if (kind === "budget") return m.closed.slice(-3).some((p) => { const x = it.vals[p]; return !!x && ((x.plan ?? 0) !== 0 || x.actual != null); }) || (v?.plan != null);
  if (kind === "actuals") return !!v && ((v.plan ?? 0) !== 0 || (v.forecast ?? 0) !== 0 || v.actual != null);
  if (v && (v.plan != null || v.forecast != null)) return true;
  // projections: lines that were live recently are expected to carry a provision
  return m.closed.slice(-2).some((p) => { const x = it.vals[p]; return !!x && ((x.plan ?? 0) !== 0 || x.actual != null); });
}
const isUpdated = (it: ItemRow, period: string, kind: InputKind) => {
  const v = it.vals[period];
  return kind === "actuals" ? v?.actual != null : kind === "budget" ? v?.plan != null : v?.forecast != null || v?.actual != null;
};

/** Default open periods: last closed month's actuals + next month's projections (the ones due soonest). */
export function openPeriods(m: Model): { period: string; kind: InputKind }[] {
  const out: { period: string; kind: InputKind }[] = [];
  if (m.lastClosed) out.push({ period: m.lastClosed, kind: "actuals" });
  // provisions for the running month and the next one (next is due on the projection cut-off this month)
  for (const p of [m.currentMonth, addMonths(m.currentMonth, 1)]) if (m.months.includes(p)) out.push({ period: p, kind: "projections" });
  return out;
}

export async function inputPeriod(m: Model, period: string, kind: InputKind): Promise<InputPeriod> {
  const subs = await q<{ section_id: string; status: string; due_date: string | null; submitted_at: string | null; owner_id: string | null }>(
    `select section_id, status, due_date, submitted_at, owner_id from aop_submissions where cycle_id = $1 and period = $2 and kind = $3`, [m.cycle.id, period, kind]);
  const subBy = new Map(subs.map((s) => [s.section_id, s]));
  const td = today();
  const defaultDue = dueFor(m, period, kind);
  const functions: FunctionInput[] = m.functions.map((f) => {
    const items = allItemsOf(f).filter((i) => expected(m, i, period, kind));
    const upd = items.filter((i) => isUpdated(i, period, kind));
    const sub = subBy.get(f.id);
    const owner = sectionOwner(f);
    const dueDate = dueFor(m, period, kind, f.name);
    const submitted = sub && (sub.status === "submitted" || sub.status === "approved");
    const status: FunctionInput["status"] = !items.length ? "none" : submitted ? "submitted" : upd.length === items.length ? "complete" : upd.length ? "partial" : "not_started";
    return {
      sectionId: f.id, name: f.name, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, ownerLabel: f.owner_label,
      updated: upd.length, total: items.length, status, dueDate, late: (status === "partial" || status === "not_started") && dueDate < td,
      submittedAt: sub?.submitted_at ? String(sub.submitted_at) : null,
      missingItems: items.filter((i) => !isUpdated(i, period, kind)).map((i) => ({ id: i.id, name: i.name })),
    };
  }).filter((f) => f.status !== "none");
  return {
    period, kind, dueDate: defaultDue, functions,
    updated: functions.reduce((a, f) => a + f.updated, 0), total: functions.reduce((a, f) => a + f.total, 0), late: functions.filter((f) => f.late).length,
  };
}
