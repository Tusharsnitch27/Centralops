import "server-only";
import { one, q } from "../db";
import { DEFAULT_ENGINE, type EngineInput } from "@/lib/facilityEngine";

export interface ObDay { day: string; warehouse: "South" | "North"; mp_required: number; retail_required: number; planned: number }
export const listObCapacity = () => q<ObDay>(`select day::text as day, warehouse, mp_required, retail_required, planned from sop_ob_capacity order by day, warehouse desc`);
export async function engineScenario(): Promise<{ input: EngineInput; savedAt: string | null }> {
  const r = await one<{ value: EngineInput & { savedAt?: string } }>(`select value from app_settings where key = 'sop.facility_engine'`);
  return r?.value?.caps ? { input: { caps: r.value.caps, loads: r.value.loads }, savedAt: r.value.savedAt ?? null } : { input: DEFAULT_ENGINE, savedAt: null };
}

export interface Callout { id: string; meeting_date: string | null; title: string; poc: string; remarks: string; status: "open" | "done"; task_id: string | null; task_number: number | null; task_status: string | null; task_due: string | null }
export const listCallouts = () => q<Callout>(
  `select c.id, c.meeting_date::text as meeting_date, c.title, c.poc, c.remarks, c.status, c.task_id, t.number as task_number, t.status as task_status, t.due_date::text as task_due
   from sop_callouts c left join tasks t on t.id = c.task_id order by c.meeting_date desc nulls last, c.sort, c.created_at`);
