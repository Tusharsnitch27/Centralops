import { requireSopOverview } from "@/server/sop/access";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { AccuracyText, DemoBadge, SubChip } from "@/components/sop/bits";
import { CopyTextButton, RemindAllButton } from "@/components/sop/actions";
import { buildReviewBrief } from "@/server/sop/review";
import { metricLabel } from "@/server/sop/model";
import { WH_LABEL } from "@/server/sop/queries";
import { dateOf, fmtDate, fmtMonth, fmtTime } from "@/lib/dates";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Callouts } from "@/components/sop/Callouts";
import { listCallouts } from "@/server/sop/capacityTools";
import { listPeople } from "@/server/core/people";
import { canEdit, requireUser } from "@/server/auth";

export const metadata = { title: "S&OP review pre-read" };

function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-8 py-6 first:border-t-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[17px] text-ink"><span className="mr-2 text-ink-4">{n}.</span>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default async function SopReview() {
  const [b, callouts, people, u] = await Promise.all([buildReviewBrief(), listCallouts(), listPeople(), requireSopOverview()]);
  const m = b.meeting;
  const openPrev = b.prevTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const closedPrev = b.prevTasks.filter((t) => t.status === "completed" || t.status === "cancelled");
  const pendingAll = b.inputs.flatMap((i) => i.pending);

  return (
    <div className="mx-auto max-w-[880px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-3">Generated from live S&amp;OP data — share before the review, decide in the room.</p>
        <div className="flex gap-2">
          {m && <ButtonLink href={`/meetings/${m.id}`} variant="ghost">Open meeting<ArrowRight size={13} /></ButtonLink>}
          <CopyTextButton text={b.text} />
        </div>
      </div>
      <Card className="mb-5 overflow-hidden">
        <div className="border-b border-line px-5 py-3"><h2 className="text-[14px] font-semibold">Review call-outs</h2><p className="text-[12px] text-ink-3">Raised in the S&amp;OP review — who owns each, and the task tracking it</p></div>
        <Callouts items={callouts} people={people.map((p) => ({ id: p.id, name: p.name }))} canEdit={canEdit(u)} />
      </Card>
      <Card className="overflow-hidden">
        <header className="border-b border-line bg-subtle/40 px-8 py-6">
          <div className="eyebrow mb-1.5">Pre-read</div>
          <h1 className="font-serif text-[22px] leading-tight text-ink">{m?.title ?? "Weekly S&OP Review"}</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {m ? <>{fmtDate(dateOf(m.starts_at), { dow: true })} · {fmtTime(m.starts_at)} · {m.attendees} attendees{m.mom_owner_name ? ` · MoM by ${m.mom_owner_name}` : ""}</> : "Not yet on the calendar"}
          </p>
          {m?.agenda && <p className="mt-3 whitespace-pre-line text-[13px] text-ink-2">{m.agenda}</p>}
        </header>

        <Section n={1} title="Previous review" aside={b.previous && <span className="text-[12px] text-ink-3">{fmtDate(dateOf(b.previous.starts_at), { dow: true })}</span>}>
          {!b.previous ? <p className="text-[13px] text-ink-3">No previous review on record.</p> : (
            <div className="space-y-4">
              {b.previous.summary && <p className="text-[13px] leading-relaxed text-ink-2">{b.previous.summary}</p>}
              {b.prevDecisions.length > 0 && (
                <div>
                  <div className="eyebrow mb-1.5">Decisions</div>
                  <ul className="space-y-1">{b.prevDecisions.map((d) => <li key={d.id} className="flex gap-2 text-[13px] text-ink"><span className="text-ink-4">—</span><Link href={"/meetings"} className="hover:underline">{d.title}</Link></li>)}</ul>
                </div>
              )}
              <div>
                <div className="mb-1.5 flex items-center gap-3">
                  <span className="eyebrow">Action closure</span>
                  <span className="text-[12.5px] tabular text-ink-2">{b.closure.closed} of {b.closure.total} closed</span>
                  {b.closure.overdue > 0 && <Badge tone="red">{b.closure.overdue} overdue</Badge>}
                  <div className="h-1 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full bg-ok" style={{ width: `${b.closure.total ? (b.closure.closed / b.closure.total) * 100 : 0}%` }} /></div>
                </div>
                <div className="rounded-lg border border-line"><TaskList tasks={[...openPrev, ...closedPrev]} showProject={false} empty={<p className="px-3 py-3 text-[13px] text-ink-3">No actions recorded.</p>} /></div>
              </div>
            </div>
          )}
        </Section>

        <Section n={2} title="Inputs" aside={pendingAll.length > 0 && <RemindAllButton periods={[...new Set(pendingAll.map((c) => c.period))]} count={pendingAll.length} label="Remind pending" variant="secondary" size="xs" />}>
          <div className="grid gap-4 sm:grid-cols-3">
            {b.inputs.map((i) => (
              <div key={i.period}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium text-ink">{fmtMonth(i.period)}</span>
                  <span className="text-[12px] tabular text-ink-3">{i.received.length}/{i.received.length + i.pending.length} in</span>
                </div>
                {i.due && <div className="text-[11.5px] text-ink-4">due {fmtDate(i.due)}</div>}
                <ul className="mt-2 space-y-1">
                  {i.pending.map((c) => { const s = b.streams.get(c.stream_id)!; return (
                    <li key={c.stream_id} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-ink-2"><Avatar name={s.poc_name ?? s.poc_label} color={s.poc_color} size={16} /><span className="truncate">{s.name}</span></span>
                      <SubChip cell={c} />
                    </li>); })}
                  {!i.pending.length && <li className="text-[12.5px] text-ok">All received</li>}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section n={3} title="Major changes" aside={<span className="text-[12px] text-ink-3">moves of 10%+ · next month vs this month · in-month revisions</span>}>
          {b.changes.length ? (
            <table className="table-base">
              <tbody>
                {b.changes.slice(0, 8).map((c, i) => (
                  <tr key={i}>
                    <td className="pl-0"><Link href={`/sop/projections?stream=${c.stream.id}`} className="text-ink hover:underline">{c.stream.name}</Link> <span className="text-[11.5px] text-ink-4">{metricLabel(c.metric)}</span></td>
                    <td><Badge tone={c.kind === "revision" ? "info" : "neutral"}>{c.kind === "revision" ? "Revised vs baseline" : `${c.fromLabel} → ${c.toLabel}`}</Badge></td>
                    <td className="text-right tabular text-ink-3">{num(c.from)} → <span className="text-ink">{num(c.to)}</span></td>
                    <td className={cn("w-20 pr-0 text-right font-medium tabular", c.delta > 0 ? "text-ink" : "text-ink-2")}>{pct(c.delta, 0, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[13px] text-ink-3">No projection moves of 10% or more.</p>}
        </Section>

        <Section n={4} title={`Projection accuracy · ${fmtMonth(b.periods.lastClosed)}`} aside={b.accuracy.demo && <DemoBadge long />}>
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-serif text-[24px] leading-none"><AccuracyText a={b.accuracy.overall} threshold={b.accuracy.threshold} /></span>
            {b.accuracy.bias != null && <span className="text-[13px] text-ink-3">overall · bias {pct(b.accuracy.bias, 0, true)} ({b.accuracy.bias > 0 ? "under-projected" : "over-projected"})</span>}
          </div>
          <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {b.accuracy.rows.map((r) => (
              <li key={r.stream.id} className="flex items-center justify-between border-b border-line/60 py-1.5 text-[13px]">
                <span className="text-ink-2">{r.stream.name}</span>
                <span className="flex items-center gap-3"><span className="text-[12px] tabular text-ink-4">{r.bias != null ? `bias ${pct(r.bias, 0, true)}` : ""}</span><AccuracyText a={r.accuracy} threshold={b.accuracy.threshold} className="w-10 text-right font-medium" /></span>
              </li>
            ))}
            {!b.accuracy.rows.length && <li className="text-[13px] text-ink-3">No actuals recorded for this month.</li>}
          </ul>
        </Section>

        <Section n={5} title="Capacity risks" aside={<Link href="/sop/capacity" className="text-[12px] text-ink-3 hover:text-ink">Capacity plan →</Link>}>
          {b.breaches.length ? (
            <ul className="space-y-1.5">
              {b.breaches.slice(0, 10).map((x, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
                  <span className="w-14 text-[12px] text-ink-4">{fmtMonth(x.period, false)}</span>
                  <span className="text-ink">{WH_LABEL[x.warehouse]} · {x.department}</span>
                  <span>needs {num(x.required)}/day vs {num(x.available)}</span>
                  <span className="font-medium text-bad">{num(x.gap)} short</span>
                </li>
              ))}
              {b.breaches.length > 10 && <li className="text-[12.5px] text-ink-3">+ {b.breaches.length - 10} more</li>}
            </ul>
          ) : <p className="text-[13px] text-ok">No breaches — required ≤ available everywhere.</p>}
        </Section>

        <Section n={6} title="Decisions required">
          {b.decisions.length ? (
            <ol className="space-y-2.5">
              {b.decisions.map((d, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-[11px] text-ink-3">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{d.href ? <Link href={d.href} className="hover:underline">{d.title}</Link> : d.title}{d.suggested && <Badge tone="muted" className="ml-2">suggested</Badge>}</div>
                    {d.detail && <div className="text-[12.5px] text-ink-3">{d.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13px] text-ink-3">Nothing pending.</p>}
        </Section>
      </Card>
    </div>
  );
}
