import "server-only";
import { one, q } from "../db";
import { today } from "@/lib/dates";

const OPEN = `t.status in ('not_started','in_progress','waiting','blocked')`;

/** Operational ownership per person — what they carry, not a performance score. */
export interface PersonRow {
  id: string; name: string; title: string | null; email: string | null; role: string; avatar_color: string | null; active: boolean;
  team_id: string | null; team_name: string | null; team_color: string | null;
  active_tasks: number; overdue: number; due_week: number; blocked: number;
  projects: number; aop_lines: number; aop_sections: number; sop_streams: number;
  followups_requested: number; followups_responded: number; followups_open: number;
  next_due: string | null; last_update_at: string | null;
}

const PERSON_SQL = `
  select u.id, u.name, u.title, u.email, u.role, u.avatar_color, u.active, u.team_id, tm.name as team_name, tm.color as team_color,
    (select count(*)::int from tasks t where t.owner_id = u.id and ${OPEN}) as active_tasks,
    (select count(*)::int from tasks t where t.owner_id = u.id and ${OPEN} and t.due_date < $1::date) as overdue,
    (select count(*)::int from tasks t where t.owner_id = u.id and ${OPEN} and t.due_date between $1::date and $1::date + 7) as due_week,
    (select count(*)::int from tasks t where t.owner_id = u.id and t.status = 'blocked') as blocked,
    (select count(distinct p.id)::int from projects p where p.status not in ('completed','cancelled')
       and (p.owner_id = u.id or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = u.id))) as projects,
    (select count(*)::int from aop_items i join aop_cycles c on c.id = i.cycle_id where c.status = 'active' and i.active and i.owner_id = u.id) as aop_lines,
    (select count(*)::int from aop_sections s join aop_cycles c on c.id = s.cycle_id where c.status = 'active' and s.parent_id is null and s.owner_id = u.id) as aop_sections,
    (select count(*)::int from sop_streams s where s.active and s.poc_id = u.id) as sop_streams,
    (select count(*)::int from followups f where f.person_id = u.id and f.status <> 'cancelled') as followups_requested,
    (select count(*)::int from followups f where f.person_id = u.id and (f.status = 'responded' or f.responded_at is not null)) as followups_responded,
    (select count(*)::int from followups f where f.person_id = u.id and f.status = 'open') as followups_open,
    (select min(t.due_date) from tasks t where t.owner_id = u.id and ${OPEN} and t.due_date >= $1::date) as next_due,
    greatest((select max(x.created_at) from task_updates x where x.author_id = u.id), (select max(x.created_at) from project_updates x where x.author_id = u.id)) as last_update_at
  from users u left join teams tm on tm.id = u.team_id`;

export async function listPeopleOverview(includeInactive = false) {
  return q<PersonRow>(`${PERSON_SQL} ${includeInactive ? "" : "where u.active"} order by tm.name nulls last, u.name`, [today()]);
}

export async function getPersonRow(id: string) {
  return one<PersonRow & { joined_at: string; phone: string | null; username: string | null }>(
    `select x.*, u.joined_at, u.phone, u.username from (${PERSON_SQL} where u.id = $2) x join users u on u.id = x.id`, [today(), id]);
}

export interface OwnedProject { id: string; name: string; code: string | null; health: string; status: string; target_date: string | null; role: string; program_name: string | null }
export interface OwnedAopLine { id: string; name: string; section: string; function_name: string; kind: "section" | "item"; ytd_plan: number; ytd_actual: number; pending_inputs: number }
export interface OwnedStream { id: string; name: string; area: string; next_period: string | null; next_due: string | null; next_status: string | null; late: number }
export interface Deadline { kind: "task" | "milestone" | "aop" | "sop" | "decision"; title: string; date: string; href: string }
export interface UpdateItem { kind: "task" | "project"; title: string; body: string; at: string; href: string }
export interface ActivityItem { id: string; action: string; entity_type: string; entity_id: string | null; summary: string | null; field: string | null; from_value: string | null; to_value: string | null; created_at: string }

