// Display metadata for statuses, priorities, health — shared by server and client.
export const TASK_STATUS = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  waiting: { label: "Waiting", tone: "amber" },
  blocked: { label: "Blocked", tone: "red" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const;
export type TaskStatus = keyof typeof TASK_STATUS;
export const OPEN_STATUSES: TaskStatus[] = ["not_started", "in_progress", "waiting", "blocked"];

export const HEALTH = {
  on_track: { label: "On track", tone: "green" },
  at_risk: { label: "At risk", tone: "amber" },
  delayed: { label: "Delayed", tone: "red" },
} as const;
export type Health = keyof typeof HEALTH;

export const PRIORITY = {
  urgent: { label: "Urgent", tone: "red", rank: 0 },
  high: { label: "High", tone: "amber", rank: 1 },
  medium: { label: "Medium", tone: "neutral", rank: 2 },
  low: { label: "Low", tone: "muted", rank: 3 },
} as const;
export type Priority = keyof typeof PRIORITY;

export const MOM_STATUS = {
  pending: { label: "MoM pending", tone: "amber" },
  draft: { label: "MoM draft", tone: "amber" },
  submitted: { label: "Awaiting your review", tone: "info" },
  distributed: { label: "Actions distributed", tone: "green" },
  skipped: { label: "Skipped", tone: "muted" },
  not_relevant: { label: "Not relevant", tone: "muted" },
} as const;
export type MomStatus = keyof typeof MOM_STATUS;

export const TASK_SOURCE = {
  manual: "Manual", meeting: "Meeting", aop: "AOP", sop: "S&OP", project: "Project", ai: "AI", followup: "Follow-up", integration: "Integration", onboarding: "Onboarding",
} as const;

export type Tone = "neutral" | "info" | "green" | "amber" | "red" | "muted" | "violet";

export const RISK_LEVEL = (score: number) =>
  score >= 15 ? { label: "Critical", tone: "red" as Tone } : score >= 10 ? { label: "High", tone: "amber" as Tone } : score >= 5 ? { label: "Medium", tone: "info" as Tone } : { label: "Low", tone: "muted" as Tone };
