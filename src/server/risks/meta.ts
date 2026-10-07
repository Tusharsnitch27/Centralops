// Display metadata for risks (client + server safe).
import { RISK_LEVEL } from "@/lib/meta";

export const RISK_STATUS = {
  open: { label: "Open", tone: "neutral" },
  mitigating: { label: "Mitigating", tone: "info" },
  escalated: { label: "Escalated", tone: "red" },
  closed: { label: "Closed", tone: "muted" },
} as const;
export type RiskStatus = keyof typeof RISK_STATUS;

export type RiskLevelKey = "critical" | "high" | "medium" | "low";
export const riskLevelKey = (score: number): RiskLevelKey =>
  score >= 15 ? "critical" : score >= 10 ? "high" : score >= 5 ? "medium" : "low";
export const LEVEL_RANGE: Record<RiskLevelKey, [number, number]> = { critical: [15, 25], high: [10, 14], medium: [5, 9], low: [1, 4] };
export { RISK_LEVEL };
