import Link from "next/link";
import { CheckCircle2, ClipboardEdit, UserX } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { Meter } from "@/components/aop/bits";
import { ReminderButton, RemindAllButton } from "@/components/aop/Actions";
import { requireUser, canManage } from "@/server/auth";
import { listCycles, loadModel, ownsItem, resolveCycle } from "@/server/aop/model";
import { inputPeriod, openPeriods, type InputKind } from "@/server/aop/inputs";
import { remindersSent } from "@/server/aop/queries";
import { monLabel } from "@/server/aop/calc";
import { ago, fmtDate, relDay } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Inputs" };

const STATUS = {
  submitted: { label: "Submitted", tone: "green" },
  complete: { label: "All lines updated", tone: "green" },
  partial: { label: "In progress", tone: "amber" },
  not_started: { label: "Not started", tone: "neutral" },
  none: { label: "Nothing due", tone: "muted" },
} as const;

export default async function InputsPage({ searchParams }: { searchParams: Promise<{ cycle?: string; period?: string; kind?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const m = (await loadModel(cycle.id))!;
  const L = cycle.labels;
  const opens = openPeriods(m);
  const kind: InputKind = sp.kind === "projections" ? "projections" : sp.kind === "actuals" ? "actuals" : opens[0]?.kind ?? "actuals";
  const period = sp.period && m.months.includes(sp.period) ? sp.period : opens.find((o) => o.kind === kind)?.period ?? opens[0]?.period ?? m.months[0];
  const periods = opens.some((o) => o.period === period && o.kind === kind) ? opens : [...opens, { period, kind }];
  const [cur, all, reminders] = await Promise.all([inputPeriod(m, period, kind), Promise.all(periods.map((o) => inputPeriod(m, o.period, o.kind))), remindersSent(cycle.id)]);
  const lastReminder = new Map(reminders.map((r) => [r.entity_id, r.created_at]));
  const manage = canManage(user);
  const qs = (extra = "") => cycleQs(cycle.id, cycles, extra);
  const what = (k: InputKind) => (k === "actuals" ? L.actual : L.forecast);
  const pending = cur.functions.filter((f) => f.status === "partial" || f.status === "not_started");
  const noOwner = cur.functions.filter((f) => !f.ownerId);
  const owners = [...new Map(cur.functions.filter((f) => f.ownerId).map((f) => [f.ownerId!, f.ownerName ?? ""])).entries()];
  const mine = m.items.some((i) => ownsItem(m, user.id, i));
  const pctDone = cur.total ? cur.updated / cur.total : 0;

  return (
    <div className="animate-fade-in">
      <AopHeader active="inputs" cycleId={cycle.id} cycles={cycles} title="Input collection"
        subtitle={`${L.actual} for a closed month are due by the ${cycle.actuals_cutoff_day}th of the next month; ${L.forecast.toLowerCase()}s by the ${cycle.projection_cutoff_day}th of the month before.`}
        actions={mine ? <ButtonLink variant="primary" href={`/aop/inputs/submit${qs(`period=${period}&kind=${kind}&owner=${user.id}`)}`}><ClipboardEdit size={14} />Submit my inputs</ButtonLink> : undefined} />

      {/* period switcher */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((p) => {
          const active = p.period === period && p.kind === kind;
          return (
            <Link key={`${p.kind}${p.period}`} href={`/aop/inputs${qs(`period=${p.period}&kind=${p.kind}`)}`}
              className={cn("card block p-4 transition-colors", active ? "border-ink/40 ring-1 ring-ink/10" : "hover:border-line-strong")}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink">{monLabel(p.period)} {what(p.kind).toLowerCase()}</span>
                {p.late ? <Badge tone="red">{p.late} late</Badge> : p.updated >= p.total ? <Badge tone="green">Complete</Badge> : <Badge tone="neutral">Due {relDay(p.dueDate).toLowerCase()}</Badge>}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-serif text-[24px] leading-none tabular text-ink">{p.updated}</span>
                <span className="text-[13px] tabular text-ink-3">/ {p.total} lines updated</span>
              </div>
              <div className="mt-2.5"><Meter value={p.total ? p.updated / p.total : 0} tone={p.late ? "red" : p.updated >= p.total ? "green" : "neutral"} /></div>
              <div className="mt-1.5 text-[11.5px] text-ink-3">Due {fmtDate(p.dueDate)}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="min-w-0">
          <CardHeader title={`${monLabel(period)} ${what(kind).toLowerCase()} by function`}
            subtitle={`${cur.updated} / ${cur.total} lines updated · ${Math.round(pctDone * 100)}% · due ${fmtDate(cur.dueDate)}`}
            action={manage && pending.length ? <RemindAllButton cycleId={cycle.id} period={period} kind={kind} sectionIds={pending.filter((f) => f.ownerId).map((f) => f.sectionId)} /> : null} />
          {cur.functions.length ? (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Function</th><th>Owner</th><th className="w-[180px]">Lines updated</th><th>Status</th><th>Due</th><th className="text-right">Action</th></tr></thead>
                <tbody>
                  {cur.functions.map((f) => {
                    const st = STATUS[f.status];
                    const sent = lastReminder.get(f.sectionId);
                    return (
                      <tr key={f.sectionId}>
                        <td>
                          <Link href={`/aop/plan${qs(`fn=${f.sectionId}&measure=${kind === "actuals" ? "actual" : "forecast"}`)}`} className="font-medium text-ink hover:underline">{f.name}</Link>
                          {f.missingItems.length > 0 && f.missingItems.length <= 3 && <div className="truncate text-[11.5px] text-ink-3">Missing: {f.missingItems.map((x) => x.name).join(", ")}</div>}
                          {f.missingItems.length > 3 && <div className="truncate text-[11.5px] text-ink-3">Missing: {f.missingItems.slice(0, 2).map((x) => x.name).join(", ")} +{f.missingItems.length - 2} more</div>}
                        </td>
                        <td><span className="flex items-center gap-2"><Avatar name={f.ownerName} size={22} /><span className="text-ink-2">{f.ownerLabel ?? f.ownerName ?? "—"}</span></span></td>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-[90px]"><Meter value={f.total ? f.updated / f.total : 0} tone={f.late ? "red" : f.updated >= f.total ? "green" : "neutral"} /></div>
                            <span className="tabular text-[12.5px] text-ink-2">{f.updated}/{f.total}</span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={f.late ? "red" : st.tone} dot>{f.late ? "Late" : st.label}</Badge>
                          {f.submittedAt && <div className="mt-0.5 text-[11px] text-ink-4">{ago(f.submittedAt)}</div>}
                        </td>
                        <td className={cn("tabular text-[12.5px]", f.late ? "text-bad" : "text-ink-3")}>{fmtDate(f.dueDate)}</td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            {(manage || f.ownerId === user.id) && f.ownerId && f.status !== "submitted" &&
                              <ButtonLink size="xs" variant="ghost" href={`/aop/inputs/submit${qs(`period=${period}&kind=${kind}&owner=${f.ownerId}`)}`}>Enter inputs</ButtonLink>}
                            {manage && f.ownerId && f.status !== "submitted" && f.status !== "complete" &&
                              <ReminderButton cycleId={cycle.id} sectionId={f.sectionId} period={period} kind={kind} sent={!!sent} />}
                          </div>
                          {sent && f.status !== "submitted" && <div className="mt-0.5 text-[11px] text-ink-4">Reminded {ago(sent)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState compact icon={<CheckCircle2 size={18} />} title="Nothing due for this period" body={`No lines carry a ${L.plan.toLowerCase()} for ${monLabel(period)}.`} />}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Waiting on" subtitle={`${pending.length} function${pending.length === 1 ? "" : "s"} still open`} />
            {pending.length ? pending.map((f) => (
              <div key={f.sectionId} className="flex items-center gap-2.5 border-b border-line/70 px-4 py-2.5 last:border-0">
                <Avatar name={f.ownerName} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{f.ownerName ?? "No owner"}</div>
                  <div className={cn("truncate text-[11.5px]", f.late ? "text-bad" : "text-ink-3")}>{f.name} · {f.total - f.updated} line{f.total - f.updated === 1 ? "" : "s"}</div>
                </div>
              </div>
            )) : <EmptyState compact icon={<CheckCircle2 size={18} />} title="Everyone's in" />}
          </Card>
          {noOwner.length > 0 && (
            <Card>
              <CardHeader title="Missing owners" icon={<UserX size={15} />} subtitle="Inputs can't be requested" action={manage ? <ButtonLink size="xs" href={`/aop/setup${qs()}`}>Assign</ButtonLink> : null} />
              {noOwner.map((f) => <div key={f.sectionId} className="border-b border-line/70 px-4 py-2 text-[13px] text-ink last:border-0">{f.name}</div>)}
            </Card>
          )}
          {manage && owners.length > 0 && (
            <Card>
              <CardHeader title="Enter inputs on behalf of" subtitle="Opens the owner's input form" />
              <div className="flex flex-wrap gap-1.5 p-3">
                {owners.map(([id, name]) => (
                  <ButtonLink key={id} size="xs" variant="subtle" href={`/aop/inputs/submit${qs(`period=${period}&kind=${kind}&owner=${id}`)}`}><Avatar name={name} size={16} />{name}</ButtonLink>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
