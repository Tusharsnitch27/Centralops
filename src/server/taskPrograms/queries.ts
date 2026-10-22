import "server-only";
import { q } from "../db";

export interface ProgramRow {
  id: string; title: string; details: string | null; due_date: string; status: "open" | "closed"; created_by_name: string | null; created_at: string;
  last_reminded_at: string | null; goal_title: string | null; project_name: string | null;
  people: { task_id: string; number: number; user_id: string | null; name: string | null; color: string | null; status: string; due_date: string | null; last_update_at: string | null; completed_at: string | null }[];
}

/** Programs with each person's own task, newest first. */
export function listPrograms() {
  return q<ProgramRow>(
    `select p.id, p.title, p.details, p.due_date::text, p.status, cu.name as created_by_name, p.created_at::text, p.last_reminded_at::text,
            g.title as goal_title, pr.name as project_name,
            coalesce((select json_agg(json_build_object('task_id', t.id, 'number', t.number, 'user_id', t.owner_id, 'name', u.name, 'color', u.avatar_color,
                       'status', t.status, 'due_date', t.due_date, 'last_update_at', t.last_update_at, 'completed_at', t.completed_at) order by (t.status = 'completed'), u.name)
                      from tasks t left join users u on u.id = t.owner_id where t.task_program_id = p.id and t.status <> 'cancelled'), '[]'::json) as people
     from task_programs p left join users cu on cu.id = p.created_by left join goals g on g.id = p.goal_id left join projects pr on pr.id = p.project_id
     order by (p.status = 'closed'), p.due_date, p.created_at desc`);
}
