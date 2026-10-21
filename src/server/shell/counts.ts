import "server-only";
import { one } from "../db";
import { today } from "@/lib/dates";
import type { User } from "../auth";
import { weeklyPendingCount } from "../weekly/model";

/** Sidebar badge counts — cheap aggregate queries. */
export async function navCounts(u: User): Promise<Record<string, number>> {
  const t = today();
  const r = await one<Record<string, number>>(
    `select
       (select count(*)::int from inbox_items where user_id = $1 and status = 'open' and (snoozed_until is null or snoozed_until < now())) as inbox,
       (select count(*)::int from tasks where status in ('not_started','in_progress','waiting','blocked') and due_date < $2
          and (owner_id = $1 or requester_id = $1 or created_by = $1)) as overdue,
       (select count(*)::int from meetings where not cancelled and ends_at < now() and starts_at::date >= $3::date
          and ((mom_status in ('pending','draft') and coalesce(mom_owner_id, organizer_id) = $1) or (mom_status = 'submitted' and $4))) as mom,
       (select count(distinct s.section_id)::int from aop_submissions s join aop_cycles c on c.id = s.cycle_id
          where c.status = 'active' and s.status = 'pending' and s.due_date between $2::date - 10 and $2::date + 3 and ($4 or s.owner_id = $1)) as aop,
       (select count(*)::int from sop_submissions s join sop_streams st on st.id = s.stream_id
          where s.status in ('pending','late') and s.due_date <= $2::date + 3 and ($4 or st.poc_id = $1)) as sop,
       (select count(*)::int from notifications where user_id = $1 and read_at is null) as notifications`,
    [u.id, t, u.joined_at, u.role === "admin" || u.role === "pm"],
  );
  return { ...(r ?? {}), weekly: await weeklyPendingCount(u).catch(() => 0) };
}
