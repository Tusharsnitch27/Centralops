import Link from "next/link";
import { CheckCircle2, CircleAlert, Info, OctagonAlert } from "lucide-react";
import { Avatar, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { CreateTaskButton, ReminderButton, RequestUpdateButton } from "@/components/aop/Actions";
import { RulesEditor } from "@/components/aop/RulesEditor";
import { requireUser, canManage } from "@/server/auth";
import { listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { evaluate, listRules, METRIC_KINDS, type Insight, type Severity } from "@/server/aop/insights";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Insights" };

const SEV: Record<Severity, { label: string; icon: React.ReactNode; dot: string }> = {
  critical: { label: "Critical", icon: <OctagonAlert size={15} className="text-bad" />, dot: "bg-bad" },
  warning: { label: "Warning", icon: <CircleAlert size={15} className="text-warn" />, dot: "bg-warn" },
  info: { label: "For information", icon: <Info size={15} className="text-info" />, dot: "bg-info" },
};

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const m = (await loadModel(cycle.id))!;
  const rules = await listRules();
  const insights = evaluate(m, rules);
  const manage = canManage(user);
  const bySev = (["critical", "warning", "info"] as Severity[]).map((s) => [s, insights.filter((i) => i.severity === s)] as const);
  const qs = cycleQs(cycle.id, cycles);

  return (
    <div className="animate-fade-in">
      <AopHeader active="insights" cycleId={cycle.id} cycles={cycles} title="Insights"
        subtitle={`${insights.length} signals from ${rules.filter((r) => r.enabled).length} enabled rules · evaluated live against the plan`}
        counts={{ insights: bySev[0][1].length }} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {!insights.length && <Card><EmptyState icon={<CheckCircle2 size={18} />} title="All clear" body="No enabled rule is breached. Tighten thresholds on the right if this feels too quiet." /></Card>}
          {bySev.filter(([, list]) => list.length).map(([sev, list]) => (
            <Card key={sev}>
              <CardHeader title={<span className="flex items-center gap-2">{SEV[sev].icon}{SEV[sev].label}<span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-ink-2">{list.length}</span></span>} />
              {list.map((i) => <InsightRow key={i.key} i={i} cycleId={cycle.id} period={m.lastClosed} manage={manage} />)}
            </Card>
          ))}
        </div>
        <div>
          <RulesEditor rules={rules} metrics={METRIC_KINDS} canEdit={manage} />
          <p className="mt-3 px-1 text-[12px] leading-relaxed text-ink-3">Rules are data: thresholds, look-back periods and severities apply on the next page load. Direction is read from each line, so the same rules work for cost (overspend) and revenue (shortfall) plans. <Link href={`/aop${qs}`} className="text-ink-2 underline decoration-line-strong">Back to overview</Link></p>
        </div>
      </div>
    </div>
  );
}

function InsightRow({ i, cycleId, period, manage }: { i: Insight; cycleId: string; period: string | null; manage: boolean }) {
  return (
    <div className="group border-b border-line/70 px-4 py-3.5 last:border-0">
      <div className="flex items-start gap-3">
        <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", SEV[i.severity].dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <Link href={i.entity.href} className="text-[13px] font-medium text-ink hover:underline">{i.title}</Link>
            <span className="text-[11px] text-ink-4">{i.ruleName}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{i.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {i.metrics.map((x) => (
              <span key={x.label} className="text-[12px]"><span className="text-ink-4">{x.label} </span><span className="tabular text-ink-2">{x.value}</span></span>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-2">
              {i.ownerName && <Avatar name={i.ownerName} size={16} />}<span className="text-ink-3">Suggested:</span> {i.suggestedAction}
            </span>
            {manage && (i.itemId || i.sectionId) && <CreateTaskButton itemId={i.itemId} sectionId={i.itemId ? null : i.sectionId ?? null} ownerId={i.ownerId} defaultTitle={taskTitle(i)} context={i.title} variant="secondary" />}
            {manage && i.itemId && i.ownerId && <RequestUpdateButton itemId={i.itemId} variant="ghost" />}
            {manage && !i.itemId && i.sectionId && i.ownerId && period && i.ruleKey.includes("missing") && <ReminderButton cycleId={cycleId} sectionId={i.sectionId} period={period} kind="actuals" label="Request update" />}
            <ButtonLink href={i.entity.href} size="xs" variant="ghost">{i.entity.type === "aop_item" ? "View line" : "View"}</ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}

const taskTitle = (i: Insight) =>
  i.ruleKey.includes("missing") ? `Submit pending actuals · ${i.entity.name}`
    : i.ruleKey.includes("provision") ? `Tighten provisioning · ${i.entity.name}`
      : i.ruleKey.includes("run_rate") ? `Recovery plan · ${i.entity.name}`
        : `Corrective action · ${i.entity.name}`;
