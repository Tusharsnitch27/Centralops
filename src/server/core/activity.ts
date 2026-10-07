import "server-only";
import { q, type Tx } from "../db";

export type EntityType =
  | "task" | "project" | "program" | "meeting" | "decision" | "risk" | "milestone"
  | "aop_cycle" | "aop_section" | "aop_item" | "sop_stream" | "sop_line" | "user" | "team" | "followup" | "integration" | "review";

export interface ActivityInput {
  actorId: string | null;
  entityType: EntityType;
  entityId: string | null;
  action: string;
  field?: string | null;
  from?: unknown;
  to?: unknown;
  summary?: string | null;
}

const s = (v: unknown) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));

/** Audit trail entry. Pass `t` to write inside an open transaction. */
export async function logActivity(a: ActivityInput, t?: Tx) {
  const run = t ? t.q : q;
  await run(
    `insert into activity_log (actor_id, entity_type, entity_id, action, field, from_value, to_value, summary)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.actorId, a.entityType, a.entityId, a.action, a.field ?? null, s(a.from), s(a.to), a.summary ?? null],
  );
}

/** Link two objects in the universal relation graph (idempotent). */
export async function link(fromType: EntityType, fromId: string, toType: EntityType, toId: string, relation = "related", by: string | null = null, t?: Tx) {
  const run = t ? t.q : q;
  await run(
    `insert into entity_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1,$2,$3,$4,$5,$6)
     on conflict do nothing`,
    [fromType, fromId, toType, toId, relation, by],
  );
}