export async function personDetail(id: string) {
  const t = today();
  const lastClosed = `${t.slice(0, 7)}-01`;
  const [projects, programs, aopSections, aopItems, streams, deadlines, updates, activity, followups] = await Promise.all([
    q<OwnedProject>(
      `select p.id, p.name, p.code, p.health, p.status, p.target_date, pg.name as program_name,
              case when p.owner_id = $1 then 'Owner' when p.sponsor_id = $1 then 'Sponsor' else coalesce(pm.role, 'Member') end as role
       from projects p left join programs pg on pg.id = p.program_id left join project_members pm on pm.project_id = p.id and pm.user_id = $1
       where p.status not in ('completed','cancelled') and (p.owner_id = $1 or p.sponsor_id = $1 or pm.user_id is not null)
       order by case when p.owner_id = $1 then 0 else 1 end, p.name`, [id]),
    q<{ id: string; name: string; code: string | null; health: string; role: string }>(
      `select id, name, code, health, case when owner_id = $1 then 'Owner' else 'Sponsor' end as role from programs where status <> 'cancelled' and (owner_id = $1 or sponsor_id = $1) order by name`, [id]),
    q<OwnedAopLine>(
      `with recursive tree as (select s.id, s.id as root from aop_sections s join aop_cycles c on c.id = s.cycle_id where c.status = 'active' and s.owner_id = $1 and s.parent_id is null
         union all select s.id, t.root from aop_sections s join tree t on s.parent_id = t.id)
       select f.id, f.name, f.name as section, f.name as function_name, 'section' as kind,
              coalesce(sum(v.plan) filter (where v.period < $2::date and v.actual is not null), 0) as ytd_plan,
              coalesce(sum(v.actual) filter (where v.period < $2::date), 0) as ytd_actual,
              (select count(*)::int from aop_submissions x where x.section_id = f.id and x.status in ('pending','returned') and x.due_date <= $3::date) as pending_inputs
       from aop_sections f join tree on tree.root = f.id left join aop_items i on i.section_id = tree.id and i.active left join aop_period_values v on v.item_id = i.id
       group by f.id, f.name, f.sort order by f.sort`, [id, lastClosed, t]),
    q<OwnedAopLine>(
      `select i.id, i.name, g.name as section, coalesce(f.name, g.name) as function_name, 'item' as kind,
              coalesce(sum(v.plan) filter (where v.period < $2::date and v.actual is not null), 0) as ytd_plan,
              coalesce(sum(v.actual) filter (where v.period < $2::date), 0) as ytd_actual, 0 as pending_inputs
       from aop_items i join aop_cycles c on c.id = i.cycle_id join aop_sections g on g.id = i.section_id left join aop_sections f on f.id = g.parent_id
       left join aop_period_values v on v.item_id = i.id
       where c.status = 'active' and i.active and i.owner_id = $1
       group by i.id, i.name, g.name, f.name, f.sort, g.sort, i.sort order by f.sort, g.sort, i.sort limit 200`, [id, lastClosed]),
    q<OwnedStream>(
      `select s.id, s.name, s.area,
              (select to_char(x.period, 'YYYY-MM-DD') from sop_submissions x where x.stream_id = s.id and x.status in ('pending','late') order by x.period limit 1) as next_period,
              (select x.due_date from sop_submissions x where x.stream_id = s.id and x.status in ('pending','late') order by x.period limit 1) as next_due,
              (select x.status from sop_submissions x where x.stream_id = s.id and x.status in ('pending','late') order by x.period limit 1) as next_status,
              (select count(*)::int from sop_submissions x where x.stream_id = s.id and (x.status = 'late' or (x.status = 'pending' and x.due_date < $2::date))) as late
       from sop_streams s where s.active and s.poc_id = $1 order by s.sort`, [id, t]),
    q<Deadline>(
      `select * from (
         select 'task' as kind, t.title, t.due_date::text as date, '/tasks/' || t.id as href from tasks t where t.owner_id = $1 and ${OPEN} and t.due_date >= $2::date
         union all
         select 'milestone', p.code || ' · ' || m.title, m.due_date::text, '/projects/' || p.id from milestones m join projects p on p.id = m.project_id
           where p.owner_id = $1 and m.status <> 'done' and m.due_date >= $2::date
         union all
         select 'aop', 'AOP ' || x.kind || ' · ' || f.name || ' · ' || to_char(x.period, 'Mon'), x.due_date::text, '/aop' from aop_submissions x join aop_sections f on f.id = x.section_id
           where x.owner_id = $1 and x.status in ('pending','returned') and x.due_date >= $2::date
         union all
         select 'sop', 'S&OP projection · ' || s.name || ' · ' || to_char(x.period, 'Mon'), x.due_date::text, '/sop' from sop_submissions x join sop_streams s on s.id = x.stream_id
           where s.poc_id = $1 and x.status = 'pending' and x.due_date >= $2::date
         union all
         select 'decision', d.title, d.due_date::text, '/decisions' from decisions d where d.decision_maker_id = $1 and d.status in ('pending','proposed') and d.due_date >= $2::date
       ) x where x.date <= ($2::date + 21)::text order by x.date limit 12`, [id, t]),
    q<UpdateItem>(
      `select * from (
         select 'task' as kind, t.title, x.body, x.created_at as at, '/tasks/' || t.id as href from task_updates x join tasks t on t.id = x.task_id where x.author_id = $1
         union all
         select 'project', p.name, coalesce(x.what_changed, x.progress, ''), x.created_at, '/projects/' || p.id from project_updates x join projects p on p.id = x.project_id where x.author_id = $1
       ) u order by at desc limit 8`, [id]),
    q<ActivityItem>(`select id, action, entity_type, entity_id, summary, field, from_value, to_value, created_at from activity_log where actor_id = $1 order by created_at desc limit 12`, [id]),
    q<{ id: string; entity_id: string; title: string | null; message: string | null; status: string; created_at: string; responded_at: string | null }>(
      `select f.id, f.entity_id, t.title, f.message, f.status, f.created_at, f.responded_at from followups f left join tasks t on f.entity_type = 'task' and t.id = f.entity_id
       where f.person_id = $1 order by f.created_at desc limit 6`, [id]),
  ]);
  return { projects, programs, aop: [...aopSections, ...aopItems], streams, deadlines, updates, activity, followups };
}

