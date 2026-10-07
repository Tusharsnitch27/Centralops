import "server-only";
import { q } from "../db";
import type { DecisionStatus } from "./meta";
export { DECISION_STATUS, type DecisionStatus } from "./meta";

export interface DecisionItem {
  id: string;
  title: string;
  context: string | null;
  reason: string | null;
  impact: string | null;
  status: DecisionStatus;
  decided_on: string | null;
  due_date: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  meeting_at: string | null;
  decision_maker_id: string | null;
  maker_name: string | null;
  maker_color: string | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  program_id: string | null;
  created_at: string;
  tasks: { id: string; number: number; title: string; status: string; owner_name: string | null; due_date: string | null }[];
}

export interface DecisionFilter {
  projectId?: string;
  programId?: string;
  meetingId?: string;
  makerId?: string;
  status?: string; // 'pending' covers proposed + pending
  search?: string;
  ids?: string[];
  meetingIds?: string[];
  limit?: number;
}

export async function listDecisions(f: DecisionFilter = {}): Promise<DecisionItem[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace(/\$\?/g, `$${p.length}`)); };
  if (f.projectId) add(`d.project_id = $?`, f.projectId);
  if (f.programId) add(`(d.program_id = $? or pr.program_id = $?)`, f.programId);
  if (f.meetingId) add(`d.meeting_id = $?`, f.meetingId);
  if (f.meetingIds) add(`d.meeting_id = any($?::uuid[])`, f.meetingIds);
  if (f.makerId) add(`d.decision_maker_id = $?`, f.makerId);
  if (f.ids) add(`d.id = any($?::uuid[])`, f.ids);
  if (f.status === "pending") where.push(`d.status in ('pending','proposed')`);
  else if (f.status) add(`d.status = $?`, f.status);
  if (f.search) add(`(d.title ilike $? or d.context ilike $? or d.reason ilike $? or d.impact ilike $?)`, `%${f.search}%`);
  p.push(f.limit ?? 300);
  return q<DecisionItem>(
    `select d.id, d.title, d.context, d.reason, d.impact, d.status, d.decided_on, d.due_date, d.meeting_id, m.title as meeting_title, m.starts_at as meeting_at,
            d.decision_maker_id, u.name as maker_name, u.avatar_color as maker_color, d.project_id, pr.name as project_name, pr.code as project_code,
            coalesce(d.program_id, pr.program_id) as program_id, d.created_at,
            coalesce((select json_agg(json_build_object('id', t.id, 'number', t.number, 'title', t.title, 'status', t.status, 'owner_name', tu.name, 'due_date', t.due_date) order by t.number)
                      from decision_tasks dt join tasks t on t.id = dt.task_id left join users tu on tu.id = t.owner_id where dt.decision_id = d.id), '[]'::json) as tasks
     from decisions d
     left join meetings m on m.id = d.meeting_id
     left join users u on u.id = d.decision_maker_id
     left join projects pr on pr.id = d.project_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by (d.status in ('pending','proposed')) desc,
              case when d.status in ('pending','proposed') then d.due_date end asc nulls last,
              coalesce(d.decided_on, d.created_at::date) desc, d.created_at desc
     limit $${p.length}`,
    p,
  );
}

export async function decisionFilterOptions() {
  const [meetings, makers] = await Promise.all([
    q<{ id: string; title: string; starts_at: string }>(
      `select distinct m.id, m.title, m.starts_at from decisions d join meetings m on m.id = d.meeting_id order by m.starts_at desc limit 60`),
    q<{ id: string; name: string }>(`select distinct u.id, u.name from decisions d join users u on u.id = d.decision_maker_id order by u.name`),
  ]);
  return { meetings, makers };
}

/** Meetings to pick from in the decision form (recent + upcoming). */
export async function meetingOptions() {
  return q<{ id: string; title: string; starts_at: string }>(
    `select id, title, starts_at from meetings where not cancelled and starts_at > now() - interval '60 days' order by starts_at desc limit 80`);
}

/** Open tasks to link to a decision. */
export async function taskOptions() {
  return q<{ id: string; number: number; title: string; project_id: string | null }>(
    `select id, number, title, project_id from tasks where status not in ('cancelled') order by (status = 'completed'), created_at desc limit 300`);
}
