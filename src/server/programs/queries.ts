import "server-only";
import { q } from "../db";
import { addDays, today } from "@/lib/dates";
import type { Health } from "@/lib/meta";
import { listMilestones, listProjects, type Milestone, type ProjectListItem } from "../projects/queries";

export interface ProgramItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: string;
  health: Health;
  start_date: string | null;
  target_date: string | null;
  color: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  sponsor_name: string | null;
  overdue_tasks: number;
  open_tasks: number;
  open_risks: number;
  critical_risks: number;
  pending_decisions: number;
  // aggregated from projects
  projects: ProjectListItem[];
  progress: number;
  at_risk: number;
  slipped: number;
  upcoming: (Milestone & { project_name: string; project_code: string | null })[];
  derived_health: Health;
}

/** Worst of the program's own health and its active projects' health. */
const worst = (hs: Health[]): Health => (hs.includes("delayed") ? "delayed" : hs.includes("at_risk") ? "at_risk" : "on_track");

export async function listPrograms(ids?: string[]): Promise<ProgramItem[]> {
  const td = today();
  const [programs, projects] = await Promise.all([
    q<Omit<ProgramItem, "projects" | "progress" | "at_risk" | "slipped" | "upcoming" | "derived_health">>(
      `select g.id, g.name, g.code, g.description, g.status, g.health, g.start_date, g.target_date, g.color, g.owner_id,
              ou.name as owner_name, ou.avatar_color as owner_color, su.name as sponsor_name,
              (select count(*)::int from tasks t where t.program_id = g.id and t.status not in ('completed','cancelled') and t.due_date < $1::date) as overdue_tasks,
              (select count(*)::int from tasks t where t.program_id = g.id and t.status not in ('completed','cancelled')) as open_tasks,
              (select count(*)::int from risks r left join projects p on p.id = r.project_id where (r.program_id = g.id or p.program_id = g.id) and r.status <> 'closed') as open_risks,
              (select count(*)::int from risks r left join projects p on p.id = r.project_id where (r.program_id = g.id or p.program_id = g.id) and r.status <> 'closed' and r.score >= 15) as critical_risks,
              (select count(*)::int from decisions d left join projects p on p.id = d.project_id where (d.program_id = g.id or p.program_id = g.id) and d.status in ('pending','proposed')) as pending_decisions
       from programs g left join users ou on ou.id = g.owner_id left join users su on su.id = g.sponsor_id
       where g.status <> 'cancelled' ${ids ? "and g.id = any($2::uuid[])" : ""}
       order by g.name`, ids ? [td, ids] : [td]),
    listProjects(),
  ]);
  const ms = await listMilestones(projects.map((p) => p.id));
  const horizon = addDays(td, 30);
  return programs.map((g) => {
    const ps = projects.filter((p) => p.program_id === g.id);
    const live = ps.filter((p) => p.status === "active" || p.status === "on_hold");
    const weightBase = live.length ? live : ps.filter((p) => p.status !== "planned");
    const progress = weightBase.length ? weightBase.reduce((a, p) => a + p.progress, 0) / weightBase.length : 0;
    const byId = new Map(ps.map((p) => [p.id, p]));
    const pms = ms.filter((m) => byId.has(m.project_id));
    const upcoming = pms
      .filter((m) => m.status !== "done" && m.due_date && m.due_date <= horizon)
      .map((m) => ({ ...m, project_name: byId.get(m.project_id)!.name, project_code: byId.get(m.project_id)!.code }));
    return {
      ...g,
      projects: ps,
      progress,
      at_risk: live.filter((p) => p.health !== "on_track").length,
      slipped: pms.filter((m) => m.status !== "done" && (m.slip > 0 || m.overdue > 0)).length,
      upcoming,
      derived_health: worst([g.health, ...live.map((p) => p.health)]),
    };
  });
}

export interface LinkedReview { id: string; name: string; cadence: string; module: string | null; owner_name: string | null; next_at: string | null }
export async function programReviews(programId: string): Promise<LinkedReview[]> {
  return q<LinkedReview>(
    `select r.id, r.name, r.cadence, r.module, u.name as owner_name,
            (select min(m.starts_at) from meetings m where m.review_id = r.id and m.starts_at >= now() and not m.cancelled) as next_at
     from reviews r left join users u on u.id = r.owner_id
     where r.active and (r.program_id = $1 or r.project_id in (select id from projects where program_id = $1)) order by r.name`, [programId]);
}