/* ---------------- teams ---------------- */
export interface TeamRow {
  id: string; name: string; function: string | null; color: string | null; lead_id: string | null; lead_name: string | null; lead_color: string | null;
  members: { id: string; name: string; color: string | null }[];
  open_tasks: number; team_owned: number; overdue: number; blocked: number; projects: number;
}
export async function listTeamsOverview() {
  return q<TeamRow>(
    `select tm.id, tm.name, tm.function, tm.color, tm.lead_id, l.name as lead_name, l.avatar_color as lead_color,
       coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name, 'color', u.avatar_color) order by u.name)
                 from users u where u.active and (u.team_id = tm.id or exists (select 1 from team_members m where m.team_id = tm.id and m.user_id = u.id))), '[]') as members,
       (select count(*)::int from tasks t left join users ou on ou.id = t.owner_id where ${OPEN} and (t.owner_team_id = tm.id or ou.team_id = tm.id)) as open_tasks,
       (select count(*)::int from tasks t where ${OPEN} and t.owner_team_id = tm.id) as team_owned,
       (select count(*)::int from tasks t left join users ou on ou.id = t.owner_id where ${OPEN} and (t.owner_team_id = tm.id or ou.team_id = tm.id) and t.due_date < $1::date) as overdue,
       (select count(*)::int from tasks t left join users ou on ou.id = t.owner_id where t.status = 'blocked' and (t.owner_team_id = tm.id or ou.team_id = tm.id)) as blocked,
       (select count(*)::int from project_teams pt join projects p on p.id = pt.project_id where pt.team_id = tm.id and p.status not in ('completed','cancelled')) as projects
     from teams tm left join users l on l.id = tm.lead_id order by tm.name`, [today()]);
}
