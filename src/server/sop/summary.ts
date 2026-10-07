import "server-only";
import { addMonths, today } from "@/lib/dates";
import { currentPeriod, isOpenSub } from "./model";
import { getCapacityBreaches, getNextReview, getStreamMonthly, getSubmissionGrid, streamAccuracy } from "./queries";

export interface SopHeadline {
  /** Month whose projections are being collected ('YYYY-MM-01'). */
  nextPeriod: string;
  pendingStreams: { id: string; name: string; poc_name: string | null; due_date: string; late: boolean }[];
  submitted: number;
  total: number;
  /** Projection accuracy for the last closed month (0..1). */
  accuracyLastMonth: number | null;
  accuracyIsDemo: boolean;
  capacityBreaches: { period: string; warehouse: string; department: string; required: number; available: number }[];
  nextReview: { id: string; title: string; starts_at: string } | null;
}

/** S&OP headline for the Command Centre. */
export async function sopHeadline(): Promise<SopHeadline> {
  const cur = currentPeriod(today());
  const next = addMonths(cur, 1);
  const lastClosed = addMonths(cur, -1);
  const [grid, monthly, breaches, review] = await Promise.all([
    getSubmissionGrid([next]),
    getStreamMonthly(lastClosed, lastClosed),
    getCapacityBreaches(cur, addMonths(cur, 2)),
    getNextReview(),
  ]);
  const byId = new Map(grid.streams.map((s) => [s.id, s]));
  const relevant = grid.cells.filter((c) => c.state !== "na");
  const acc = streamAccuracy(monthly, null, lastClosed);
  return {
    nextPeriod: next,
    pendingStreams: relevant.filter((c) => isOpenSub(c.state)).map((c) => {
      const s = byId.get(c.stream_id)!;
      return { id: s.id, name: s.name, poc_name: s.poc_name ?? s.poc_label, due_date: c.due_date, late: c.state === "late" };
    }),
    submitted: relevant.filter((c) => !isOpenSub(c.state)).length,
    total: relevant.length,
    accuracyLastMonth: acc.accuracy,
    accuracyIsDemo: acc.demo,
    capacityBreaches: breaches.map(({ period, warehouse, department, required, available }) => ({ period, warehouse, department, required, available })),
    nextReview: review ? { id: review.id, title: review.title, starts_at: new Date(review.starts_at).toISOString() } : null,
  };
}
