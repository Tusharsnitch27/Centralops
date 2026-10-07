import "server-only";
import { cache } from "react";
import { q, one } from "../db";
import { canEdit, canManage, type User } from "../auth";
import { addMonths, monthStart, today } from "@/lib/dates";
import { cycleMonths, DEFAULT_LABELS, impactOf, statusFrom, type AopStatus, type Direction, type Labels } from "./calc";

/* The AOP model: one query per table, all maths in memory. Cached per request. */

export interface Cycle {
  id: string; name: string; kind: "cost" | "revenue" | "mixed"; fy_start: string; months: number; status: "draft" | "active" | "closed";
  currency: string; labels: Labels; actuals_cutoff_day: number; projection_cutoff_day: number; guidelines: string[];
  source_file: string | null; owner_id: string | null;
}
export interface CycleLite { id: string; name: string; kind: string; status: string; fy_start: string }

export interface Vals { plan: number | null; forecast: number | null; actual: number | null }
export interface Metrics {
  fyPlan: number;            // annual target (or sum of monthly plan)
  ytdPlan: number;           // plan through last closed month
  ytdPlanReported: number;   // plan for closed months that have an actual (like-for-like base)
  ytdActual: number;
  variance: number;          // ytdActual − ytdPlanReported (raw sign)
  impact: number;            // favourability in ₹ (+ good)
  impactPct: number | null;  // impact / ytdPlanReported
  projection: number;        // closed: actual ?? forecast ?? plan; open: forecast ?? plan
  committed: number;         // closed months, same rule (estimate of spend/achievement to date)
  remainingPlan: number;     // plan for open months
  gap: number;               // projection − fyPlan (raw)
  gapImpact: number;         // favourability of the projection vs plan
  gapImpactPct: number | null;
  missing: number;           // closed month-lines with plan/forecast but no actual
  missingLast: number;       // …in the last closed month
  expectedLast: number;      // lines expected to report for the last closed month
  status: AopStatus;
}
export interface ItemRow {
  id: string; name: string; section_id: string; function_id: string; group_id: string | null;
  metric: string | null; unit: "inr" | "num" | "pct"; direction: Direction; owner_id: string | null; owner_name: string | null;
  annual_target: number | null; confidence: string | null; reference: string | null; note: string | null; sort: number;
  vals: Record<string, Vals>; m: Metrics; comments: number; openTasks: number; contributors: string[];
}
export interface SectionNode {
  id: string; name: string; kind: "function" | "team" | "group"; parent_id: string | null; owner_id: string | null; owner_name: string | null;
  owner_label: string | null; sort: number; contributors: { id: string; name: string; role: string }[];
  children: SectionNode[]; items: ItemRow[]; m: Metrics; monthly: Record<string, Vals>; fn: SectionNode | null;
}
export interface Model {
  cycle: Cycle; months: string[]; currentMonth: string; lastClosed: string | null; closed: string[]; remaining: string[];
  threshold: number; direction: Direction; functions: SectionNode[]; sectionById: Map<string, SectionNode>; items: ItemRow[];
  itemById: Map<string, ItemRow>; totals: Metrics; monthly: Record<string, Vals>;
}

const parseLabels = (l: unknown): Labels => ({ ...DEFAULT_LABELS, ...((l as Partial<Labels>) ?? {}) });

export const listCycles = cache(() =>
  q<CycleLite>(`select id, name, kind, status, fy_start from aop_cycles order by (status = 'active') desc, fy_start desc, created_at desc`));

/** The requested cycle, else the active one (most recent). */
export const resolveCycle = cache(async (id?: string | null): Promise<Cycle | null> => {
  const row = await one<Cycle>(
    `select id, name, kind, fy_start, months, status, currency, labels, actuals_cutoff_day, projection_cutoff_day, guidelines, source_file, owner_id
     from aop_cycles where ($1::uuid is null or id = $1::uuid)
     order by (status = 'active') desc, fy_start desc, created_at desc limit 1`,
    [id && /^[0-9a-f-]{36}$/i.test(id) ? id : null]);
  if (!row) return null;
  return { ...row, labels: parseLabels(row.labels), guidelines: Array.isArray(row.guidelines) ? row.guidelines : [] };
});

