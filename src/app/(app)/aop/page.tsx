import { Target } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { MonthSummary } from "@/components/aop/MonthSummary";
import { VarianceGrid } from "@/components/aop/VarianceGrid";
import { requireUser } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { summaryTree } from "@/server/aop/summaryData";
import { monLabel } from "@/server/aop/calc";
import { inr } from "@/lib/format";

export const metadata = { title: "AOP" };

export default async function AopSummary({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <NoCycle />;
  const m = (await loadModel(cycle.id))!;
  const tree = await summaryTree(m);
  const T = m.totals;
  return (
    <div className="animate-fade-in">
      <AopHeader active="overview" cycleId={cycle.id} cycles={cycles} title={cycle.name}
        subtitle={<>Opex · {m.functions.length} functions · FY {cycle.labels.plan.toLowerCase()} {inr(T.fyPlan)}{m.lastClosed ? <> · closed through {monLabel(m.lastClosed)}</> : null}</>} />
      <MonthSummary tree={tree} reviewHref={`/aop/review${cycleQs(cycle.id, cycles)}`} />
      <div className="mt-5"><VarianceGrid tree={tree} /></div>
    </div>
  );
}

function NoCycle() {
  return (
    <EmptyState icon={<Target size={18} />} title="No operating plan yet" body="Import your plan workbook or set up a cycle to start tracking budget, provisions and actuals."
      action={<div className="flex gap-2"><ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink><ButtonLink href="/aop/setup">Set up cycle</ButtonLink></div>} />
  );
}
