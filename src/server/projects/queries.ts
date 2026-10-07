import "server-only";
import { q, one } from "../db";
import { today } from "@/lib/dates";
import type { Health } from "@/lib/meta";
import { computeProgress, milestoneSlip, type MilestoneStatus, type ProjectStatus } from "./metrics";

export interface ProjectListItem {
  id: string;
  name: string;
  code: string | null;
  objective: string | null;
  description: string | null;
  status: ProjectStatus;
  health: Health;
  start_date: string | null;
  target_date: string | null;
  budget: number | null;
  spent: number | null;
  program_id: string | null;
  program_name: string | null;
  program_code: string | null;
  program_color: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  sponsor_id: string | null;
  sponsor_name: string | null;
  sponsor_color: string | null;
  ms_total: number;
  ms_done: number;
  ms_active: number;
  ms_slipped: number;
  tasks_total: number;
  tasks_done: number;
  tasks_active: number;
  open_tasks: number;
  overdue_tasks: number;
  open_risks: number;
  top_risk_score: number | null;
  top_risk_title: string | null;
  next_ms_id: string | null;
  next_ms_title: string | null;
  next_ms_due: string | null;
  next_ms_slip: number | null;
  last_update_at: string | null;
  last_update_pct: number | null;
  expected_completion: string | null;
  pending_decisions: number;
  teams: { id: string; name: string }[];
  progress: number; // 0..1, computed
}

export interface ProjectFilter {
  ids?: string[];
  programId?: string;
  ownerId?: string;
  health?: Health;
  status?: ProjectStatus;
  includeClosed?: boolean;
}

const BASE = /* sql */ `
select p.id, p.name, p.code, p.objective, p.description, p.status, p.health, p.start_date, p.target_date, p.budget, p.spent,
       p.program_id, pg.name as program_name, pg.code as program_code, pg.color as program_color,
       p.owner_id, ou.name as owner_name, ou.avatar_color as owner_color,
       p.sponsor_id, su.name as sponsor_name, su.avatar_color as sponsor_color,
       coalesce(ms.total, 0) as ms_total, coalesce(ms.done, 0) as ms_done, coalesce(ms.active, 0) as ms_active, coalesce(ms.slipped, 0) as ms_slipped,
       coalesce(tk.total, 0) as tasks_total, coalesce(tk.done, 0) as tasks_done, coalesce(tk.active, 0) as tasks_active,
       coalesce(tk.open, 0) as open_tasks, coalesce(tk.overdue, 0) as overdue_tasks,
       coalesce(rk.open, 0) as open_risks, rk.top_score as top_risk_score, rk.top_title as top_risk_title,
       nm.id as next_ms_id, nm.title as next_ms_title, nm.due_date as next_ms_due, nm.slip as next_ms_slip,
       lu.created_at as last_update_at, lu.percent_complete as last_update_pct, lu.expected_completion,
       coalesce(dc.pending, 0) as pending_decisions,
       coalesce(tm.teams, '[]'::json) as teams
from projects p
left join programs pg on pg.id = p.program_id
left join users ou on ou.id = p.owner_id
left join users su on su.id = p.sponsor_id
left join lateral (
  select count(*)::int as total, count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'in_progress')::int as active,
         count(*) filter (where status <> 'done' and ((baseline_date is not null and due_date > baseline_date) or due_date < $1::date))::int as slipped
  from milestones where project_id = p.id) ms on true
left join lateral (
  select count(*) filter (where status <> 'cancelled')::int as total, count(*) filter (where status = 'completed')::int as done,
         count(*) filter (where status in ('in_progress','waiting','blocked'))::int as active,
         count(*) filter (where status not in ('completed','cancelled'))::int as open,
         count(*) filter (where status not in ('completed','cancelled') and due_date < $1::date)::int as overdue
  from tasks where project_id = p.id) tk on true
left join lateral (
  select count(*)::int as open, max(score) as top_score, (array_agg(title order by score desc, created_at))[1] as top_title
  from risks where project_id = p.id and status <> 'closed') rk on true
left join lateral (
  select id, title, due_date, greatest(0, due_date - baseline_date) as slip from milestones
  where project_id = p.id and status <> 'done' order by due_date asc nulls last, sort limit 1) nm on true
left join lateral (
  select created_at, percent_complete, expected_completion from project_updates where project_id = p.id order by created_at desc limit 1) lu on true
left join lateral (select count(*)::int as pending from decisions where project_id = p.id and status in ('pending','proposed')) dc on true
left join lateral (
  select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name) as teams
  from project_teams pt join teams t on t.id = pt.team_id where pt.project_id = p.id) tm on true
`;

