import type { RiskItem } from "@/server/risks/queries";
import type { RiskView } from "./RiskTable";

/** Server → client shape (plain values only). */
export const toRiskView = (r: RiskItem): RiskView => ({
  id: r.id, title: r.title, description: r.description, project_id: r.project_id, project_name: r.project_name, project_code: r.project_code,
  owner_id: r.owner_id, owner_name: r.owner_name, owner_color: r.owner_color, probability: r.probability, impact: r.impact, score: r.score,
  mitigation: r.mitigation, trigger_signal: r.trigger_signal, target_date: r.target_date, status: r.status, meeting_id: r.meeting_id, meeting_title: r.meeting_title,
});
