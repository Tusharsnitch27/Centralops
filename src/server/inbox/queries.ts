import "server-only";
import { q } from "../db";

export interface InboxItem {
  id: string; kind: string; title: string; body: string | null; href: string | null; entity_type: string | null; entity_id: string | null;
  priority: number; status: string; created_at: string; snoozed_until: string | null;
}

export const INBOX_GROUPS: Record<string, { label: string; kinds: string[] }> = {
  all: { label: "All", kinds: [] },
  meetings: { label: "Meetings", kinds: ["mom_pending", "mom_review"] },
  tasks: { label: "Tasks", kinds: ["overdue", "task_assigned", "task_suggestion", "owner_update"] },
  plans: { label: "AOP & S&OP", kinds: ["aop_submission", "sop_submission"] },
  decisions: { label: "Decisions & risks", kinds: ["decision", "risk"] },
  system: { label: "Other", kinds: ["onboarding", "integration"] },
};

export async function listInbox(userId: string, group = "all", status: "open" | "done" = "open") {
  const kinds = INBOX_GROUPS[group]?.kinds ?? [];
  return q<InboxItem>(
    `select id, kind, title, body, href, entity_type, entity_id, priority, status, created_at, snoozed_until from inbox_items
     where user_id = $1 and ${status === "open" ? `status in ('open','snoozed') and (snoozed_until is null or snoozed_until < now())` : `status in ('done','dismissed') and resolved_at > now() - interval '14 days'`}
       and (cardinality($2::text[]) = 0 or kind = any($2::text[]))
     order by ${status === "open" ? "priority desc, created_at desc" : "resolved_at desc"} limit 200`,
    [userId, kinds],
  );
}

export async function inboxCounts(userId: string) {
  const rows = await q<{ kind: string; n: number }>(
    `select kind, count(*)::int as n from inbox_items where user_id = $1 and status in ('open','snoozed') and (snoozed_until is null or snoozed_until < now()) group by kind`, [userId]);
  const out: Record<string, number> = { all: 0 };
  for (const [g, def] of Object.entries(INBOX_GROUPS)) if (g !== "all") out[g] = rows.filter((r) => def.kinds.includes(r.kind)).reduce((a, r) => a + r.n, 0);
  out.all = rows.reduce((a, r) => a + r.n, 0);
  return out;
}