const emptyVals = (): Vals => ({ plan: null, forecast: null, actual: null });
const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

function computeMetrics(vals: Record<string, Vals>, months: string[], lastClosed: string | null, direction: Direction, annual: number | null, threshold: number): Metrics {
  let fySum = 0, ytdPlan = 0, ytdPlanReported = 0, ytdActual = 0, projection = 0, committed = 0, remainingPlan = 0, missing = 0, missingLast = 0, expectedLast = 0;
  for (const p of months) {
    const v = vals[p];
    if (!v) continue;
    fySum += v.plan ?? 0;
    const closed = lastClosed != null && p <= lastClosed;
    if (closed) {
      ytdPlan += v.plan ?? 0;
      if (v.actual != null) { ytdActual += v.actual; ytdPlanReported += v.plan ?? 0; }
      const est = v.actual ?? v.forecast ?? v.plan ?? 0;
      projection += est; committed += est;
      const expected = (v.plan ?? 0) !== 0 || (v.forecast ?? 0) !== 0;
      if (expected && v.actual == null) { missing++; if (p === lastClosed) missingLast++; }
      if (p === lastClosed && (expected || v.actual != null)) expectedLast++;
    } else {
      projection += v.forecast ?? v.plan ?? 0;
      remainingPlan += v.plan ?? 0;
    }
  }
  const fyPlan = annual ?? fySum;
  const variance = ytdActual - ytdPlanReported;
  const impact = impactOf(direction, ytdPlanReported, ytdActual);
  const impactPct = ytdPlanReported ? impact / Math.abs(ytdPlanReported) : null;
  const gap = projection - fyPlan;
  const gapImpact = impactOf(direction, fyPlan, projection);
  const gapImpactPct = fyPlan ? gapImpact / Math.abs(fyPlan) : null;
  return {
    fyPlan, ytdPlan, ytdPlanReported, ytdActual, variance, impact, impactPct, projection, committed, remainingPlan, gap, gapImpact, gapImpactPct,
    missing, missingLast, expectedLast, status: statusFrom(impactPct, threshold, gapImpactPct),
  };
}

function sumMetrics(list: Metrics[], threshold: number): Metrics {
  const s = (k: keyof Metrics) => list.reduce((a, m) => a + ((m[k] as number) ?? 0), 0);
  const ytdPlanReported = s("ytdPlanReported"), impact = s("impact"), fyPlan = s("fyPlan"), gapImpact = s("gapImpact");
  const impactPct = ytdPlanReported ? impact / Math.abs(ytdPlanReported) : null;
  const gapImpactPct = fyPlan ? gapImpact / Math.abs(fyPlan) : null;
  return {
    fyPlan, ytdPlan: s("ytdPlan"), ytdPlanReported, ytdActual: s("ytdActual"), variance: s("variance"), impact, impactPct,
    projection: s("projection"), committed: s("committed"), remainingPlan: s("remainingPlan"), gap: s("gap"), gapImpact, gapImpactPct,
    missing: s("missing"), missingLast: s("missingLast"), expectedLast: s("expectedLast"), status: statusFrom(impactPct, threshold, gapImpactPct),
  };
}

/** Last fully closed month of the cycle (null before the plan year starts). */
export function closedThrough(cycle: Pick<Cycle, "fy_start" | "months">, ref = today()) {
  const months = cycleMonths(cycle.fy_start, cycle.months);
  const lc = addMonths(monthStart(ref), -1);
  if (lc < months[0]) return null;
  return lc > months[months.length - 1] ? months[months.length - 1] : lc;
}

