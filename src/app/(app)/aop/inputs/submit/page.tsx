import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { cycleQs } from "@/components/aop/AopNav";
import { InputsForm, type InputRow } from "@/components/aop/InputsForm";
import { requireUser, canManage } from "@/server/auth";
import { listCycles, loadModel, ownsItem, resolveCycle } from "@/server/aop/model";
import { dueFor, openPeriods, type InputKind } from "@/server/aop/inputs";
import { monLabel } from "@/server/aop/calc";
import { q } from "@/server/db";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Submit inputs" };

export default async function SubmitInputs({ searchParams }: { searchParams: Promise<{ cycle?: string; period?: string; kind?: string; owner?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" />;
  const m = (await loadModel(cycle.id))!;
  const manage = canManage(user);
  const opens = openPeriods(m);
  const kind: InputKind = sp.kind === "projections" ? "projections" : "actuals";
  const period = sp.period && m.months.includes(sp.period) ? sp.period : opens.find((o) => o.kind === kind)?.period ?? m.months[0];
  const qs = (extra = "") => cycleQs(cycle.id, cycles, extra);

  // owners who have lines in this cycle
  const ownerIds = new Map<string, string>();
  for (const s of m.sectionById.values()) {
    if (s.owner_id) ownerIds.set(s.owner_id, s.owner_name ?? "");
    for (const c of s.contributors) ownerIds.set(c.id, c.name);
  }
  for (const i of m.items) if (i.owner_id) ownerIds.set(i.owner_id, i.owner_name ?? "");
  let ownerId = sp.owner && (manage || sp.owner === user.id) ? sp.owner : user.id;
  if (!m.items.some((i) => ownsItem(m, ownerId, i)) && manage) ownerId = [...ownerIds.keys()].find((id) => id !== user.id) ?? ownerId;
  const ownerName = ownerIds.get(ownerId) ?? (ownerId === user.id ? user.name : "Owner");
  const lines = m.items.filter((i) => ownsItem(m, ownerId, i));
  const lastComments = lines.length ? await q<{ item_id: string; kind: string; body: string; confidence: string | null }>(
    `select distinct on (item_id, kind) item_id, kind, body, confidence from aop_comments where item_id = any($1::uuid[]) and period = $2 order by item_id, kind, created_at desc`,
    [lines.map((l) => l.id), period]) : [];
  const prev = m.months[m.months.indexOf(period) - 1];
  const rows: InputRow[] = lines.map((i) => {
    const s = m.sectionById.get(i.section_id)!;
    const v = i.vals[period] ?? { plan: null, forecast: null, actual: null };
    const c = (k: string) => lastComments.find((x) => x.item_id === i.id && x.kind === k);
    return {
      id: i.id, name: i.name, path: s.fn && s.fn.id !== s.id ? `${s.fn.name} › ${s.name}` : s.name, fnId: i.function_id,
      plan: v.plan, forecast: v.forecast, actual: v.actual, prevActual: prev ? i.vals[prev]?.actual ?? null : null, direction: i.direction,
      commentary: c("commentary")?.body ?? null, reason: c("variance_reason")?.body ?? null, corrective: c("corrective_action")?.body ?? null,
      confidence: (c("corrective_action")?.confidence ?? c("variance_reason")?.confidence ?? i.confidence) as InputRow["confidence"],
    };
  });
  const L = cycle.labels;

  return (
    <div className="animate-fade-in">
      <Link href={`/aop/inputs${qs(`period=${period}&kind=${kind}`)}`} className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={13} />Input collection</Link>
      <PageHeader eyebrow={cycle.name} title={`${monLabel(period)} ${kind === "actuals" ? L.actual.toLowerCase() : L.forecast.toLowerCase() + "s"}`}
        subtitle={<span className="flex items-center gap-1.5"><Avatar name={ownerName} size={18} />{ownerName} · {rows.length} line{rows.length === 1 ? "" : "s"} · due {fmtDate(dueFor(m, period, kind))}</span>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {opens.map((o) => (
          <Link key={o.kind + o.period} href={`/aop/inputs/submit${qs(`period=${o.period}&kind=${o.kind}&owner=${ownerId}`)}`}
            className={cn("h-8 rounded-lg px-3 text-[12.5px] leading-8 ring-1 ring-inset", o.period === period && o.kind === kind ? "bg-ink text-white ring-ink" : "text-ink-2 ring-line-strong hover:bg-subtle")}>
            {monLabel(o.period)} {o.kind === "actuals" ? L.actual.toLowerCase() : L.forecast.toLowerCase()}
          </Link>
        ))}
        {manage && ownerIds.size > 1 && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[12px] text-ink-3">Owner</span>
            {[...ownerIds.entries()].map(([id, name]) => (
              <ButtonLink key={id} size="xs" variant={id === ownerId ? "primary" : "ghost"} href={`/aop/inputs/submit${qs(`period=${period}&kind=${kind}&owner=${id}`)}`}>{name}</ButtonLink>
            ))}
          </div>
        )}
      </div>

      {rows.length ? (
        <InputsForm cycleId={cycle.id} period={period} kind={kind} ownerId={ownerId} rows={rows} labels={L} threshold={m.threshold}
          canActual={period <= m.currentMonth} prevLabel={prev ? monLabel(prev) : null} />
      ) : <EmptyState title="No lines to update" body={`${ownerName} doesn't own any lines in this plan. Assign owners in Setup.`} action={manage ? <ButtonLink href={`/aop/setup${qs()}`}>Open setup</ButtonLink> : null} />}
    </div>
  );
}
