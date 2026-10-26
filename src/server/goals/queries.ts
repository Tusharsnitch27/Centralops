import "server-only";
import { q } from "../db";
import { canManage, type User } from "../auth";
import { reportsOf } from "../org/queries";

type Viewer = Pick<User, "id" | "role"> | null;
/**
 * Who sees a goal / project (alias a): admins and PMs everything; everyone else the "overall program" ones, their own (owner or creator),
 * their reports', and their team's or function's. $1 = viewer id, $2 = viewer's reports.
 */
const seeSql = (a: string) => `(${a}.scope = 'overall' or ${a}.owner_id = $1 or ${a}.created_by = $1 or ${a}.owner_id = any($2::uuid[])
  or exists (select 1 from users ou join users me on me.id = $1 where ou.id = ${a}.owner_id
             and ((ou.team_id is not null and ou.team_id = me.team_id) or (ou.org_function is not null and ou.org_function = me.org_function))))`;
async function scope(v: Viewer, a: string): Promise<{ where: string; params: unknown[] }> {
  if (!v || canManage(v)) return { where: "true", params: [] };
  return { where: seeSql(a), params: [v.id, await reportsOf(v.id)] };
}

export type GoalStatus = "on_track" | "at_risk" | "off_track" | "done" | "dropped";
export interface GoalRow {
  id: string; title: string; description: string | null; owner_id: string | null; owner_name: string | null; target_date: string | null; status: GoalStatus; scope: "private" | "overall";
  projects: number; tasks_total: number; tasks_done: number; tasks_overdue: number;
}
export interface GoalProject { id: string; name: string; status: string; health: string; scope: "private" | "overall"; owner_id: string | null; owner_name: string | null; target_date: string | null; goal_id: string | null; tasks_total: number; tasks_done: number }
export interface GoalTask { id: string; number: number; title: string; status: string; due_date: string | null; owner_name: string | null; goal_id: string | null; project_id: string | null }

/** Goals with roll-ups: tasks linked directly or through one of the goal's projects. */
export async function listGoals(v: Viewer = null) {
  const sc = await scope(v, "g");
  return q<GoalRow>(
    `with gt as (select g.id as goal_id, t.status, t.due_date from goals g join tasks t on t.goal_id = g.id or t.project_id in (select id from projects where goal_id = g.id))
     select g.id, g.title, g.description, g.owner_id, u.name as owner_name, g.target_date::text as target_date, g.status, g.scope,
       (select count(*)::int from projects p where p.goal_id = g.id) as projects,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status <> 'cancelled') as tasks_total,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status = 'completed') as tasks_done,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status not in ('completed','cancelled') and gt.due_date < current_date) as tasks_overdue
     from goals g left join users u on u.id = g.owner_id
     where ${sc.where}
     order by (g.status in ('done','dropped')), g.target_date nulls last, g.created_at desc`, sc.params);
}
export async function goalProjects(v: Viewer = null) {
  const sc = await scope(v, "p");
  return q<GoalProject>(
    `select p.id, p.name, p.status, p.health, p.scope, p.owner_id, u.name as owner_name, p.target_date::text as target_date, p.goal_id,
       (select count(*)::int from tasks t where t.project_id = p.id and t.status <> 'cancelled') as tasks_total,
       (select count(*)::int from tasks t where t.project_id = p.id and t.status = 'completed') as tasks_done
     from projects p left join users u on u.id = p.owner_id where p.status not in ('cancelled') and ${sc.where} order by p.name`, sc.params);
}
export function goalTasks() {
  return q<GoalTask>(
    `select t.id, t.number, t.title, t.status, t.due_date::text as due_date, u.name as owner_name, t.goal_id, t.project_id
     from tasks t left join users u on u.id = t.owner_id
     where (t.goal_id is not null or t.project_id in (select id from projects where goal_id is not null)) and t.status <> 'cancelled'
     order by (t.status = 'completed'), t.due_date nulls last`);
}
/** Light lists for pickers. */
export const goalOptions = async (v: Viewer = null) => { const sc = await scope(v, "g"); return q<{ id: string; title: string }>(`select g.id, g.title from goals g where g.status not in ('done','dropped') and ${sc.where} order by g.title`, sc.params); };
export const projectOptions = async (v: Viewer = null) => { const sc = await scope(v, "p"); return q<{ id: string; name: string; goal_id: string | null }>(`select p.id, p.name, p.goal_id from projects p where p.status in ('planned','active','on_hold') and ${sc.where} order by p.name`, sc.params); };
