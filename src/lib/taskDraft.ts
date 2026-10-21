// Shared shape of a captured task while it's being refined (server ↔ client).
export type Priority = "urgent" | "high" | "medium" | "low";
export interface TaskDraft {
  raw: string;
  title: string;
  details: string;
  outcome: string;          // definition of done
  nextStep: string;         // first concrete step
  dueDate: string | null;
  dueLabel: string | null;
  ownerId: string | null;   // POC; null = me
  ownerName: string | null;
  priority: Priority;
  questions: string[];      // what would make it precise
  tips: string[];           // ways to make it more impactful
  engine: "claude" | "rules";
}
export interface FocusItem { taskId: string; title: string; why: string; action: string; tone: "red" | "amber" | "info" }
export interface FocusBrief { headline: string; items: FocusItem[]; hygiene: string[]; engine: "claude" | "rules" }
