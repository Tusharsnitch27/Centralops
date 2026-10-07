import "server-only";
import { q, one } from "../db";
import type { User } from "../auth";
import { canEditField, loadModel, type ItemRow, type Model } from "./model";

/* Page-level queries that aren't part of the in-memory model. */

export interface ItemDetail {
  item: Omit<ItemRow, "vals"> & { functionName: string; groupName: string | null };
  months: { period: string; plan: number | null; forecast: number | null; actual: number | null }[];
  lastClosed: string | null;
  labels: Model["cycle"]["labels"];
  cycleId: string;
  history: { id: string; period: string | null; field: string; old_value: string | null; new_value: string | null; author: string | null; created_at: string }[];
  comments: { id: string; period: string | null; kind: string; body: string; confidence: string | null; author: string | null; author_color: string | null; created_at: string }[];
  tasks: { id: string; number: number; title: string; status: string; due_date: string | null; owner_name: string | null; priority: string }[];
  can: { plan: boolean; forecast: boolean; actual: boolean; comment: boolean; task: boolean };
}

export async function itemDetail(itemId: string, u: User): Promise<ItemDetail | null> {
  const row = await one<{ cycle_id: string }>(`select cycle_id from aop_items where id = $1`, [itemId]);
  if (!row) return null;
  const m = await loadModel(row.cycle_id);
  const it = m?.itemById.get(itemId);
  if (!m || !it) return null;
  const sec = m.sectionById.get(it.section_id)!;
  const [history, comments, tasks] = await Promise.all([
    q<ItemDetail["history"][number]>(
      `select a.id, a.period, a.field, a.old_value, a.new_value, u.name as author, a.created_at
       from aop_updates a left join users u on u.id = a.author_id where a.item_id = $1 order by a.created_at desc limit 40`, [itemId]),
    q<ItemDetail["comments"][number]>(
      `select c.id, c.period, c.kind, c.body, c.confidence, u.name as author, u.avatar_color as author_color, c.created_at
       from aop_comments c left join users u on u.id = c.author_id where c.item_id = $1 order by c.created_at desc limit 60`, [itemId]),
    q<ItemDetail["tasks"][number]>(
      `select t.id, t.number, t.title, t.status, t.due_date, u.name as owner_name, t.priority from tasks t left join users u on u.id = t.owner_id
       where t.aop_item_id = $1 order by (t.status in ('completed','cancelled')), t.due_date nulls last limit 20`, [itemId]),
  ]);
  const { vals, ...rest } = it;
  return {
    item: { ...rest, functionName: sec.fn?.name ?? sec.name, groupName: sec.kind === "function" ? null : sec.name },
    months: m.months.map((p) => ({ period: p, plan: vals[p]?.plan ?? null, forecast: vals[p]?.forecast ?? null, actual: vals[p]?.actual ?? null })),
    lastClosed: m.lastClosed, labels: m.cycle.labels, cycleId: m.cycle.id,
    history: history.map((h) => ({ ...h, created_at: String(new Date(h.created_at).toISOString()) })),
    comments: comments.map((c) => ({ ...c, created_at: String(new Date(c.created_at).toISOString()) })),
    tasks,
    can: {
      plan: canEditField(m, u, it, "plan"), forecast: canEditField(m, u, it, "forecast"), actual: canEditField(m, u, it, "actual"),
      comment: canEditField(m, u, it, "comment"), task: u.role !== "viewer" && u.role !== "leadership",
    },
  };
}