export const loadModel = cache(async (cycleId: string): Promise<Model | null> => {
  const cycle = await resolveCycle(cycleId);
  if (!cycle) return null;
  const [sections, items, values, owners, counts, rule] = await Promise.all([
    q<{ id: string; name: string; kind: SectionNode["kind"]; parent_id: string | null; owner_id: string | null; owner_name: string | null; owner_label: string | null; sort: number }>(
      `select s.id, s.name, s.kind, s.parent_id, s.owner_id, u.name as owner_name, s.owner_label, s.sort
       from aop_sections s left join users u on u.id = s.owner_id where s.cycle_id = $1 order by s.sort, s.name`, [cycle.id]),
    q<{ id: string; name: string; section_id: string; metric: string | null; unit: ItemRow["unit"]; direction: Direction; owner_id: string | null; owner_name: string | null; annual_target: number | null; confidence: string | null; reference: string | null; attributes: { note?: string } | null; sort: number }>(
      `select i.id, i.name, i.section_id, i.metric, i.unit, i.direction, i.owner_id, u.name as owner_name, i.annual_target, i.confidence, i.reference, i.attributes, i.sort
       from aop_items i left join users u on u.id = i.owner_id where i.cycle_id = $1 and i.active order by i.sort, i.name`, [cycle.id]),
    q<{ item_id: string; period: string; plan: number | null; forecast: number | null; actual: number | null }>(
      `select v.item_id, v.period, v.plan, v.forecast, v.actual from aop_period_values v join aop_items i on i.id = v.item_id where i.cycle_id = $1`, [cycle.id]),
    q<{ section_id: string | null; item_id: string | null; user_id: string; name: string; role: string }>(
      `select o.section_id, o.item_id, o.user_id, u.name, o.role from aop_owners o join users u on u.id = o.user_id
       left join aop_sections s on s.id = o.section_id left join aop_items i on i.id = o.item_id
       where coalesce(s.cycle_id, i.cycle_id) = $1`, [cycle.id]),
    q<{ item_id: string; comments: number; open_tasks: number }>(
      `select i.id as item_id,
         (select count(*)::int from aop_comments c where c.item_id = i.id) as comments,
         (select count(*)::int from tasks t where t.aop_item_id = i.id and t.status not in ('completed','cancelled')) as open_tasks
       from aop_items i where i.cycle_id = $1`, [cycle.id]),
    one<{ rule: { threshold?: number } }>(`select rule from insight_rules where key = 'aop.overspend'`),
  ]);
  const threshold = Number(rule?.rule?.threshold ?? 0.05) || 0.05;
  const months = cycleMonths(cycle.fy_start, cycle.months);
  const currentMonth = monthStart(today());
  const lastClosed = closedThrough(cycle);
  const closed = lastClosed ? months.filter((m) => m <= lastClosed) : [];
  const remaining = months.filter((m) => !lastClosed || m > lastClosed);

  const sectionById = new Map<string, SectionNode>();
  for (const s of sections) sectionById.set(s.id, { ...s, contributors: [], children: [], items: [], m: null as unknown as Metrics, monthly: {}, fn: null });
  const functions: SectionNode[] = [];
  for (const s of sectionById.values()) {
    const parent = s.parent_id ? sectionById.get(s.parent_id) : null;
    if (parent) parent.children.push(s); else functions.push(s);
  }
  const setFn = (n: SectionNode, fn: SectionNode) => { n.fn = fn; n.children.forEach((c) => setFn(c, fn)); };
  functions.forEach((f) => setFn(f, f));
  for (const o of owners) if (o.section_id) sectionById.get(o.section_id)?.contributors.push({ id: o.user_id, name: o.name, role: o.role });

  const valsBy = new Map<string, Record<string, Vals>>();
  for (const v of values) {
    const r = valsBy.get(v.item_id) ?? {};
    r[v.period] = { plan: v.plan, forecast: v.forecast, actual: v.actual };
    valsBy.set(v.item_id, r);
  }
  const countBy = new Map(counts.map((c) => [c.item_id, c]));
  const itemOwners = new Map<string, string[]>();
  for (const o of owners) if (o.item_id) itemOwners.set(o.item_id, [...(itemOwners.get(o.item_id) ?? []), o.user_id]);

  const itemRows: ItemRow[] = [];
  for (const i of items) {
    const sec = sectionById.get(i.section_id);
    if (!sec) continue;
    const vals = valsBy.get(i.id) ?? {};
    const row: ItemRow = {
      id: i.id, name: i.name, section_id: i.section_id, function_id: sec.fn!.id, group_id: sec.kind === "function" ? null : sec.id,
      metric: i.metric, unit: i.unit, direction: i.direction, owner_id: i.owner_id ?? sec.owner_id, owner_name: i.owner_name ?? sec.owner_name,
      annual_target: i.annual_target, confidence: i.confidence, reference: i.reference, note: i.attributes?.note ?? null, sort: i.sort,
      vals, m: computeMetrics(vals, months, lastClosed, i.direction, i.annual_target, threshold),
      comments: countBy.get(i.id)?.comments ?? 0, openTasks: countBy.get(i.id)?.open_tasks ?? 0, contributors: itemOwners.get(i.id) ?? [],
    };
    sec.items.push(row);
    itemRows.push(row);
  }

  const rollup = (n: SectionNode): Metrics => {
    const parts = [...n.items.map((i) => i.m), ...n.children.map(rollup)];
    n.m = sumMetrics(parts, threshold);
    const monthly: Record<string, Vals> = {};
    for (const p of months) {
      let v = emptyVals();
      for (const i of n.items) { const x = i.vals[p]; if (x) v = { plan: add(v.plan, x.plan), forecast: add(v.forecast, x.forecast), actual: add(v.actual, x.actual) }; }
      for (const c of n.children) { const x = c.monthly[p]; if (x) v = { plan: add(v.plan, x.plan), forecast: add(v.forecast, x.forecast), actual: add(v.actual, x.actual) }; }
      monthly[p] = v;
    }
    n.monthly = monthly;
    return n.m;
  };
  const totals = sumMetrics(functions.map(rollup), threshold);
  const monthly: Record<string, Vals> = {};
  for (const p of months) {
    let v = emptyVals();
    for (const f of functions) { const x = f.monthly[p]; v = { plan: add(v.plan, x.plan), forecast: add(v.forecast, x.forecast), actual: add(v.actual, x.actual) }; }
    monthly[p] = v;
  }
  const dirCount = itemRows.reduce((a, i) => a + (i.direction === "lower_better" ? 1 : -1), 0);
  const direction: Direction = itemRows.length ? (dirCount >= 0 ? "lower_better" : "higher_better") : cycle.kind === "revenue" ? "higher_better" : "lower_better";
  return { cycle, months, currentMonth, lastClosed, closed, remaining, threshold, direction, functions, sectionById, items: itemRows, itemById: new Map(itemRows.map((i) => [i.id, i])), totals, monthly };
});

