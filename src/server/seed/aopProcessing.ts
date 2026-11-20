import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/aop-processing-fy27.json";
import { STREAMS } from "../aop/processingTypes";

const deptOf = (stream: string) => STREAMS.find((s) => s.key === stream)?.dept ?? null;

/** Cost Master › YLK_ / TAURU_Processing Costs: process norms + monthly history (Oct 2025 → Oct 2026). Rows the app wrote are never touched. */
export async function seedAopProcessing(S: RunQ) {
  for (const n of data.norms)
    await S(`insert into aop_proc_norms (warehouse, stream, process, department, target_per_day, working_days, avg_salary, ideal_output, sort)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (warehouse, stream, process, effective_from) do update set department = excluded.department, target_per_day = excluded.target_per_day,
               working_days = excluded.working_days, avg_salary = excluded.avg_salary, ideal_output = excluded.ideal_output, sort = excluded.sort`,
      [n.warehouse, n.stream, n.process, deptOf(n.stream), n.target_per_day, n.working_days, n.avg_salary, n.ideal_output, n.sort]);
  for (const m of data.monthly)
    await S(`insert into aop_proc_monthly (period, warehouse, stream, process, sop_proj, planned_mp, final_output, avg_salary, source)
             values ($1,$2,$3,$4,$5,$6,$7,$8,'sheet')
             on conflict (period, warehouse, stream, process) do update set sop_proj = excluded.sop_proj, planned_mp = excluded.planned_mp,
               final_output = excluded.final_output, avg_salary = excluded.avg_salary, updated_at = now()
             where aop_proc_monthly.source = 'sheet'`,
      [m.period, m.warehouse, m.stream, m.process, m.sop_proj, m.planned_mp, m.final_output, m.avg_salary]);
}
