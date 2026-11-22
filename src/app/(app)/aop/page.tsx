import { Target } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { MonthSummary } from "@/components/aop/MonthSummary";
import { VarianceGrid } from "@/components/aop/VarianceGrid";
import { requireUser } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { summaryTree } from "@/server/aop/summaryData";
import { costMasterDiffs } from "@/server/aop/costMasterSync";
import { monLabel } from "@/server/aop/calc";
import { inr } from "@/lib/format";
import { addMonths } from "@/lib/dates";
import { storageView } from "@/server/wcm/storage";
import { UnitCosts } from "@/components/aop/UnitCosts";

export const metadata = { title: "AOP" };

export default async function AopSummary({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <NoCycle />;
  const m = (await loadModel(cycle.id))!;
  const last = m.lastClosed ?? null;
  const recent = last ? [addMonths(last, -2), addMonths(last, -1), last] : [];
  const [tree, diffs, storage] = await Promise.all([summaryTree(m), costMasterDiffs(), recent.length ? storageView(recent) : Promise.resolve(null)]);
  const T = m.totals;
  const qs = cycleQs(cycle.id, cycles);
  return (
    <div className="animate-fade-in">
      <AopHeader active="overview" cycleId={cycle.id} cycles={cycles} title={cycle.name}
        subtitle={<>FY {cycle.labels.plan.toLowerCase()} {inr(T.fyPlan)} across {m.functions.length} functions{m.lastClosed ? <> · books closed through {monLabel(m.lastClosed)}</> : null}</>} />
      <MonthSummary tree={tree} reviewHref={`/aop/review${qs}`}
        unitCosts={storage ? <UnitCosts months={storage.months} href={`/aop/warehouse${qs}`} /> : null}
        more={<>
          <VarianceGrid tree={tree} />
          {diffs.length > 0 && (
            <div className="card overflow-x-auto">
              <div className="px-4 pt-3 text-[13px] font-semibold">{diffs.length} owner figure{diffs.length === 1 ? "" : "s"} differ from the Cost Master</div>
              <p className="px-4 text-[11.5px] text-ink-4">Warehousing, manpower / OT and packaging read from the Warehouse Cost Master; a figure an owner entered in the app is kept. Review these with the owner.</p>
              <table className="table-base mt-2 min-w-[720px]">
                <thead><tr><th>Line</th><th>Month</th><th>Field</th><th className="text-right">Owner entered</th><th className="text-right">Cost Master</th><th className="text-right">Difference</th></tr></thead>
                <tbody>{diffs.map((d) => (
                  <tr key={`${d.section}|${d.item}|${d.period}|${d.field}`}>
                    <td><span className="font-medium">{d.item}</span> <span className="text-ink-4">· {d.section}</span></td><td className="tabular">{monLabel(d.period)}</td>
                    <td>{d.field === "plan" ? cycle.labels.plan : cycle.labels.actual}</td>
                    <td className="text-right tabular">{inr(d.owner)}</td><td className="text-right tabular">{inr(d.costMaster)}</td>
                    <td className="text-right tabular">{d.owner == null ? "—" : inr(d.owner - d.costMaster, { sign: true })}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>} />
    </div>
  );
}

function NoCycle() {
  return (
    <EmptyState icon={<Target size={18} />} title="No operating plan yet" body="Import your plan workbook or set up a cycle to start tracking budget, provisions and actuals."
      action={<div className="flex gap-2"><ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink><ButtonLink href="/aop/setup">Set up cycle</ButtonLink></div>} />
  );
}
