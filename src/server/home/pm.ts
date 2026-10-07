import "server-only";
import { q } from "../db";
import { addDays, today } from "@/lib/dates";

export async function upcomingReviews() {
  return q<{ id: string; title: string; starts_at: string; review: string; mom_owner: string | null; open_actions: number; overdue_actions: number; module: string | null }>(
    `select m.id, m.title, m.starts_at, r.name as review, mo.name as mom_owner, r.module,
       (select count(*)::int from tasks t join meetings pm on pm.id = t.meeting_id where pm.review_id = r.id and t.status not in ('completed','cancelled')) as open_actions,
       (select count(*)::int from tasks t join meetings pm on pm.id = t.meeting_id where pm.review_id = r.id and t.status not in ('completed','cancelled') and t.due_date < $1) as overdue_actions
     from meetings m join reviews r on r.id = m.review_id left join users mo on mo.id = m.mom_owner_id
     where not m.cancelled and m.starts_at > now() and m.starts_at < $2::date + 1 order by m.starts_at limit 8`, [today(), addDays(today(), 10)]);
}

/** Owners whose inputs are missing across AOP, S&OP and delegated work. */
export async function missingUpdates() {
  return q<{ who: string | null; user_id: string | null; what: string; due: string | null; href: string; kind: string }>(
    `select o.name as who, o.id as user_id, sec.name || ' · ' || s.kind || ' ' || to_char(s.period, 'Mon') as what, s.due_date as due, '/aop/inputs' as href, 'AOP' as kind
       from aop_submissions s join aop_sections sec on sec.id = s.section_id left join users o on o.id = s.owner_id join aop_cycles c on c.id = s.cycle_id
       where c.status = 'active' and s.status = 'pending' and s.due_date <= $1::date + 3
     union all
     select o.name, o.id, st.name || ' · ' || to_char(s.period, 'Mon'), s.due_date, '/sop/inputs', 'S&OP'
       from sop_submissions s join sop_streams st on st.id = s.stream_id left join users o on o.id = st.poc_id
       where s.status in ('pending','late') and s.due_date <= $1::date + 14
     union all
     select o.name, o.id, p.name, null, '/projects/' || p.id, 'Project update'
       from projects p left join users o on o.id = p.owner_id
       where p.status = 'active' and coalesce((select max(created_at) from project_updates pu where pu.project_id = p.id), p.created_at) < now() - interval '7 days'
     order by due nulls last`, [today()]);
}

export async function escalations() {
  return q<{ kind: string; id: string; title: string; detail: string | null; href: string }>(
    `select 'risk' as kind, id, title, mitigation as detail, '/risks?focus=' || id as href from risks where status = 'escalated'
     union all
     select 'blocked', t.id, t.title, coalesce(t.blocker, 'Blocked') || coalesce(' · ' || u.name, ''), '/tasks/' || t.id from tasks t left join users u on u.id = t.owner_id where t.status = 'blocked'
     union all
     select 'decision', id, title, 'Needed by ' || to_char(due_date, 'DD Mon'), '/decisions?focus=' || id from decisions where status in ('pending','proposed') and due_date <= $1::date + 3`, [today()]);
}
