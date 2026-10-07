// Display metadata for decisions (client + server safe).
export const DECISION_STATUS = {
  proposed: { label: "Proposed", tone: "neutral" },
  pending: { label: "Decision required", tone: "amber" },
  made: { label: "Decided", tone: "green" },
  revisited: { label: "Revisited", tone: "info" },
  superseded: { label: "Superseded", tone: "muted" },
} as const;
export type DecisionStatus = keyof typeof DECISION_STATUS;

