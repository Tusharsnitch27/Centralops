import "server-only";
import type { AopStatus, Labels } from "./calc";
import { loadModel, resolveCycle } from "./model";
import { inputPeriod } from "./inputs";
import { insightsFor, type Insight } from "./insights";

/* Exports for the Command Centre and other modules. */

export interface AopHeadline {
  cycleId: string; cycleName: string; labels: Labels; kind: string;
  fyBudget: number; ytdBudget: number; ytdActual: number; variance: number; variancePct: number | null;
  projection: number; gap: number; status: AopStatus; lastClosed: string | null;
  missingInputs: { total: number; updated: number; sections: { id: string; name: string; owner_name: string | null; updated: number; total: number; due_date: string; late: boolean }[] };
  topDeviations: { itemId: string; name: string; section: string; variance: number; variancePct: number | null }[];
}

/** Headline for the active cycle (or the given one). variance = YTD actual − YTD plan on reported months (raw sign; read with labels/kind). */
export async function aopHeadline(cycleId?: string): Promise<AopHeadline | null> {
  const cycle = await resolveCycle(cycleId ?? null);
  if (!cycle) return null;
  const m = await loadModel(cycle.id);
  if (!m) return null;
  const T = m.totals;
  const inputs = m.lastClosed ? await inputPeriod(m, m.lastClosed, "actuals") : null;
  const top = [...m.items].filter((i) => i.m.impact < 0).sort((a, b) => a.m.impact - b.m.impact).slice(0, 5);
  return {
    cycleId: cycle.id, cycleName: cycle.name, labels: cycle.labels, kind: cycle.kind,
    fyBudget: T.fyPlan, ytdBudget: T.ytdPlan, ytdActual: T.ytdActual, variance: T.variance,
    variancePct: T.ytdPlanReported ? T.variance / Math.abs(T.ytdPlanReported) : null,
    projection: T.projection, gap: T.gap, status: T.status, lastClosed: m.lastClosed,
    missingInputs: {
      total: inputs?.total ?? 0, updated: inputs?.updated ?? 0,
      sections: (inputs?.functions ?? []).filter((f) => f.updated < f.total && f.status !== "submitted")
        .map((f) => ({ id: f.sectionId, name: f.name, owner_name: f.ownerName, updated: f.updated, total: f.total, due_date: f.dueDate, late: f.late })),
    },
    topDeviations: top.map((i) => ({
      itemId: i.id, name: i.name, section: m.sectionById.get(i.section_id)?.fn?.name ?? "", variance: i.m.variance,
      variancePct: i.m.ytdPlanReported ? i.m.variance / Math.abs(i.m.ytdPlanReported) : null,
    })),
  };
}

/** Top insights for the active cycle, strongest first. */
export async function aopInsights(limit = 5, cycleId?: string): Promise<Insight[]> {
  const cycle = await resolveCycle(cycleId ?? null);
  if (!cycle) return [];
  const m = await loadModel(cycle.id);
  if (!m) return [];
  return (await insightsFor(m)).slice(0, limit);
}
export type { Insight };
