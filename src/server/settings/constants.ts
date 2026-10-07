// Preference constants & normalisation — shared by server and client (no server-only imports).
export const DASHBOARD_SECTIONS = [
  { key: "attention", label: "Needs attention", hint: "Overdue, blocked and slipping work" },
  { key: "today", label: "Today", hint: "Meetings and tasks due today" },
  { key: "followups", label: "Follow-ups", hint: "Updates you're waiting on" },
  { key: "projects", label: "Projects", hint: "Health of active projects" },
  { key: "aop", label: "AOP", hint: "Budget vs actuals and missing inputs" },
  { key: "sop", label: "S&OP", hint: "Projection inputs and capacity" },
  { key: "ai", label: "AI suggestions", hint: "Proactive suggestions from Insights" },
] as const;
export const DEFAULT_SECTIONS = DASHBOARD_SECTIONS.map((s) => s.key) as string[];

export const NOTIFICATION_KINDS = [
  { key: "task_assigned", label: "Task assigned to me" },
  { key: "task_update", label: "Updates on tasks I follow" },
  { key: "followup", label: "Update requested from me" },
  { key: "deadline", label: "Upcoming deadlines" },
  { key: "overdue", label: "Overdue work" },
  { key: "comment", label: "Comments & mentions" },
  { key: "mom_pending", label: "MoM pending" },
  { key: "mom_submitted", label: "MoM submitted for review" },
  { key: "aop_input", label: "AOP input requests" },
  { key: "sop_input", label: "S&OP input requests" },
  { key: "risk_escalated", label: "Risk escalations" },
  { key: "decision_required", label: "Decisions required" },
] as const;

export const TASK_VIEWS = [
  { key: "mine", label: "My tasks" },
  { key: "delegated", label: "Delegated by me" },
  { key: "today", label: "Due today" },
  { key: "team", label: "My team" },
  { key: "all", label: "All open" },
] as const;

export interface Preferences {
  dashboard: { sections: string[] };
  favouritePrograms: string[];
  defaultTaskView: string;
  reviewCadence: { weeklyReviewDay: string; frequency: "weekly" | "fortnightly" | "monthly" };
  notifications: Record<string, boolean>;
}

export const DEFAULT_PREFS: Preferences = {
  dashboard: { sections: DEFAULT_SECTIONS },
  favouritePrograms: [],
  defaultTaskView: "mine",
  reviewCadence: { weeklyReviewDay: "Fri", frequency: "weekly" },
  notifications: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k.key, true])),
};

const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** Normalise stored prefs onto the defaults (unknown keys dropped, missing keys filled). */
export function normalisePrefs(raw: unknown): Preferences {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dash = (p.dashboard && typeof p.dashboard === "object" ? p.dashboard : {}) as Record<string, unknown>;
  const sections = strArr(dash.sections)?.filter((k) => DEFAULT_SECTIONS.includes(k));
  const cad = (p.reviewCadence && typeof p.reviewCadence === "object" ? p.reviewCadence : {}) as Record<string, unknown>;
  const notif = (p.notifications && typeof p.notifications === "object" ? p.notifications : {}) as Record<string, unknown>;
  return {
    dashboard: { sections: sections ?? DEFAULT_PREFS.dashboard.sections },
    favouritePrograms: strArr(p.favouritePrograms) ?? [],
    defaultTaskView: typeof p.defaultTaskView === "string" && TASK_VIEWS.some((v) => v.key === p.defaultTaskView) ? p.defaultTaskView : DEFAULT_PREFS.defaultTaskView,
    reviewCadence: {
      weeklyReviewDay: typeof cad.weeklyReviewDay === "string" && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(cad.weeklyReviewDay) ? cad.weeklyReviewDay : "Fri",
      frequency: cad.frequency === "fortnightly" || cad.frequency === "monthly" ? cad.frequency : "weekly",
    },
    notifications: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k.key, typeof notif[k.key] === "boolean" ? (notif[k.key] as boolean) : true])),
  };
}

