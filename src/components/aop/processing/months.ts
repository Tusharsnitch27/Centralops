import "server-only";
import { q } from "@/server/db";
import { monthStart, today } from "@/lib/dates";

/** Months with processing data (sheet history + app), newest first, not beyond the current month. */
export async function processingMonths() {
  return (await q<{ p: string }>(`select distinct period::text as p from aop_proc_monthly where period <= $1 order by 1 desc`, [monthStart(today())])).map((r) => r.p);
}
