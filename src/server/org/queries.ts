import "server-only";
import { cache } from "react";
import { q } from "../db";
import { canManage, type User } from "../auth";

export type OrgLevel = "manager" | "program_manager" | "dept_manager" | "lead" | "member";
export const ORG_LEVELS: { key: OrgLevel; label: string }[] = [
  { key: "manager", label: "Manager" }, { key: "program_manager", label: "Program Manager" }, { key: "dept_manager", label: "Department Manager" },
  { key: "lead", label: "Lead" }, { key: "member", label: "Member" },
];
export interface OrgPerson { id: string; name: string; title: string | null; role: string; org_level: OrgLevel; org_function: string | null; reports_to: string | null; team_name: string | null; avatar_color: string | null }

export const orgPeople = cache(() => q<OrgPerson>(
  `select u.id, u.name, u.title, u.role, u.org_level, coalesce(u.org_function, t.name) as org_function, u.reports_to, t.name as team_name, u.avatar_color
   from users u left join teams t on t.id = u.team_id where u.active order by u.name`));

/** Everyone below a person in the org chart (any depth). */
export async function reportsOf(userId: string): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `with recursive down(id, depth) as (select id, 1 from users where reports_to = $1 and active
       union all select u.id, d.depth + 1 from users u join down d on u.reports_to = d.id where u.active and d.depth < 12)
     select distinct id from down`, [userId]);
  return rows.map((r) => r.id);
}

/** Whose tasks a user may see: null = everyone (admin / program manager), else self + everyone reporting to them. */
export const taskScope = cache(async (u: Pick<User, "id" | "role">): Promise<string[] | null> => (canManage(u) ? null : [u.id, ...(await reportsOf(u.id))]));

/** SQL condition for task visibility (alias t). `$ids` uuid[] param, `$me` uuid param. */
export const visibleSql = (ids: string, me: string) =>
  `(t.owner_id = any(${ids}::uuid[]) or t.created_by = ${me} or t.requester_id = ${me} or t.waiting_on_id = ${me}
    or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = any(${ids}::uuid[]))
    or exists (select 1 from task_blockers tb where tb.task_id = t.id and tb.on_user_id = ${me} and tb.status = 'open'))`;

/** Can this user open this task? */
export async function canSeeTask(u: Pick<User, "id" | "role">, taskId: string) {
  const ids = await taskScope(u);
  if (!ids) return true;
  const r = await q<{ ok: boolean }>(`select true as ok from tasks t where t.id = $1 and ${visibleSql("$2", "$3::uuid")}`, [taskId, ids, u.id]);
  return !!r.length;
}
