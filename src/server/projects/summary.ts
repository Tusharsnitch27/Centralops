import "server-only";
import type { Health } from "@/lib/meta";
import { listMilestones, listProjects } from "./queries";
import { pctInt } from "./metrics";

export interface ProjectAtRisk {
  id: string;
  name: string;
  code: string | null;
  health: Health;
  progress: number; // 0..100
  target_date: string | null;
  owner_name: string | null;
  overdueTasks: number;
  slippedMilestones: { title: string; slipDays: number }[];
  primaryRisk: string | null;
}

/**
 * For the Command Centre: projects that need attention (at risk / delayed, slipped milestones or overdue tasks), worst first.
 * slipDays = current vs baseline, or days overdue when the milestone is past due.
 */
export async function projectsAtRisk(limit?: number): Promise<ProjectAtRisk[]> {
  const projects = (await listProjects()).filter((p) => p.status === "active" || p.status === "on_hold" || p.status === "planned");
  const ms = await listMilestones(projects.map((p) => p.id));
  const out = projects
    .map((p) => {
      const slipped = ms
        .filter((m) => m.project_id === p.id && m.status !== "done" && (m.slip > 0 || m.overdue > 0))
        .map((m) => ({ title: m.title, slipDays: Math.max(m.slip, m.overdue) }))
        .sort((a, b) => b.slipDays - a.slipDays);
      const severity = (p.health === "delayed" ? 30 : p.health === "at_risk" ? 20 : 0) + slipped.reduce((a, s) => a + Math.min(s.slipDays, 10), 0) + p.overdue_tasks * 3 + (p.top_risk_score ?? 0) / 5;
      return {
        id: p.id, name: p.name, code: p.code, health: p.health, progress: pctInt(p.progress), target_date: p.target_date, owner_name: p.owner_name,
        overdueTasks: p.overdue_tasks, slippedMilestones: slipped, primaryRisk: p.top_risk_title, severity,
      };
    })
    .filter((p) => p.health !== "on_track" || p.slippedMilestones.length > 0 || p.overdueTasks > 0)
    .sort((a, b) => b.severity - a.severity);
  return out.slice(0, limit ?? out.length).map(({ severity: _s, ...rest }) => rest);
}
