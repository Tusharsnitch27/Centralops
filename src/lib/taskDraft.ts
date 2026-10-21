// Shared shape of a captured task while it's being refined (server ↔ client).
export type Priority = "urgent" | "high" | "medium" | "low";
export interface TaskDraft {
  raw: string;
  title: string;
  details: string;
  outcome: string;          // definition of done
  nextStep: string;         // first concrete step
  dueDate: string | null;
  startDate: string | null;  // optional — task stays out of the active list until then
  dueLabel: string | null;
  pocName: string;          // free text — anyone, in the directory or not ("" = just me)
  ownerId: string | null;   // set when the POC matches a directory user
  priority: Priority;
  questions: string[];      // what would make it precise
  tips: string[];           // ways to make it more impactful
  engine: "claude" | "rules";
}
export interface FocusItem { taskId: string; title: string; why: string; action: string; tone: "red" | "amber" | "info" }
export interface FocusBrief { headline: string; items: FocusItem[]; hygiene: string[]; engine: "claude" | "rules" }
/** What the user has so far, sent back for another sharpening pass. */
export interface DraftInput { raw: string; title?: string; details?: string; pocName?: string; dueDate?: string | null }
