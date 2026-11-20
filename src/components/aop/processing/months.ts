import "server-only";
import { q } from "@/server/db";
import { monthStart, today } from "@/lib/dates";

/** Months with processing data (sheet history + app), newest first, not beyond the current month. */
export async function processingMonths() {
  // sheet history, then every month up to the running one (S&OP + attendance take over after the sheet stops)
  return (await q<{ p: string }>(
    `select g::date::text as p from generate_series((select min(period) from aop_proc_monthly), $1::date, interval '1 month') g order by 1 desc`,
    [monthStart(today())])).map((r) => r.p).filter(Boolean);
}
