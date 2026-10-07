import "server-only";
import { q } from "../db";
import { addDays, today } from "@/lib/dates";
import type { User } from "../auth";

export interface DaySeries { day: string; value: number }
export interface HomeSeries { completed: DaySeries[]; created: DaySeries[]; meetings: DaySeries[]; followups: DaySeries[] }

/** 14-day activity series for the Summary stat cards (completed / created tasks, meetings, follow-ups sent). */
export async function homeSeries(u: User): Promise<HomeSeries> {
  const t = today(), from = addDays(t, -13);
  const days = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const rows = await q<{ kind: string; day: string; n: number }>(
    `select 'completed' as kind, (completed_at at time zone 'Asia/Kolkata')::date::text as day, count(*)::int as n from tasks
       where completed_at >= $2::date and (owner_id = $1 or requester_id = $1 or created_by = $1) group by 2
     union all
     select 'created', (created_at at time zone 'Asia/Kolkata')::date::text, count(*)::int from tasks
       where created_at >= $2::date and (owner_id = $1 or requester_id = $1 or created_by = $1) group by 2
     union all
     select 'meetings', (m.starts_at at time zone 'Asia/Kolkata')::date::text, count(distinct m.id)::int from meetings m join meeting_attendees a on a.meeting_id = m.id and a.user_id = $1
       where m.starts_at >= $2::date and not m.cancelled group by 2
     union all
     select 'followups', (created_at at time zone 'Asia/Kolkata')::date::text, count(*)::int from followups where requested_by = $1 and created_at >= $2::date group by 2`,
    [u.id, from]);
  const pick = (k: string) => days.map((d) => ({ day: d, value: rows.find((r) => r.kind === k && r.day === d)?.n ?? 0 }));
  return { completed: pick("completed"), created: pick("created"), meetings: pick("meetings"), followups: pick("followups") };
}
