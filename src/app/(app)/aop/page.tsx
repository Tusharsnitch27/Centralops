import { Target } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { MonthSummary } from "@/components/aop/MonthSummary";
import { requireUser } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { summaryTree } from "@/server/aop/summaryData";
import { monLabel } from "@/server/aop/calc";
import { inr } from "@/lib/format";
import { addMonths } from "@/lib/dates";
import { storageView } from "@/server/wcm/storage";
import { UnitCosts } from "@/components/aop/UnitCosts";
import { monthHistory } from "@/server/wcm/dayCost";

export const metadata = { title: "AOP" };

export default async function AopSummary({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <NoCycle />;
  const m = (await loadModel(cycle.id))!;
  const last = m.lastClosed ?? null;
  const recent = last ? [addMonths(last, -2), addMonths(last, -1), last] : [];
  const [tree, hist, storage] = await Promise.all([summaryTree(m), monthHistory(), recent.length ? storageView(recent) : Promise.resolve(null)]);
  const T = m.totals;
  const qs = cycleQs(cycle.id, cycles);
  return (
    <div className="animate-fade-in">
      <AopHeader active="overview" cycleId={cycle.id} cycles={cycles} title={cycle.name}
        subtitle={<>FY {cycle.labels.plan.toLowerCase()} {inr(T.fyPlan)} across {m.functions.length} functions{m.lastClosed ? <> · books closed through {monLabel(m.lastClosed)}</> : null}</>} />
      <MonthSummary tree={tree} reviewHref={`/aop/review${qs}`}
        unitCosts={storage ? <UnitCosts months={storage.months} href={`/aop/warehouse${qs}`} cps={hist.filter((h) => h.complete).slice(-3)} cpsHref={`/aop/cost${qs}`} /> : null}
        more={null} />
    </div>
  );
}

function NoCycle() {
  return (
    <EmptyState icon={<Target size={18} />} title="No operating plan yet" body="Import your plan workbook or set up a cycle to start tracking budget, provisions and actuals."
      action={<div className="flex gap-2"><ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink><ButtonLink href="/aop/setup">Set up cycle</ButtonLink></div>} />
  );
}