export interface CorrectiveRow { kind: "comment" | "task"; id: string; itemId: string; itemName: string; body: string; who: string | null; status: string | null; due: string | null; confidence: string | null; created_at: string }
export async function correctiveActions(cycleId: string, limit = 8): Promise<CorrectiveRow[]> {
  const [cs, ts] = await Promise.all([
    q<CorrectiveRow>(
      `select 'comment' as kind, c.id, c.item_id as "itemId", i.name as "itemName", c.body, u.name as who, null as status, null as due, c.confidence, c.created_at
       from aop_comments c join aop_items i on i.id = c.item_id left join users u on u.id = c.author_id
       where i.cycle_id = $1 and c.kind = 'corrective_action' order by c.created_at desc limit $2`, [cycleId, limit]),
    q<CorrectiveRow>(
      `select 'task' as kind, t.id, i.id as "itemId", i.name as "itemName", t.title as body, u.name as who, t.status, t.due_date as due, null as confidence, t.created_at
       from tasks t join aop_items i on i.id = t.aop_item_id left join users u on u.id = t.owner_id
       where i.cycle_id = $1 and t.status not in ('completed','cancelled') order by t.due_date nulls last limit $2`, [cycleId, limit]),
  ]);
  return [...ts, ...cs].slice(0, limit);
}

export async function decisionsRequired(limit = 6) {
  return q<{ id: string; title: string; due_date: string | null; status: string; maker: string | null }>(
    `select d.id, d.title, d.due_date, d.status, u.name as maker from decisions d left join users u on u.id = d.decision_maker_id
     where d.status in ('proposed','pending')
       and (d.program_id in (select id from programs where code = 'COST')
            or exists (select 1 from entity_links l where (l.from_type = 'decision' and l.from_id = d.id and l.to_type like 'aop%')
                                                     or (l.to_type = 'decision' and l.to_id = d.id and l.from_type like 'aop%'))
            or d.title ilike any (array['%budget%','%cost%','%aop%','%provision%','%vendor%','%rate%']))
     order by d.due_date nulls last limit $1`, [limit]);
}

export interface CreditNote { id: string; function_name: string | null; partner: string; cn_type: string | null; month_label: string | null; amount: number | null; received: number | null; owner_id: string | null; owner_name: string | null; status: string; remarks: string | null }
export interface Incident { id: string; function_name: string | null; month_label: string | null; channel: string | null; expense_type: string | null; reason: string | null; amount: number | null; owner_id: string | null; owner_name: string | null; remarks: string | null }
export const listCreditNotes = (cycleId: string) =>
  q<CreditNote>(`select c.id, c.function_name, c.partner, c.cn_type, c.month_label, c.amount, c.received, c.owner_id, u.name as owner_name, c.status, c.remarks
    from credit_notes c left join users u on u.id = c.owner_id where c.cycle_id = $1 or c.cycle_id is null order by c.created_at desc`, [cycleId]);
export const listIncidents = (cycleId: string) =>
  q<Incident>(`select x.id, x.function_name, x.month_label, x.channel, x.expense_type, x.reason, x.amount, x.owner_id, u.name as owner_name, x.remarks
    from incident_expenses x left join users u on u.id = x.owner_id where x.cycle_id = $1 or x.cycle_id is null order by x.created_at desc`, [cycleId]);

export interface ImportTemplate { id: string; name: string; header_rows: number; mapping: unknown; created_at: string }
export const listTemplates = () => q<ImportTemplate>(`select id, name, header_rows, mapping, created_at from aop_import_templates order by created_at desc`);
export const listImports = () =>
  q<{ id: string; file_name: string | null; rows_imported: number | null; cycle_name: string | null; who: string | null; created_at: string }>(
    `select i.id, i.file_name, i.rows_imported, c.name as cycle_name, u.name as who, i.created_at from aop_imports i
     left join aop_cycles c on c.id = i.cycle_id left join users u on u.id = i.created_by order by i.created_at desc limit 10`);

/** Open follow-ups per section (reminders already sent for a period). */
export async function remindersSent(cycleId: string) {
  return q<{ entity_id: string; person_id: string | null; created_at: string }>(
    `select f.entity_id, f.person_id, max(f.created_at) as created_at from followups f join aop_sections s on s.id = f.entity_id
     where f.entity_type = 'aop_section' and s.cycle_id = $1 and f.status = 'open' group by f.entity_id, f.person_id`, [cycleId]);
}
