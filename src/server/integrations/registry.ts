import "server-only";
import { one } from "../db";
import { googleConfigured, googleRedirectUri } from "./google";

/**
 * Modular integration registry. Each entry describes a connector; `live` ones have a working connect flow,
 * `soon` ones render as roadmap cards so the team knows what's coming and why. Add a provider here, then its
 * connect route under /api/integrations/<key>/ and a sync module.
 */
export type IntegrationKey = "google_calendar" | "gmail" | "slack" | "whatsapp" | "google_drive" | "google_sheets" | "snowflake" | "erp_bi";
export interface IntegrationDef {
  key: IntegrationKey;
  name: string;
  category: "Calendar & meetings" | "Communication" | "Documents" | "Data";
  status: "live" | "soon";
  icon: string;        // lucide icon name
  tagline: string;
  capabilities: string[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  { key: "google_calendar", name: "Google Calendar", category: "Calendar & meetings", status: "live", icon: "CalendarDays",
    tagline: "Your meetings flow in automatically, matched to reviews and MoM owners.",
    capabilities: ["Imports meetings from your joining date onward (read-only)", "Recurring reviews matched to their series and MoM owner", "Ended meetings prompt the MoM owner to add minutes"] },
  { key: "gmail", name: "Gmail", category: "Communication", status: "soon", icon: "Mail",
    tagline: "Send follow-ups and MoM summaries by email; capture replies as task updates.",
    capabilities: ["Follow-up requests sent as email", "Replies logged as task updates", "MoM distribution email to attendees"] },
  { key: "slack", name: "Slack", category: "Communication", status: "soon", icon: "MessageSquare",
    tagline: "Nudges, daily digests and one-click updates where the team already works.",
    capabilities: ["Overdue and update-missing nudges via DM", "Post distributed MoM actions to a channel", "Reply in thread to update a task"] },
  { key: "whatsapp", name: "WhatsApp", category: "Communication", status: "soon", icon: "Phone",
    tagline: "Reach warehouse and store owners on the channel they actually read.",
    capabilities: ["Follow-up reminders over WhatsApp Business", "Quick status replies: done / blocked / need time", "Daily task digest for field teams"] },
  { key: "google_drive", name: "Google Drive", category: "Documents", status: "soon", icon: "FolderOpen",
    tagline: "Attach pre-reads and decks to meetings, projects and decisions.",
    capabilities: ["Link Drive files to any object", "Auto-attach the pre-read to a review meeting", "Searchable from the command palette"] },
  { key: "google_sheets", name: "Google Sheets", category: "Documents", status: "soon", icon: "Sheet",
    tagline: "Pull trackers that still live in Sheets into tasks and AOP lines.",
    capabilities: ["Import an existing tracker as tasks", "Scheduled sync of AOP owner inputs", "Export any list view to a Sheet"] },
  { key: "snowflake", name: "Snowflake", category: "Data", status: "soon", icon: "Snowflake",
    tagline: "S&OP actuals and cost actuals straight from the warehouse — no more manual uploads.",
    capabilities: ["Projection vs actual by channel (S&OP)", "Monthly cost actuals by function (AOP)", "Exception alerts when actuals breach plan"] },
  { key: "erp_bi", name: "ERP / BI", category: "Data", status: "soon", icon: "BarChart3",
    tagline: "Vendor invoices, POs and BI dashboards linked to the programs they explain.",
    capabilities: ["PO and invoice status on projects", "Vendor-wise cost feeds for the logistics review", "Embed BI tiles on program pages"] },
];

export interface GoogleStatus {
  configured: boolean;
  redirectUri: string;
  connected: boolean;
  status: "connected" | "error" | "disconnected" | null;
  account_email: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_result: { fetched: number; imported: number; updated: number; skipped: number } | null;
  meetings: number;
}

export async function googleStatus(userId: string): Promise<GoogleStatus> {
  const i = await one<{ id: string; status: GoogleStatus["status"]; account_email: string | null; last_sync_at: string | null; last_error: string | null; config: { last_result?: GoogleStatus["last_result"] } }>(
    `select id, status, account_email, last_sync_at, last_error, config from integrations where user_id = $1 and provider = 'google_calendar'`, [userId]);
  const meetings = i ? (await one<{ n: number }>(`select count(*)::int as n from calendar_events where integration_id = $1 and meeting_id is not null`, [i.id]))?.n ?? 0 : 0;
  return {
    configured: googleConfigured(), redirectUri: googleRedirectUri(),
    connected: Boolean(i && i.status !== "disconnected"), status: i?.status ?? null, account_email: i?.account_email ?? null,
    last_sync_at: i?.last_sync_at ?? null, last_error: i?.last_error ?? null, last_result: i?.config?.last_result ?? null, meetings,
  };
}
