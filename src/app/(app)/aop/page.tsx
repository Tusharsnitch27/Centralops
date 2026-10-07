import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ClipboardList, Gavel, Inbox, Sparkles, Target, TrendingUp } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { AopStatusBadge, Meter, Variance } from "@/components/aop/bits";
import { MonthlyChart } from "@/components/aop/Charts";
import { CreateTaskButton, ReminderButton, RemindAllButton } from "@/components/aop/Actions";
import { requireUser, canManage } from "@/server/auth";
import { listCycles, loadModel, resolveCycle, sectionOwner, type ItemRow, type Model } from "@/server/aop/model";
import { inputPeriod } from "@/server/aop/inputs";
import { insightsFor, type Insight } from "@/server/aop/insights";
import { correctiveActions, decisionsRequired, remindersSent } from "@/server/aop/queries";
import { goodWord, monLabel, ratioWord, STATUS_META, varianceWord } from "@/server/aop/calc";
import { fmtDate, relDay, today } from "@/lib/dates";
import { inr, pct, plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP" };

export default async function AopOverview({ searchParams }: { searchParams: Promise<{ cycle?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <NoCycle />;
  const m = (await loadModel(cycle.id))!;
  const [insights, inputs, corrective, decisions, reminders] = await Promise.all([
    insightsFor(m), m.lastClosed ? inputPeriod(m, m.lastClosed, "actuals") : null, correctiveActions(cycle.id, 6), decisionsRequired(5), remindersSent(cycle.id),
  ]);
  const L = cycle.labels, T = m.totals, dir = m.direction;
  const manage = canManage(user);
  const qs = (extra = "") => cycleQs(cycle.id, cycles, extra);
  const td = today();

  const n = m.remaining.length;
  const required = n ? (T.fyPlan - T.committed) / n : null;
  const plannedRate = n ? T.remainingPlan / n : null;
  const util = T.ytdPlan ? T.ytdActual / T.ytdPlan : null;
  const lastName = m.lastClosed ? monLabel(m.lastClosed) : null;
  const pending = inputs?.functions.filter((f) => f.status === "partial" || f.status === "not_started") ?? [];
  const sentTo = new Set(reminders.map((r) => r.entity_id));

  const material = (i: ItemRow) => Math.abs(i.m.impact) >= Math.max(5000, Math.abs(T.ytdPlan) * 0.0005);
  const negatives = m.items.filter((i) => i.m.impact < 0 && material(i)).sort((a, b) => a.m.impact - b.m.impact).slice(0, 6);
  const positives = m.items.filter((i) => i.m.impact > 0 && material(i)).sort((a, b) => b.m.impact - a.m.impact).slice(0, 6);
  const atRisk = m.items.filter((i) => i.m.gapImpactPct != null && i.m.gapImpactPct < -m.threshold && i.m.gapImpact < 0 && Math.abs(i.m.gapImpact) >= 10000)
    .sort((a, b) => a.m.gapImpact - b.m.gapImpact).slice(0, 6);
  const rank = { delayed: 0, at_risk: 1, on_track: 2 } as const;
  const fns = [...m.functions].sort((a, b) => rank[a.m.status] - rank[b.m.status] || a.m.impact - b.m.impact);
  const fnsAtRisk = fns.filter((f) => f.m.status !== "on_track").length;
  const inputsBy = new Map(inputs?.functions.map((f) => [f.sectionId, f]) ?? []);
  const chart = m.months.map((p) => ({ period: p, label: monLabel(p).slice(0, 3), ...m.monthly[p], closed: !!m.lastClosed && p <= m.lastClosed }));
  const fav = T.impact >= 0, projFav = T.gapImpact >= 0;
  const sectionName = (i: ItemRow) => { const s = m.sectionById.get(i.section_id)!; return s.fn && s.fn.id !== s.id ? `${s.fn.name} › ${s.name}` : s.name; };

  return (
    <div className="animate-fade-in">
      <AopHeader active="overview" cycleId={cycle.id} cycles={cycles} title={cycle.name}
        counts={{ inputs: pending.length, insights: insights.filter((i) => i.severity === "critical").length }}
        subtitle={lastName ? <>Closed through {lastName} · {m.remaining.length} months to go{inputs ? <> · {lastName} {L.actual.toLowerCase()} due {relDay(inputs.dueDate).toLowerCase()}</> : null}</> : "Plan year hasn't started"}
        actions={<ButtonLink href={`/aop/plan${qs()}`} variant="primary">Open plan <ArrowRight size={14} /></ButtonLink>} />

      {/* ---------- Outcome ---------- */}
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <p className="max-w-[880px] text-[13.5px] leading-relaxed text-ink-2">
            <AopStatusBadge status={T.status} className="mr-2 align-[1px]" />
            YTD <b className="font-semibold text-ink">{inr(Math.abs(T.impact))} {varianceWord(dir, L, fav).toLowerCase()}</b> on reported lines
            {" "}· full year projected at <b className="font-semibold text-ink">{inr(T.projection)}</b>, {inr(Math.abs(T.gapImpact))} {varianceWord(dir, L, projFav).toLowerCase()}.
            {inputs && inputs.updated < inputs.total && <> {lastName} {L.actual.toLowerCase()} in for <b className="font-semibold text-ink">{inputs.updated} of {inputs.total}</b> lines.</>}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-line md:grid-cols-3 xl:grid-cols-6 xl:divide-x [&>div]:px-5 [&>div]:py-4">
          <Kpi label={`FY ${L.plan.toLowerCase()}`} value={inr(T.fyPlan)} hint={`${plural(m.items.length, "line")} · ${m.functions.length} functions`} />
          <Kpi label={`YTD ${L.plan.toLowerCase()}`} value={inr(T.ytdPlan)} hint={lastName ? `Through ${lastName}` : "—"} />
          <Kpi label={`YTD ${L.actual.toLowerCase()}`} value={inr(T.ytdActual)}
            hint={<><span className="tabular text-ink-2">{pct(util, 0)}</span> {ratioWord(dir)}{T.ytdPlan > T.ytdPlanReported && <> · {inr(T.ytdPlan - T.ytdPlanReported)} unreported</>}</>} />
          <Kpi label="Variance (like-for-like)" value={<Variance variance={T.variance} base={T.ytdPlanReported} impact={T.impact} showPct={false} />}
            hint={<>{pct(T.ytdPlanReported ? T.variance / Math.abs(T.ytdPlanReported) : null, 1, true)} vs {L.plan.toLowerCase()}</>} />
          <Kpi label="FY projection" value={inr(T.projection)}
            hint={<><Variance variance={T.gap} base={T.fyPlan} impact={T.gapImpact} showPct={false} /> gap to {L.plan.toLowerCase()}</>} />
          <Kpi label="Required run-rate" value={required == null ? "—" : `${inr(Math.max(0, required))}`}
            hint={required == null ? "Plan year closed" : <>per month for {n} months{plannedRate != null && <> · plan {inr(plannedRate)}</>}</>} />
        </div>
      </Card>

      {/* ---------- Trend + what needs attention ---------- */}
      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title={`Monthly ${L.plan.toLowerCase()} vs ${L.forecast.toLowerCase()} vs ${L.actual.toLowerCase()}`} subtitle="All functions" icon={<TrendingUp size={15} />}
            action={<ButtonLink href={`/aop/plan${qs("measure=all")}`} size="xs" variant="ghost">View months</ButtonLink>} />
          <div className="px-4 pb-3 pt-3"><MonthlyChart data={chart} labels={L} height={250} /></div>
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Needs attention" subtitle={`${insights.length} signals from ${plural(new Set(insights.map((i) => i.ruleKey)).size, "rule")}`} icon={<Sparkles size={15} />}
            action={<ButtonLink href={`/aop/insights${qs()}`} size="xs" variant="ghost">All insights</ButtonLink>} />
          {insights.length ? (
            <div className="flex-1 divide-y divide-line/70">
              {insights.slice(0, 5).map((i) => <InsightLine key={i.key} i={i} />)}
            </div>
          ) : <EmptyState compact icon={<CheckCircle2 size={18} />} title="Nothing flagged" body="Every enabled rule is within threshold." />}
        </Card>
      </div>

      {/* ---------- Deviations ---------- */}
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <DeviationCard title={dir === "lower_better" ? `Top overspends` : "Biggest shortfalls"} icon={<ArrowUpRight size={15} className="text-bad" />} items={negatives} m={m} qs={qs} sectionName={sectionName}
          empty={`No line is ${varianceWord(dir, L, false).toLowerCase()} YTD.`} manage={manage} />
        <DeviationCard title={`Top ${goodWord(dir)}`} icon={<ArrowDownRight size={15} className="text-ok" />} items={positives} m={m} qs={qs} sectionName={sectionName}
          empty="No material favourable variance yet." manage={false} />
        <Card>
          <CardHeader title="Lines at risk" subtitle={`Projected to finish ${varianceWord(dir, L, false).toLowerCase()}`} icon={<AlertTriangle size={15} className="text-warn" />} />
          {atRisk.length ? atRisk.map((i) => (
            <Link key={i.id} href={`/aop/plan${qs(`item=${i.id}`)}`} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-subtle/60">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{i.name}</div>
                <div className="truncate text-[11.5px] text-ink-3">{sectionName(i)} · FY {inr(i.m.projection)} vs {inr(i.m.fyPlan)}</div>
              </div>
              <Variance variance={i.m.gap} base={i.m.fyPlan} impact={i.m.gapImpact} className="text-[12.5px]" />
            </Link>
          )) : <EmptyState compact title="No projected misses" body={`Every line's ${L.forecast.toLowerCase()} lands within ${L.plan.toLowerCase()}.`} />}
        </Card>
      </div>

      {/* ---------- Functions ---------- */}
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Functions {fnsAtRisk > 0 && <Badge tone="amber">{fnsAtRisk} need attention</Badge>}
        </h3>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {fns.map((f) => {
          const inp = inputsBy.get(f.id);
          const owner = sectionOwner(f);
          const u = f.m.ytdPlan ? f.m.ytdActual / f.m.ytdPlan : 0;
          const tone = STATUS_META[f.m.status].tone === "red" ? "red" : STATUS_META[f.m.status].tone === "amber" ? "amber" : "neutral";
          return (
            <Card key={f.id} className="group flex flex-col p-4 transition-colors hover:border-line-strong">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/aop/plan${qs(`fn=${f.id}`)}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">{f.name}</Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                    <Avatar name={owner?.name} size={16} />{f.owner_label ?? owner?.name ?? "No owner"}
                  </div>
                </div>
                <AopStatusBadge status={f.m.status} />
              </div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-serif text-[22px] leading-none tabular text-ink">{inr(f.m.ytdActual)}</span>
                <Variance variance={f.m.variance} base={f.m.ytdPlanReported} impact={f.m.impact} className="text-[12.5px]" />
              </div>
              <Meter value={u} tone={tone} marker={1} />
              <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
                <span>YTD {L.plan.toLowerCase()} {inr(f.m.ytdPlan)}</span><span>FY {inr(f.m.fyPlan)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[12px]">
                {inp ? (
                  <span className={cn("tabular", inp.late ? "text-bad" : inp.updated < inp.total ? "text-warn" : "text-ink-3")}>
                    {lastName} {L.actual.toLowerCase()} {inp.updated}/{inp.total}{inp.status === "submitted" ? " · submitted" : inp.late ? " · late" : ""}
                  </span>
                ) : <span className="text-ink-4">No inputs due</span>}
                {inp && inp.updated < inp.total && manage && m.lastClosed
                  ? <ReminderButton cycleId={cycle.id} sectionId={f.id} period={m.lastClosed} kind="actuals" label="Follow up" sent={sentTo.has(f.id)} />
                  : <Link href={`/aop/plan${qs(`fn=${f.id}`)}`} className="text-ink-3 hover:text-ink">View lines →</Link>}
              </div>
            </Card>
          );
        })}
      </div>

      {/* ---------- Actions ---------- */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Missing updates" subtitle={inputs ? `${lastName} ${L.actual.toLowerCase()} · due ${fmtDate(inputs.dueDate)}` : "No open period"} icon={<Inbox size={15} />}
            action={manage && m.lastClosed && pending.length > 0 ? <RemindAllButton cycleId={cycle.id} period={m.lastClosed} kind="actuals" sectionIds={pending.map((p) => p.sectionId)} size="xs" variant="secondary" /> : null} />
          {pending.length ? pending.map((f) => (
            <div key={f.sectionId} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0">
              <Avatar name={f.ownerName} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{f.ownerName ?? "Unassigned"} <span className="text-ink-3">· {f.name}</span></div>
                <div className={cn("text-[11.5px] tabular", f.late ? "text-bad" : "text-ink-3")}>{f.updated}/{f.total} lines · {f.late ? `late since ${fmtDate(f.dueDate)}` : `due ${relDay(f.dueDate).toLowerCase()}`}</div>
              </div>
              {manage && m.lastClosed && <ReminderButton cycleId={cycle.id} sectionId={f.sectionId} period={m.lastClosed} kind="actuals" label="Remind" sent={sentTo.has(f.sectionId)} />}
            </div>
          )) : <EmptyState compact icon={<CheckCircle2 size={18} />} title="All inputs in" body={inputs ? `Every function has updated ${lastName} ${L.actual.toLowerCase()}.` : undefined} />}
          <div className="border-t border-line px-4 py-2 text-right"><Link href={`/aop/inputs${qs()}`} className="text-[12px] text-ink-3 hover:text-ink">Input collection →</Link></div>
        </Card>
        <Card>
          <CardHeader title="Corrective actions" subtitle="Open tasks and committed actions on lines" icon={<ClipboardList size={15} />} />
          {corrective.length ? corrective.map((c) => (
            <Link key={`${c.kind}${c.id}`} href={c.kind === "task" ? `/tasks/${c.id}` : `/aop/plan${qs(`item=${c.itemId}`)}`} className="block border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-subtle/60">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.body}</span>
                {c.kind === "task" ? <Badge tone={c.due && c.due < td ? "red" : "neutral"}>{c.due ? (c.due < td ? "Overdue" : relDay(c.due)) : "Task"}</Badge>
                  : c.confidence ? <Badge tone={c.confidence === "low" ? "amber" : "muted"}>{c.confidence} confidence</Badge> : null}
              </div>
              <div className="truncate text-[11.5px] text-ink-3">{c.itemName}{c.who ? ` · ${c.who}` : ""}</div>
            </Link>
          )) : <EmptyState compact title="No corrective actions yet" body="Create one from any line that's off plan." action={negatives[0] && manage ? <CreateTaskButton itemId={negatives[0].id} ownerId={negatives[0].owner_id} defaultTitle={`Recover ${negatives[0].name} variance`} variant="secondary" /> : null} />}
        </Card>
        <Card>
          <CardHeader title="Decisions required" subtitle="Pending decisions on cost & plan" icon={<Gavel size={15} />} />
          {decisions.length ? decisions.map((d) => (
            <Link key={d.id} href={`/decisions?focus=${d.id}`} className="flex items-center gap-2 border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-subtle/60">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{d.title}</span>
              <span className={cn("text-[11.5px] tabular", d.due_date && d.due_date < td ? "text-bad" : "text-ink-3")}>{d.due_date ? relDay(d.due_date) : d.maker ?? ""}</span>
            </Link>
          )) : <EmptyState compact title="No decisions pending" body="Re-basing a line or approving a vendor change? Log it so it's tracked." action={<ButtonLink href="/decisions" size="xs" variant="secondary">Open decisions</ButtonLink>} />}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-line xl:border-b-0">
      <div className="eyebrow mb-1.5 truncate">{label}</div>
      <div className="whitespace-nowrap font-serif text-[23px] leading-none tracking-[-0.01em] tabular text-ink">{value}</div>
      {hint && <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

const SEV = { critical: "bg-bad", warning: "bg-warn", info: "bg-info" } as const;
function InsightLine({ i }: { i: Insight }) {
  return (
    <div className="group px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", SEV[i.severity])} />
        <div className="min-w-0 flex-1">
          <Link href={i.entity.href} className="line-clamp-2 text-[13px] leading-snug text-ink hover:underline">{i.title}</Link>
          <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{i.suggestedAction}</div>
        </div>
      </div>
    </div>
  );
}

function DeviationCard({ title, icon, items, m, qs, sectionName, empty, manage }: {
  title: string; icon: React.ReactNode; items: ItemRow[]; m: Model; qs: (x?: string) => string; sectionName: (i: ItemRow) => string; empty: string; manage: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={`YTD vs ${m.cycle.labels.plan.toLowerCase()}, reported months`} icon={icon} />
      {items.length ? items.map((i) => (
        <div key={i.id} className="group flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-subtle/60">
          <Link href={`/aop/plan${qs(`item=${i.id}`)}`} className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-ink">{i.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">{sectionName(i)} · {i.owner_name ?? "No owner"}</div>
          </Link>
          <div className="text-right">
            <Variance variance={i.m.variance} base={i.m.ytdPlanReported} impact={i.m.impact} className="block text-[12.5px]" showPct={false} />
            <span className="text-[11px] tabular text-ink-4">{pct(i.m.ytdPlanReported ? i.m.variance / Math.abs(i.m.ytdPlanReported) : null, 1, true)}</span>
          </div>
          {manage && <div className="hidden group-hover:block"><CreateTaskButton itemId={i.id} ownerId={i.owner_id} defaultTitle={`Bring ${i.name} back within ${m.cycle.labels.plan.toLowerCase()}`} label="Task" /></div>}
        </div>
      )) : <EmptyState compact title="Nothing here" body={empty} />}
    </Card>
  );
}

function NoCycle() {
  return (
    <EmptyState icon={<Target size={18} />} title="No operating plan yet" body="Import your plan workbook or set up a cycle to start tracking budget, provisions and actuals."
      action={<div className="flex gap-2"><ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink><ButtonLink href="/aop/setup">Set up cycle</ButtonLink></div>} />
  );
}
