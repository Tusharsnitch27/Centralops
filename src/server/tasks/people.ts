import "server-only";
import { q } from "../db";

export interface TaskAssignee { user_id: string; name: string; avatar_color: string | null; added_at: string }
export interface TaskBlocker { id: string; body: string; on_user_id: string | null; on_name: string | null; status: "open" | "cleared"; raised_by_name: string | null; cleared_by_name: string | null; created_at: string; cleared_at: string | null }

export async function taskPeople(taskId: string) {
  const [assignees, blockers] = await Promise.all([
    q<TaskAssignee>(`select a.user_id, u.name, u.avatar_color, a.added_at::text as added_at from task_assignees a join users u on u.id = a.user_id where a.task_id = $1 order by a.added_at`, [taskId]),
    q<TaskBlocker>(
      `select b.id, b.body, b.on_user_id, coalesce(u.name, b.on_label) as on_name, b.status, r.name as raised_by_name, c.name as cleared_by_name, b.created_at::text as created_at, b.cleared_at::text as cleared_at
       from task_blockers b left join users u on u.id = b.on_user_id left join users r on r.id = b.raised_by left join users c on c.id = b.cleared_by
       where b.task_id = $1 order by (b.status = 'open') desc, b.created_at desc`, [taskId]),
  ]);
  return { assignees, blockers };
}

/** Open blockers waiting on this person, newest first. */
export const blockersOnMe = (userId: string) => q<{ id: string; body: string; task_id: string; task_title: string; task_number: number; raised_by_name: string | null; created_at: string; due_date: string | null }>(
  `select b.id, b.body, b.task_id, t.title as task_title, t.number as task_number, r.name as raised_by_name, b.created_at::text as created_at, t.due_date::text as due_date
   from task_blockers b join tasks t on t.id = b.task_id left join users r on r.id = b.raised_by
   where b.on_user_id = $1 and b.status = 'open' and t.status not in ('completed','cancelled') order by b.created_at desc`, [userId]);
