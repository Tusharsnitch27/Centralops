import Link from "next/link";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { InputsTable } from "@/components/aop/InputsTable";
import { RemindAllButton } from "@/components/aop/Actions";
import { requireUser, canManage } from "@/server/auth";
import { editableItemIds, listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { inputPeriod, type InputKind } from "@/server/aop/inputs";
import { inputConfig } from "@/server/aop/actions";
import { summaryTree } from "@/server/aop/summaryData";
import { monLabel, monShort } from "@/server/aop/calc";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Inputs" };

export default async function InputsPage({ searchParams }: { searchParams: Promise<{ cycle?: string; period?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const m = (await loadModel(cycle.id))!;
  const L = cycle.labels;
  const period = sp.period && m.months.includes(sp.period) ? sp.period : m.lastClosed ?? m.months[0];
  const kind: InputKind = m.lastClosed && period <= m.lastClosed ? "actuals" : "projections";
  const [tree, cfg, status] = await Promise.all([summaryTree(m), inputConfig(cycle.id), inputPeriod(m, period, kind)]);
  const manage = canManage(user);
  const editable = [...editableItemIds(m, user)];
  const statusBy = Object.fromEntries(status.functions.map((f) => [f.sectionId, { updated: f.updated, total: f.total, due: f.dueDate, late: f.late }]));
  const submitted = status.functions.filter((f) => f.status === "submitted").map((f) => f.sectionId);
  const pending = status.functions.filter((f) => f.status === "partial" || f.status === "not_started");
  const qs = (extra = "") => cycleQs(cycle.id, cycles, extra);

  return (
    <div className="animate-fade-in">
      <AopHeader active="inputs" cycleId={cycle.id} cycles={cycles} title="Inputs"
        subtitle={<>Enter {cfg.fields.filter((f) => f !== "commentary").map((f) => L[f as "plan"].toLowerCase()).join(", ")}{cfg.fields.includes("commentary") ? " and remarks" : ""} per line · {L.actual.toLowerCase()} due by the {cycle.actuals_cutoff_day}th, {L.forecast.toLowerCase()}s by the {cycle.projection_cutoff_day}th</>} />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-3">Month</span>
        {m.months.map((p) => (
          <Link key={p} href={`/aop/inputs${qs(`period=${p}`)}`} scroll={false}
            className={cn("h-7 rounded-lg px-2.5 text-[12.5px] leading-7 tabular ring-1 ring-inset transition-colors",
              p === period ? "bg-ink text-canvas ring-ink" : "text-ink-2 ring-line-strong hover:bg-subtle", m.lastClosed && p > m.lastClosed && p !== period && "text-ink-4")}>
            {monShort(p)}
          </Link>
        ))}
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
        <div>
          <div className="eyebrow">{monLabel(period)} · {kind === "actuals" ? L.actual : L.forecast}</div>
          <div className="mt-1 font-serif text-[24px] leading-none tabular">{status.updated}<span className="text-ink-4"> / {status.total}</span> <span className="font-sans text-[13px] text-ink-3">lines updated</span></div>
        </div>
        <div className="text-[12.5px] text-ink-3">Due {fmtDate(status.dueDate)}{status.late ? <span className="text-bad"> · {status.late} function{status.late === 1 ? "" : "s"} late</span> : null}</div>
        {manage && pending.length > 0 && (
          <div className="ml-auto"><RemindAllButton cycleId={cycle.id} period={period} kind={kind} sectionIds={pending.map((f) => f.sectionId)} size="sm" variant="secondary" /></div>
        )}
      </div>

      <InputsTable tree={tree} period={period} fields={cfg.fields} editable={editable} canEditPlan={manage || cfg.ownerCanEditPlan}
        submitted={submitted} statusBy={statusBy} />
    </div>
  );
}
