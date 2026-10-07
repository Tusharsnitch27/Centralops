import "server-only";
import { q } from "../db";
import { allItemsOf, type Model, type SectionNode, type Vals } from "./model";
import type { Direction, Labels } from "./calc";

/* Serializable plan tree for the Summary / Review client components (all months, plus remarks). */

export interface Remark { kind: "commentary" | "variance_reason" | "corrective_action"; body: string; author: string | null; confidence: string | null; at: string }
export interface LineNode { id: string; name: string; owner: string | null; ownerId: string | null; direction: Direction; vals: Record<string, Vals>; remarks: Record<string, Remark[]>; reference: string | null }
export interface GroupNode { id: string; name: string; lines: LineNode[] }
export interface FnNode { id: string; name: string; owner: string | null; ownerId: string | null; groups: GroupNode[]; lines: LineNode[] }
export interface SummaryTree { cycleId: string; labels: Labels; months: string[]; closed: string[]; lastClosed: string | null; currentMonth: string; threshold: number; functions: FnNode[] }

export async function summaryTree(m: Model): Promise<SummaryTree> {
  const rows = await q<{ item_id: string; period: string | null; kind: Remark["kind"]; body: string; author: string | null; confidence: string | null; created_at: string }>(
    `select c.item_id, c.period, c.kind, c.body, u.name as author, c.confidence, c.created_at
     from aop_comments c join aop_items i on i.id = c.item_id left join users u on u.id = c.author_id
     where i.cycle_id = $1 order by c.created_at desc`, [m.cycle.id]);
  const remarks = new Map<string, Record<string, Remark[]>>();
  for (const r of rows) {
    const per = remarks.get(r.item_id) ?? {};
    const key = r.period ?? "all";
    (per[key] ??= []).push({ kind: r.kind, body: r.body, author: r.author, confidence: r.confidence, at: new Date(r.created_at).toISOString() });
    remarks.set(r.item_id, per);
  }
  const line = (i: Model["items"][number]): LineNode => ({
    id: i.id, name: i.name, owner: i.owner_name, ownerId: i.owner_id, direction: i.direction, vals: i.vals, remarks: remarks.get(i.id) ?? {}, reference: i.reference,
  });
  const fn = (f: SectionNode): FnNode => ({
    id: f.id, name: f.name, owner: f.owner_label ?? f.owner_name, ownerId: f.owner_id,
    lines: f.items.map(line),
    groups: f.children.map((g) => ({ id: g.id, name: g.name, lines: allItemsOf(g).map(line) })),
  });
  return {
    cycleId: m.cycle.id, labels: m.cycle.labels, months: m.months, closed: m.closed, lastClosed: m.lastClosed, currentMonth: m.currentMonth,
    threshold: m.threshold, functions: m.functions.map(fn),
  };
}
