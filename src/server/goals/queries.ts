import "server-only";
import { q } from "../db";

export type GoalStatus = "on_track" | "at_risk" | "off_track" | "done" | "dropped";
export interface GoalRow {
  id: string; title: string; description: string | null; owner_id: string | null; owner_name: string | null; target_date: string | null; status: GoalStatus;
  projects: number; tasks_total: number; tasks_done: number; tasks_overdue: number;
}
export interface GoalProject { id: string; name: string; status: string; health: string; owner_name: string | null; target_date: string | null; goal_id: string | null; tasks_total: number; tasks_done: number }
export interface GoalTask { id: string; number: number; title: string; status: string; due_date: string | null; owner_name: string | null; goal_id: string | null; project_id: string | null }

/** Goals with roll-ups: tasks linked directly or through one of the goal's projects. */
export function listGoals() {
  return q<GoalRow>(
    `with gt as (select g.id as goal_id, t.status, t.due_date from goals g join tasks t on t.goal_id = g.id or t.project_id in (select id from projects where goal_id = g.id))
     select g.id, g.title, g.description, g.owner_id, u.name as owner_name, g.target_date::text as target_date, g.status,
       (select count(*)::int from projects p where p.goal_id = g.id) as projects,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status <> 'cancelled') as tasks_total,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status = 'completed') as tasks_done,
       (select count(*)::int from gt where gt.goal_id = g.id and gt.status not in ('completed','cancelled') and gt.due_date < current_date) as tasks_overdue
     from goals g left join users u on u.id = g.owner_id
     order by (g.status in ('done','dropped')), g.target_date nulls last, g.created_at desc`);
}
export function goalProjects() {
  return q<GoalProject>(
    `select p.id, p.name, p.status, p.health, u.name as owner_name, p.target_date::text as target_date, p.goal_id,
       (select count(*)::int from tasks t where t.project_id = p.id and t.status <> 'cancelled') as tasks_total,
       (select count(*)::int from tasks t where t.project_id = p.id and t.status = 'completed') as tasks_done
     from projects p left join users u on u.id = p.owner_id where p.status not in ('cancelled') order by p.name`);
}
export function goalTasks() {
  return q<GoalTask>(
    `select t.id, t.number, t.title, t.status, t.due_date::text as due_date, u.name as owner_name, t.goal_id, t.project_id
     from tasks t left join users u on u.id = t.owner_id
     where (t.goal_id is not null or t.project_id in (select id from projects where goal_id is not null)) and t.status <> 'cancelled'
     order by (t.status = 'completed'), t.due_date nulls last`);
}
/** Light lists for pickers. */
export const goalOptions = () => q<{ id: string; title: string }>(`select id, title from goals where status not in ('done','dropped') order by title`);
export const projectOptions = () => q<{ id: string; name: string; goal_id: string | null }>(`select id, name, goal_id from projects where status in ('planned','active','on_hold') order by name`);
