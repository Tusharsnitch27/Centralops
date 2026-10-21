import type { ReportStatus } from "@/server/weekly/model";
export const STATUS_LABEL: Record<ReportStatus, string> = { collecting: "Collecting updates", review: "In review", approved: "Approved", sent: "Sent to leadership" };
export const STATUS_TONE: Record<ReportStatus, "neutral" | "violet" | "info" | "green"> = { collecting: "neutral", review: "violet", approved: "info", sent: "green" };
