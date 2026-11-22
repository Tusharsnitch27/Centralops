import { EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { monLabel, Pickers } from "@/components/aop/processing/bits";
import { LeverPanel } from "@/components/aop/processing/LeverPanel";
import { processingMonths } from "@/components/aop/processing/months";
import { requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { processingMonth } from "@/server/aop/processing";
import { slaModel } from "@/server/wcm/sla";
import type { Wh } from "@/server/aop/processingTypes";

export const metadata = { title: "AOP · Levers" };

/** AOP › Levers: what a change in volume, productivity, salary or heads does to manpower, cost and SLA capacity. Not saved. */
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ month?: string; wh?: string; cycle?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, months] = await Promise.all([listCycles(), resolveCycle(sp.cycle), processingMonths()]);
  const header = <AopHeader active="analysis" cycleId={cycle?.id ?? null} cycles={cycles} title="Levers" />;
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  if (!month) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No processing data yet" /></div></div>;
  const wh = sp.wh === "South" || sp.wh === "North" ? sp.wh : "Both";
  const whs: Wh[] = wh === "Both" ? ["South", "North"] : [wh];
  const href = (o: { month?: string; wh?: string }) =>
    `/aop/analysis?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, wh, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const [pm, sla] = await Promise.all([Promise.all(whs.map((w) => processingMonth(month, w))), slaModel()]);
  return (
    <div className="animate-fade-in">
      {header}
      <Pickers months={months} month={month} wh={wh} href={href} />
      <div className="card"><LeverPanel sites={pm.map((x) => x.streams)} sla={sla} label={`${monLabel(month)} · ${wh}`} /></div>
    </div>
  );
}
