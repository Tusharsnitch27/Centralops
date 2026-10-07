import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { PlanGrid, type GridRow } from "@/components/aop/PlanGrid";
import { requireUser, canManage } from "@/server/auth";
import { editableItemIds, listCycles, loadModel, resolveCycle, sectionOwner, type Metrics, type SectionNode } from "@/server/aop/model";
import { monLabel } from "@/server/aop/calc";

export const metadata = { title: "AOP · Plan" };

const pick = (m: Metrics) => ({
  fyPlan: m.fyPlan, ytdPlan: m.ytdPlan, ytdPlanReported: m.ytdPlanReported, ytdActual: m.ytdActual, variance: m.variance, impact: m.impact,
  projection: m.projection, gap: m.gap, gapImpact: m.gapImpact, status: m.status, missingLast: m.missingLast,
});

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ cycle?: string; item?: string; fn?: string; measure?: string; mine?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const m = (await loadModel(cycle.id))!;
  const editable = editableItemIds(m, user);
  const manage = canManage(user);

  const rows: GridRow[] = [];
  const walk = (s: SectionNode, depth: number, fnId: string, parentId: string | null) => {
    const owner = s.kind === "function" ? sectionOwner(s) : s.owner_id ? { id: s.owner_id, name: s.owner_name ?? "" } : null;
    rows.push({
      kind: s.kind === "function" ? "function" : "group", id: s.id, parentId, fnId, depth, name: s.name, owner: s.kind === "function" ? s.owner_label ?? owner?.name ?? null : null,
      ownerId: owner?.id ?? null, vals: s.monthly, m: pick(s.m), comments: 0, openTasks: 0, editable: false, direction: m.direction, unit: "inr", confidence: null, note: null,
    });
    for (const c of s.children) walk(c, depth + 1, fnId, s.id);
    for (const i of s.items) rows.push({
      kind: "item", id: i.id, parentId: s.id, fnId, depth: depth + 1, name: i.name, owner: i.owner_name, ownerId: i.owner_id, vals: i.vals, m: pick(i.m),
      comments: i.comments, openTasks: i.openTasks, editable: editable.has(i.id), direction: i.direction, unit: i.unit, confidence: i.confidence, note: i.note,
    });
  };
  for (const f of m.functions) walk(f, 0, f.id, null);

  return (
    <div className="animate-fade-in">
      <AopHeader active="plan" cycleId={cycle.id} cycles={cycles} title="Operating plan"
        subtitle={<>{cycle.name} · closed through {m.lastClosed ? monLabel(m.lastClosed) : "—"} · {editable.size === m.items.length ? "you can edit every line" : editable.size ? `you can update ${editable.size} line${editable.size === 1 ? "" : "s"}` : "read-only"}</>} />
      <PlanGrid
        cycleId={cycle.id} labels={cycle.labels} months={m.months} lastClosed={m.lastClosed} currentMonth={m.currentMonth} threshold={m.threshold}
        rows={rows} canEditPlan={manage} userId={user.id} initialItem={sp.item ?? null} initialFn={sp.fn ?? null}
        initialMeasure={(["plan", "forecast", "actual", "variance", "all"].includes(sp.measure ?? "") ? sp.measure : "actual") as "actual"} initialMine={sp.mine === "1"}
        totals={{ vals: m.monthly, m: pick(m.totals) }}
      />
    </div>
  );
}
