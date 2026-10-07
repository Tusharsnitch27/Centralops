// Pure helpers shared by project queries, summaries and UI (no DB access).
import { diffDays, today } from "@/lib/dates";

export const PROJECT_STATUS = {
  planned: { label: "Planned", tone: "neutral" },
  active: { label: "Active", tone: "info" },
  on_hold: { label: "On hold", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

export const MILESTONE_STATUS = {
  pending: { label: "Pending", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "green" },
  missed: { label: "Missed", tone: "red" },
} as const;
export type MilestoneStatus = keyof typeof MILESTONE_STATUS;

/**
 * % complete, computed — never typed in.
 * Milestones carry 60% of the weight (in-progress = half credit), tasks 40% (active = 30% credit).
 * When only one of the two exists it carries the full weight.
 */
export function computeProgress(m: { ms_total: number; ms_done: number; ms_active: number; tasks_total: number; tasks_done: number; tasks_active: number; status?: string }) {
  if (m.status === "completed") return 1;
  const ms = m.ms_total ? (m.ms_done + m.ms_active * 0.5) / m.ms_total : null;
  const tk = m.tasks_total ? (m.tasks_done + m.tasks_active * 0.3) / m.tasks_total : null;
  if (ms == null && tk == null) return 0;
  if (ms == null) return tk!;
  if (tk == null) return ms;
  return ms * 0.6 + tk * 0.4;
}

/** Slip of a milestone in days: current vs baseline, or days overdue when it has no baseline slip. */
export function milestoneSlip(m: { due_date: string | null; baseline_date: string | null; status: string }, td = today()) {
  if (!m.due_date) return { slip: 0, overdue: 0 };
  const slip = m.baseline_date ? Math.max(0, diffDays(m.due_date, m.baseline_date)) : 0;
  const overdue = m.status !== "done" && m.due_date < td ? diffDays(td, m.due_date) : 0;
  return { slip, overdue };
}

export const pctInt = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
