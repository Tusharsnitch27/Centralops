import "server-only";
import { q } from "../db";
import { today } from "@/lib/dates";
import type { Health, Priority, TaskStatus } from "@/lib/meta";

export interface TaskListItem {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  health: Health;
  priority: Priority;
  due_date: string | null;
  original_due_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  owner_team_id: string | null;
  owner_team_name: string | null;
  requester_id: string | null;
  requester_name: string | null;
  waiting_on_id: string | null;
  waiting_on_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  source: string;
  blocker: string | null;
  next_step: string | null;
  poc_name: string | null;
  last_update_at: string | null;
  last_update_note: string | null;
  created_at: string;
  completed_at: string | null;
  days_since_update: number;
  open_followups: number;
  tags: string[];
}

export interface TaskFilter {
  ownerId?: string;
  requesterId?: string;          // tasks I created/requested
  delegatedBy?: string;          // requested by X but owned by someone else
  involving?: string;            // owner OR requester OR waiting-on
  waitingOnOthersFor?: string;   // waiting status / waiting_on someone else, for this user
  projectId?: string;
  programId?: string;
  meetingId?: string;
  teamId?: string;
  open?: boolean;                // only not completed/cancelled
  completedSince?: string;       // completed on/after date
  overdue?: boolean;
  dueOn?: string;
  dueFrom?: string;
  dueTo?: string;
  staleDays?: number;            // no update for N+ days
  priority?: Priority[];
  status?: TaskStatus[];
  tag?: string;
  search?: string;
  ids?: string[];
  limit?: number;
  order?: "due" | "updated" | "priority" | "created";
}

/** The canonical task list query. All modules use this so rows look the same everywhere. */
export async function listTasks(f: TaskFilter = {}): Promise<TaskListItem[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v?: unknown) => { if (v !== undefined) p.push(v); where.push(sql.replace(/\$\?/g, `$${p.length}`)); };
  if (f.ownerId) add(`t.owner_id = $?`, f.ownerId);
  if (f.requesterId) add(`(t.requester_id = $? or t.created_by = $?)`, f.requesterId);
  if (f.delegatedBy) add(`(t.requester_id = $? or t.created_by = $?) and t.owner_id is distinct from t.requester_id and coalesce(t.owner_id::text, '') <> $?::text`, f.delegatedBy);
  if (f.involving) add(`(t.owner_id = $? or t.requester_id = $? or t.waiting_on_id = $? or t.created_by = $?)`, f.involving);
  if (f.waitingOnOthersFor) add(`((t.owner_id = $? and (t.status = 'waiting' or t.waiting_on_id is not null)))`, f.waitingOnOthersFor);
  if (f.projectId) add(`t.project_id = $?`, f.projectId);
  if (f.programId) add(`t.program_id = $?`, f.programId);
  if (f.meetingId) add(`t.meeting_id = $?`, f.meetingId);
  if (f.teamId) add(`(t.owner_team_id = $? or ou.team_id = $?)`, f.teamId);
  if (f.open) add(`t.status not in ('completed','cancelled')`);
  if (f.completedSince) add(`t.status = 'completed' and t.completed_at >= $?::date`, f.completedSince);
  if (f.overdue) add(`t.status not in ('completed','cancelled') and t.due_date < $?::date`, today());
  if (f.dueOn) add(`t.due_date = $?::date`, f.dueOn);
  if (f.dueFrom) add(`t.due_date >= $?::date`, f.dueFrom);
  if (f.dueTo) add(`t.due_date <= $?::date`, f.dueTo);
  if (f.staleDays != null) add(`coalesce(t.last_update_at, t.created_at) < now() - make_interval(days => $?::int)`, f.staleDays);
  if (f.priority?.length) add(`t.priority = any($?::text[])`, f.priority);
  if (f.status?.length) add(`t.status = any($?::text[])`, f.status);
  if (f.tag) add(`exists (select 1 from task_tags g where g.task_id = t.id and g.tag = $?)`, f.tag.toLowerCase());
  if (f.search) add(`(t.title ilike $? or t.description ilike $?)`, `%${f.search}%`);
  if (f.ids) add(`t.id = any($?::uuid[])`, f.ids);
  const order = {
    due: `(t.status in ('completed','cancelled')), t.due_date asc nulls last, array_position(array['urgent','high','medium','low'], t.priority)`,
    updated: `coalesce(t.last_update_at, t.updated_at) desc`,
    priority: `array_position(array['urgent','high','medium','low'], t.priority), t.due_date asc nulls last`,
    created: `t.created_at desc`,
  }[f.order ?? "due"];
  p.push(f.limit ?? 500);
  return q<TaskListItem>(
    `select t.id, t.number, t.title, t.status, t.health, t.priority, t.due_date, t.original_due_date,
            t.owner_id, ou.name as owner_name, ou.avatar_color as owner_color, t.owner_team_id, tm.name as owner_team_name,
            t.requester_id, ru.name as requester_name, t.waiting_on_id, wu.name as waiting_on_name,
            t.project_id, pr.name as project_name, pr.code as project_code, t.meeting_id, m.title as meeting_title,
            t.source, t.blocker, t.next_step, t.poc_name, t.last_update_at, t.last_update_note, t.created_at, t.completed_at,
            extract(day from now() - coalesce(t.last_update_at, t.created_at))::int as days_since_update,
            (select count(*)::int from followups f where f.entity_type = 'task' and f.entity_id = t.id and f.status = 'open') as open_followups,
            coalesce((select array_agg(g.tag order by g.tag) from task_tags g where g.task_id = t.id), '{}') as tags
     from tasks t
     left join users ou on ou.id = t.owner_id
     left join teams tm on tm.id = t.owner_team_id
     left join users ru on ru.id = t.requester_id
     left join users wu on wu.id = t.waiting_on_id
     left join projects pr on pr.id = t.project_id
     left join meetings m on m.id = t.meeting_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${order}
     limit $${p.length}`,
    p,
  );
}
