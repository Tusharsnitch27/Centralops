import "server-only";
import { q, type Tx } from "../db";

export interface NotifyInput {
  userId: string | null | undefined;
  kind: string; // task_assigned, deadline, overdue, update_missing, comment, mom_pending, mom_submitted, aop_input, sop_input, risk_escalated, decision_required, followup
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  href?: string | null;
  actorId?: string | null;
}

/** In-app notification. Self-notifications (actor == recipient) are skipped. Channels (email/Slack/WhatsApp) plug in here later. */
export async function notify(n: NotifyInput, t?: Tx) {
  if (!n.userId || (n.actorId && n.actorId === n.userId)) return;
  const run = t ? t.q : q;
  await run(
    `insert into notifications (user_id, kind, title, body, entity_type, entity_id, href, actor_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [n.userId, n.kind, n.title, n.body ?? null, n.entityType ?? null, n.entityId ?? null, n.href ?? null, n.actorId ?? null],
  );
}

export interface InboxInput {
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  href?: string | null;
  priority?: number; // 0-100, higher first
  dedupeKey: string; // same key never re-raised once done/dismissed
}

/** Add to a user's Inbox. Idempotent on (user, dedupeKey): open items get refreshed, resolved ones stay resolved. */
export async function toInbox(i: InboxInput, t?: Tx) {
  const run = t ? t.q : q;
  await run(
    `insert into inbox_items (user_id, kind, title, body, entity_type, entity_id, href, priority, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (user_id, dedupe_key) do update set title = excluded.title, body = excluded.body, priority = excluded.priority
       where inbox_items.status = 'open'`,
    [i.userId, i.kind, i.title, i.body ?? null, i.entityType ?? null, i.entityId ?? null, i.href ?? null, i.priority ?? 50, i.dedupeKey],
  );
}

/** Close inbox items for an entity once the underlying thing is handled. */
export async function resolveInbox(dedupeKey: string, userId?: string, t?: Tx) {
  const run = t ? t.q : q;
  await run(
    `update inbox_items set status = 'done', resolved_at = now() where dedupe_key = $1 and status <> 'done' ${userId ? "and user_id = $2" : ""}`,
    userId ? [dedupeKey, userId] : [dedupeKey],
  );
}
