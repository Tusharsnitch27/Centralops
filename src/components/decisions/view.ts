import { dateOf } from "@/lib/dates";
import type { DecisionItem } from "@/server/decisions/queries";
import type { DecisionView } from "./DecisionList";

/** Server → client shape (plain strings only). */
export const toDecisionView = (d: DecisionItem): DecisionView => ({
  id: d.id, title: d.title, context: d.context, reason: d.reason, impact: d.impact, status: d.status, decided_on: d.decided_on, due_date: d.due_date,
  meeting_id: d.meeting_id, meeting_title: d.meeting_title, meeting_date: d.meeting_at ? dateOf(d.meeting_at) : null,
  decision_maker_id: d.decision_maker_id, maker_name: d.maker_name, maker_color: d.maker_color,
  project_id: d.project_id, project_name: d.project_name, project_code: d.project_code, tasks: d.tasks,
});