/* ---------- permissions ---------- */

/** Sections (and ancestors) a user owns or contributes to. */
function sectionChain(m: Model, sectionId: string): SectionNode[] {
  const out: SectionNode[] = [];
  let s = m.sectionById.get(sectionId);
  while (s) { out.push(s); s = s.parent_id ? m.sectionById.get(s.parent_id) : undefined; }
  return out;
}
export function ownsItem(m: Model, userId: string, item: ItemRow) {
  if (item.owner_id === userId || item.contributors.includes(userId)) return true;
  return sectionChain(m, item.section_id).some((s) => s.owner_id === userId || s.contributors.some((c) => c.id === userId));
}
/** Items a user may edit forecast/actual/commentary on. Managers: all. */
export function editableItemIds(m: Model, u: Pick<User, "id" | "role">): Set<string> {
  if (canManage(u)) return new Set(m.items.map((i) => i.id));
  if (!canEdit(u)) return new Set();
  return new Set(m.items.filter((i) => ownsItem(m, u.id, i)).map((i) => i.id));
}
export function canEditField(m: Model, u: Pick<User, "id" | "role">, item: ItemRow, field: "plan" | "forecast" | "actual" | "comment") {
  if (canManage(u)) return true;
  if (!canEdit(u) || field === "plan") return false;
  return ownsItem(m, u.id, item);
}

/** Owner of a function for input collection: section owner, else first contributor. */
export const sectionOwner = (s: SectionNode) => (s.owner_id ? { id: s.owner_id, name: s.owner_name ?? "" } : s.contributors[0] ? { id: s.contributors[0].id, name: s.contributors[0].name } : null);
export const allItemsOf = (s: SectionNode): ItemRow[] => [...s.items, ...s.children.flatMap(allItemsOf)];
