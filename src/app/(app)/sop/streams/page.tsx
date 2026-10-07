import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardList, Gauge, Warehouse } from "lucide-react";
import { Avatar, AvatarStack, Badge, ButtonLink, Card, CardHeader, EmptyState, SectionTitle } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { AccuracyText, DemoBadge, SubChip, Variance } from "@/components/sop/bits";
import { CreateActionButton, NoteButton, RemindAllButton, RemindButton } from "@/components/sop/actions";
import { listPeople } from "@/server/core/people";
import { getOverview, WH_LABEL } from "@/server/sop/queries";
import { dueLabel, isOpenSub, metricLabel } from "@/server/sop/model";
import { addDays, dateOf, fmtDate, fmtMonth, fmtTime, relDay } from "@/lib/dates";
import { num, pct, plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP" };

export default async function SopOverview() {
  const [o, people] = await Promise.all([getOverview(), listPeople()]);
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name, hint: p.team_name }));
  const streamById = new Map(o.cards.map((c) => [c.stream.id, c.stream]));
  const nextCells = o.grid.cells.filter((c) => c.period === o.next && c.state !== "na");
  const nextDue = nextCells[0]?.due_date;
  const pendingStreams = o.nextPending.map((c) => streamById.get(c.stream_id)!).filter(Boolean);
  const th = o.rules.accuracyThreshold;
  const worst = [...o.cards].filter((c) => c.closed.accuracy != null).sort((a, b) => a.closed.accuracy! - b.closed.accuracy!).slice(0, 3);
  const breachMonths = [...new Set(o.breaches.map((b) => b.period))];
  const topBreach = o.breaches.slice().sort((a, b) => b.gap - a.gap)[0];
  const exception = (c: (typeof o.cards)[number]) =>
    (c.next && isOpenSub(c.next.state) ? 2 : 0) + (c.closed.variance != null && Math.abs(c.closed.variance) > th ? 1 : 0);
  const cards = [...o.cards].sort((a, b) => exception(b) - exception(a) || a.stream.sort - b.stream.sort);

  return (
    <div className="space-y-8">
      {/* -------- exceptions -------- */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col p-4">
          <div className="eyebrow mb-2 flex items-center gap-1.5"><ClipboardList size={12} />Inputs · {fmtMonth(o.next)}</div>
          {pendingStreams.length ? (
            <>
              <div className="font-serif text-[22px] leading-tight text-ink">{pendingStreams.length} of {nextCells.length} streams pending</div>
              <p className="mt-1 text-[12.5px] text-ink-3">{nextDue ? <>Due {fmtDate(nextDue)} · <span className={cn(nextDue < o.td && "text-bad")}>{dueLabel(nextDue, o.td)}</span></> : null}</p>
              <div className="mt-3 flex items-center gap-2">
                <AvatarStack people={pendingStreams.map((s) => ({ name: s.poc_name ?? s.poc_label ?? "?", color: s.poc_color }))} max={5} />
                <span className="truncate text-[12px] text-ink-3">{pendingStreams.map((s) => s.name).join(", ")}</span>
              </div>
            </>
          ) : (
            <div className="font-serif text-[22px] leading-tight text-ink">All {nextCells.length} streams in</div>
          )}
          {o.curLate.length > 0 && (
            <p className="mt-2 text-[12px] text-bad">{o.curLate.map((c) => streamById.get(c.stream_id)?.name).join(", ")} still missing for {fmtMonth(o.cur)}</p>
          )}
          <div className="mt-auto flex items-center gap-2 pt-4">
            <RemindAllButton periods={[o.cur, o.next]} count={o.nextPending.length + o.curLate.length} label="Remind pending" size="xs" />
            <ButtonLink href="/sop/inputs" size="xs" variant="ghost">Tracker<ArrowRight size={12} /></ButtonLink>
          </div>
        </Card>

        <Card className="flex flex-col p-4">
          <div className="eyebrow mb-2 flex items-center gap-1.5"><Gauge size={12} />Accuracy · {fmtMonth(o.lastClosed)}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[30px] leading-none"><AccuracyText a={o.overall.accuracy} threshold={th} /></span>
            {o.overall.bias != null && <span className="text-[12.5px] text-ink-3">{o.overall.bias > 0 ? "under" : "over"}-projected by {pct(Math.abs(o.overall.bias))}</span>}
          </div>
          {o.overall.demo && <DemoBadge long className="mt-2 self-start" />}
          <ul className="mt-3 space-y-1">
            {worst.map((c) => (
              <li key={c.stream.id} className="flex items-center justify-between text-[12.5px]">
                <Link href={`/sop/projections?stream=${c.stream.id}`} className="truncate text-ink-2 hover:text-ink">{c.stream.name}</Link>
                <span className="flex items-center gap-2"><Variance v={c.closed.variance} threshold={th} className="text-[12px]" /><AccuracyText a={c.closed.accuracy} threshold={th} className="w-9 text-right" /></span>
              </li>
            ))}
            {!worst.length && <li className="text-[12.5px] text-ink-3">No actuals recorded for {fmtMonth(o.lastClosed)} yet.</li>}
          </ul>
          <div className="mt-auto pt-4"><ButtonLink href="/sop/projections" size="xs" variant="ghost">Projection vs actual<ArrowRight size={12} /></ButtonLink></div>
        </Card>

        <Card className="flex flex-col p-4">
          <div className="eyebrow mb-2 flex items-center gap-1.5"><Warehouse size={12} />Capacity · next 3 months</div>
          {o.breaches.length ? (
            <>
              <div className="font-serif text-[22px] leading-tight text-ink">{plural(o.breaches.length, "breach", "breaches")}</div>
              <p className="mt-1 text-[12.5px] text-ink-3">Required &gt; available in {breachMonths.map((p) => fmtMonth(p, false)).join(", ")}</p>
              {topBreach && (
                <p className="mt-3 text-[12.5px] text-ink-2">
                  Worst: <span className="font-medium">{WH_LABEL[topBreach.warehouse]} {topBreach.department}</span> needs {num(topBreach.required)}/day vs {num(topBreach.available)} in {fmtMonth(topBreach.period)} — <span className="font-medium text-bad">{num(topBreach.gap)} short</span>
                </p>
              )}
            </>
          ) : <div className="font-serif text-[22px] leading-tight text-ink">No breaches</div>}
          <div className="mt-auto flex items-center gap-2 pt-4">
            <ButtonLink href={`/sop/capacity${topBreach ? `?month=${topBreach.period}` : ""}`} size="xs" variant={o.breaches.length ? "primary" : "secondary"}>Plan capacity</ButtonLink>
          </div>
        </Card>

        <Card className="flex flex-col p-4">
          <div className="eyebrow mb-2 flex items-center gap-1.5"><CalendarClock size={12} />Next review</div>
          {o.nextReview ? (
            <>
              <div className="font-serif text-[22px] leading-tight text-ink">{relDay(dateOf(o.nextReview.starts_at), o.td)}, {fmtTime(o.nextReview.starts_at)}</div>
              <p className="mt-1 text-[12.5px] text-ink-3">{o.nextReview.title} · {fmtDate(dateOf(o.nextReview.starts_at), { dow: true })}</p>
              <p className="mt-3 text-[12.5px] text-ink-2">{o.nextReview.attendees} attendees{o.nextReview.mom_owner_name ? ` · MoM by ${o.nextReview.mom_owner_name}` : ""}</p>
              <p className="text-[12.5px] text-ink-3">{plural(o.actions.length, "open action")} carried in</p>
            </>
          ) : <p className="text-[13px] text-ink-3">No Weekly S&amp;OP Review on the calendar yet.</p>}
          <div className="mt-auto flex items-center gap-2 pt-4">
            <ButtonLink href="/sop/review" size="xs" variant="primary">Open pre-read</ButtonLink>
            {o.nextReview && <ButtonLink href={`/meetings/${o.nextReview.id}`} size="xs" variant="ghost">Meeting<ArrowRight size={12} /></ButtonLink>}
          </div>
        </Card>
      </section>

      {/* -------- streams -------- */}
      <section>
        <SectionTitle count={cards.length} action={<span className="text-[12px] text-ink-3">Last closed month {fmtMonth(o.lastClosed)} · exceptions first</span>}>Streams</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((c) => {
            const s = c.stream;
            const nextOpen = c.next && isOpenSub(c.next.state);
            return (
              <Card key={s.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
                  <div className="min-w-0">
                    <Link href={`/sop/projections?stream=${s.id}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">{s.name}</Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                      <Avatar name={s.poc_name ?? s.poc_label} color={s.poc_color} size={16} />{s.poc_name ?? s.poc_label ?? "No POC"}
                      <span className="text-ink-4">·</span><span className="capitalize">{s.area}</span>
                    </div>
                  </div>
                  {c.next && <SubChip cell={c.next} />}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-y border-line/70 bg-subtle/40 px-4 py-2.5">
                  <div><div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">Projection</div><div className="tabular text-[15px] text-ink">{num(c.closed.proj)}</div></div>
                  <div><div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">Actual</div><div className={cn("tabular text-[15px]", c.closed.demo ? "text-warn" : "text-ink")}>{num(c.closed.act)}</div></div>
                  <div><div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-4">Variance</div><div className="text-[15px]"><Variance v={c.closed.variance} threshold={th} /></div></div>
                </div>
                <div className="flex-1 space-y-1.5 px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-center justify-between text-ink-3">
                    <span>{metricLabel(c.metric)} · {fmtMonth(o.lastClosed)}</span>
                    {c.closed.demo ? <DemoBadge /> : c.closed.act == null ? <span className="text-ink-4">No actuals yet</span> : <span>Accuracy <AccuracyText a={c.closed.accuracy} threshold={th} /></span>}
                  </div>
                  <div className="text-ink-3">{fmtMonth(o.cur)} projection <span className="tabular text-ink-2">{num(c.current.proj)}</span>{c.current.revised && <Badge tone="info" className="ml-1.5">revised</Badge>}</div>
                  <p className={cn("line-clamp-2", c.note ? "text-ink-2" : "text-ink-4")}>{c.note ? <>“{c.note.body}” <span className="text-ink-4">— {c.note.author_name}</span></> : "No commentary"}</p>
                </div>
                <div className="flex items-center gap-1 border-t border-line/70 px-2.5 py-2">
                  <NoteButton streamId={s.id} period={o.lastClosed} streamName={s.name} periodLabel={fmtMonth(o.lastClosed)} />
                  <CreateActionButton people={peopleOpts} variant="ghost"
                    defaults={{ title: nextOpen ? `Submit ${s.name} projections for ${fmtMonth(o.next)}` : `Review ${s.name} variance for ${fmtMonth(o.lastClosed)}`, ownerId: s.poc_id, streamId: s.id, dueDate: nextOpen && c.next!.due_date >= o.td ? c.next!.due_date : addDays(o.td, 3) }} label="Action" />
                  <span className="flex-1" />
                  {nextOpen && s.poc_id && <RemindButton streamId={s.id} periods={[o.next]} label="Remind" variant="subtle" />}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* -------- actions -------- */}
      <section>
        <Card>
          <CardHeader title="Open S&OP actions" subtitle="Raised from S&OP, or agreed in the Weekly S&OP Review"
            action={<CreateActionButton people={peopleOpts} defaults={{ title: "" }} label="New action" size="sm" />} />
          <TaskList tasks={o.actions} empty={<EmptyState compact title="No open S&OP actions" body="Actions agreed in the Weekly S&OP Review appear here until they're closed." />} />
        </Card>
      </section>
    </div>
  );
}
