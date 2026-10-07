import "server-only";
import { q } from "../db";
import type { RiskStatus } from "./meta";

export interface RiskItem {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  program_id: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  probability: number;
  impact: number;
  score: number;
  mitigation: string | null;
  trigger_signal: string | null;
  target_date: string | null;
  status: RiskStatus;
  created_at: string;
  updated_at: string;
}

export interface RiskFilter {
  projectId?: string;
  programId?: string;
  ownerId?: string;
  status?: RiskStatus | "active";
  minScore?: number;
  maxScore?: number;
  probability?: number;
  impact?: number;
  ids?: string[];
  search?: string;
  limit?: number;
}

export async function listRisks(f: RiskFilter = {}): Promise<RiskItem[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace(/\$\?/g, `$${p.length}`)); };
  if (f.projectId) add(`r.project_id = $?`, f.projectId);
  if (f.programId) add(`(r.program_id = $? or pr.program_id = $?)`, f.programId);
  if (f.ownerId) add(`r.owner_id = $?`, f.ownerId);
  if (f.status === "active" || f.status === undefined) where.push(`r.status <> 'closed'`);
  else add(`r.status = $?`, f.status);
  if (f.minScore != null) add(`r.score >= $?`, f.minScore);
  if (f.maxScore != null) add(`r.score <= $?`, f.maxScore);
  if (f.probability) add(`r.probability = $?`, f.probability);
  if (f.impact) add(`r.impact = $?`, f.impact);
  if (f.ids) add(`r.id = any($?::uuid[])`, f.ids);
  if (f.search) add(`(r.title ilike $? or r.description ilike $? or r.mitigation ilike $?)`, `%${f.search}%`);
  p.push(f.limit ?? 300);
  return q<RiskItem>(
    `select r.id, r.title, r.description, r.project_id, pr.name as project_name, pr.code as project_code, coalesce(r.program_id, pr.program_id) as program_id,
            r.meeting_id, m.title as meeting_title, r.owner_id, u.name as owner_name, u.avatar_color as owner_color,
            r.probability, r.impact, r.score, r.mitigation, r.trigger_signal, r.target_date, r.status, r.created_at, r.updated_at
     from risks r
     left join projects pr on pr.id = r.project_id
     left join users u on u.id = r.owner_id
     left join meetings m on m.id = r.meeting_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by (r.status = 'closed'), (r.status = 'escalated') desc, r.score desc, r.target_date asc nulls last
     limit $${p.length}`,
    p,
  );
}

/** Count of active risks per probability × impact cell. */
export async function riskMatrix(f: { projectId?: string; programId?: string } = {}) {
  const p: unknown[] = [];
  let where = `r.status <> 'closed'`;
  if (f.projectId) { p.push(f.projectId); where += ` and r.project_id = $${p.length}`; }
  if (f.programId) { p.push(f.programId); where += ` and (r.program_id = $${p.length} or pr.program_id = $${p.length})`; }
  return q<{ probability: number; impact: number; n: number }>(
    `select r.probability, r.impact, count(*)::int as n from risks r left join projects pr on pr.id = r.project_id where ${where} group by 1, 2`, p);
}