/** Projects with all computed metrics (progress, slips, overdue, risks, next milestone). */
export async function listProjects(f: ProjectFilter = {}): Promise<ProjectListItem[]> {
  const where: string[] = [];
  const p: unknown[] = [today()];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace("$?", `$${p.length}`)); };
  if (f.ids) add(`p.id = any($?::uuid[])`, f.ids);
  if (f.programId) add(`p.program_id = $?`, f.programId);
  if (f.ownerId) add(`p.owner_id = $?`, f.ownerId);
  if (f.health) add(`p.health = $?`, f.health);
  if (f.status) add(`p.status = $?`, f.status);
  else if (!f.includeClosed) where.push(`p.status <> 'cancelled'`);
  const rows = await q<ProjectListItem>(
    `${BASE} ${where.length ? `where ${where.join(" and ")}` : ""}
     order by array_position(array['active','on_hold','planned','completed','cancelled'], p.status),
              array_position(array['delayed','at_risk','on_track'], p.health), p.target_date nulls last, p.name`,
    p,
  );
  for (const r of rows) r.progress = computeProgress(r);
  return rows;
}

export async function getProject(id: string): Promise<ProjectListItem | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await listProjects({ ids: [id], includeClosed: true });
  return r ?? null;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  baseline_date: string | null;
  completed_at: string | null;
  status: MilestoneStatus;
  sort: number;
  slip: number;
  overdue: number;
}

export async function listMilestones(projectIds: string[]): Promise<Milestone[]> {
  if (!projectIds.length) return [];
  const rows = await q<Milestone>(
    `select id, project_id, title, due_date, baseline_date, completed_at, status, sort from milestones
     where project_id = any($1::uuid[]) order by due_date asc nulls last, sort`, [projectIds]);
  const td = today();
  for (const m of rows) Object.assign(m, milestoneSlip(m, td));
  return rows;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  author_id: string | null;
  author_name: string | null;
  author_color: string | null;
  what_changed: string | null;
  progress: string | null;
  blockers: string | null;
  decisions_required: string | null;
  next_steps: string | null;
  expected_completion: string | null;
  percent_complete: number | null;
  health: Health | null;
  created_at: string;
}

export async function listProjectUpdates(projectId: string): Promise<ProjectUpdate[]> {
  return q<ProjectUpdate>(
    `select u.*, a.name as author_name, a.avatar_color as author_color from project_updates u
     left join users a on a.id = u.author_id where u.project_id = $1 order by u.created_at desc`, [projectId]);
}

export interface LinkedMeeting { id: string; title: string; starts_at: string; mom_status: string; mom_owner_name: string | null; review_name: string | null }
export async function projectMeetings(projectId: string): Promise<LinkedMeeting[]> {
  return q<LinkedMeeting>(
    `select m.id, m.title, m.starts_at, m.mom_status, mo.name as mom_owner_name, r.name as review_name
     from meetings m left join users mo on mo.id = m.mom_owner_id left join reviews r on r.id = m.review_id
     where not m.cancelled and (m.project_id = $1 or r.project_id = $1
        or exists (select 1 from entity_links l where (l.from_type = 'meeting' and l.from_id = m.id and l.to_type = 'project' and l.to_id = $1)
                                                  or (l.to_type = 'meeting' and l.to_id = m.id and l.from_type = 'project' and l.from_id = $1)))
     order by m.starts_at desc limit 50`, [projectId]);
}

export interface Attachment { id: string; name: string; url: string | null; mime: string | null; created_at: string; uploaded_by_name: string | null }
export async function listAttachments(entityType: string, entityId: string): Promise<Attachment[]> {
  return q<Attachment>(
    `select a.id, a.name, a.url, a.mime, a.created_at, u.name as uploaded_by_name from attachments a left join users u on u.id = a.uploaded_by
     where a.entity_type = $1 and a.entity_id = $2 order by a.created_at desc`, [entityType, entityId]);
}

export interface ProjectFollowup { id: string; person_name: string | null; message: string | null; status: string; created_at: string }
export async function openProjectFollowups(projectId: string): Promise<ProjectFollowup[]> {
  return q<ProjectFollowup>(
    `select f.id, u.name as person_name, f.message, f.status, f.created_at from followups f left join users u on u.id = f.person_id
     where f.entity_type = 'project' and f.entity_id = $1 and f.status = 'open' order by f.created_at desc`, [projectId]);
}

export async function projectBasics(id: string) {
  return one<{ id: string; name: string; owner_id: string | null; program_id: string | null }>(`select id, name, owner_id, program_id from projects where id = $1`, [id]);
}
