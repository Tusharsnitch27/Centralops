import Link from "next/link";
import { BookOpen, ChevronDown , Lock } from "lucide-react";
import { Avatar, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { SubChip } from "@/components/sop/bits";
import { RemindAllButton, RemindButton, SubmissionMenu } from "@/components/sop/actions";
import { ValuesForm } from "@/components/sop/ProjectionForm";
import { canOverview, requireUser, canManage } from "@/server/auth";
import { granted, grantsFor } from "@/server/auth/grants";
import { getGuidelines, getSubmissionGrid, inputPeriods, projectionLock } from "@/server/sop/queries";
import { getStreamMonthForm } from "@/server/sop/form";
import { currentPeriod, dueLabel, isOpenSub, SUB_META } from "@/server/sop/model";
import { addMonths, ago, fmtDate, fmtMonth, today } from "@/lib/dates";

export const metadata = { title: "S&OP inputs" };

export default async function SopInputs({ searchParams }: { searchParams: Promise<{ stream?: string; period?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const td = today();
  const cur = currentPeriod(td);
  const periods = inputPeriods(4, td);
  const next = addMonths(cur, 1);
  const [grid, guidelines] = await Promise.all([getSubmissionGrid(periods), getGuidelines()]);
  // without the full overview a person sees the streams they own or were granted (Settings › Permissions)
  const grants = await grantsFor(u.id, "sop_stream");
  if (!canOverview(u)) {
    grid.streams = grid.streams.filter((s) => s.poc_id === u.id || granted(grants, [s.id], "view"));
    const own = new Set(grid.streams.map((s) => s.id));
    grid.cells = grid.cells.filter((c) => own.has(c.stream_id));
  }
  const cell = (sid: string, p: string) => grid.cells.find((c) => c.stream_id === sid && c.period === p)!;

  const nextCells = grid.cells.filter((c) => c.period === next && c.state !== "na");
  const nextOpen = nextCells.filter((c) => isOpenSub(c.state));
  const allOpen = grid.cells.filter((c) => isOpenSub(c.state) && (c.period <= next || c.due_date <= td));
  const late = grid.cells.filter((c) => c.state === "late");

  // ---- submit form selection: explicit, else my first open stream, else first stream
  const mine = grid.streams.filter((s) => s.poc_id === u.id || granted(grants, [s.id]));
  const defStream = sp.stream ? grid.streams.find((s) => s.id === sp.stream || s.code === sp.stream)
    : (mine.find((s) => isOpenSub(cell(s.id, next).state)) ?? mine[0] ?? grid.streams.find((s) => isOpenSub(cell(s.id, next).state)) ?? grid.streams[0]);
  const formPeriods = [addMonths(cur, -1), ...periods];
  const formPeriod = sp.period && formPeriods.includes(sp.period) ? sp.period : next;
  const form = defStream ? await getStreamMonthForm(defStream, formPeriod) : null;
  const canSubmit = !!defStream && (canManage(u) || defStream.poc_id === u.id || granted(grants, [defStream.id]));
  const lock = defStream ? await projectionLock(defStream.id, formPeriod) : { locked: false, at: null, since: "" };
  const lockedForMe = lock.locked && u.role !== "admin";
  const formCell = defStream ? grid.cells.find((c) => c.stream_id === defStream.id && c.period === formPeriod) : null;

  return (
    <div className="space-y-6">
      {/* summary */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <div className="eyebrow mb-1">{fmtMonth(next)} projections</div>
          <div className="font-serif text-[20px] leading-none text-ink">
            {nextCells.length - nextOpen.length}<span className="text-ink-4"> / {nextCells.length}</span> <span className="text-[14px] text-ink-3">received</span>
          </div>
        </div>
        <div className="text-[13px] text-ink-2">
          {nextOpen.length ? <>{nextOpen.length} pending · due <span className="font-medium">{fmtDate(nextCells[0]?.due_date)}</span> <span className="text-ink-3">({dueLabel(nextCells[0]!.due_date, td)})</span></> : "All streams submitted"}
          {late.length > 0 && <div className="mt-0.5 text-bad">{late.length} late input{late.length === 1 ? "" : "s"} across months</div>}
        </div>
        <p className="max-w-md text-[12.5px] text-ink-3">Enter projections day by day, North and South (download the template with dates filled, or type in the grid). Due by the 21st of the previous month; they lock 24 h after submission.</p>
        <div className="ml-auto"><RemindAllButton periods={[...new Set(allOpen.map((c) => c.period))]} count={allOpen.length} /></div>
      </Card>

      {/* tracker grid */}
      <Card>
        <CardHeader title="Submission tracker" subtitle="Streams × months · Done / Pending / Late" />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Stream</th>
                <th>POC</th>
                {periods.map((p) => <th key={p}>{fmtMonth(p)}<div className="text-[10.5px] font-normal normal-case tracking-normal text-ink-4">due {fmtDate(cell(grid.streams[0]?.id ?? "", p)?.due_date)}</div></th>)}
                <th className="text-right">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {grid.streams.map((s) => {
                const open = periods.filter((p) => isOpenSub(cell(s.id, p).state) && (p <= next || cell(s.id, p).due_date <= td));
                const rem = grid.lastReminder.get(s.id);
                return (
                  <tr key={s.id} className="group">
                    <td><Link href={`/sop/projections?stream=${s.id}`} className="font-medium text-ink hover:underline">{s.name}</Link>
                      <div className="text-[11.5px] text-ink-4">{s.granularity === "day" ? "Day-wise" : s.granularity === "week" ? "Weekly" : "Monthly"}{s.dimensions.length ? ` · ${s.dimensions.join(" / ")}` : ""}</div></td>
                    <td><span className="flex items-center gap-1.5 text-ink-2"><Avatar name={s.poc_name ?? s.poc_label} color={s.poc_color} size={20} />{s.poc_name ?? s.poc_label ?? "—"}</span></td>
                    {periods.map((p) => {
                      const c = cell(s.id, p);
                      return (
                        <td key={p}>
                          <span className="flex items-center gap-1">
                            <Link href={`/sop/inputs?stream=${s.id}&period=${p}#submit`} className="rounded-md hover:opacity-80"><SubChip cell={c} /></Link>
                            {c.state === "late" && <span className="text-[11px] tabular text-bad">{dueLabel(c.due_date, td)}</span>}
                            <SubmissionMenu streamId={s.id} period={p} state={c.state} />
                          </span>
                        </td>
                      );
                    })}
                    <td className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {rem && <span className="text-[11.5px] text-ink-4" title={`${rem.n} reminder${rem.n === 1 ? "" : "s"} sent`}>reminded {ago(rem.at)}</span>}
                        {open.length > 0 && s.poc_id ? <RemindButton streamId={s.id} periods={open} label="Remind" /> : <span className="text-[12px] text-ink-4">—</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
          {(["done", "done_late", "pending", "late", "na"] as const).map((k) => <span key={k} className="flex items-center gap-1"><Badge tone={SUB_META[k].tone} dot>{SUB_META[k].label}</Badge></span>)}
        </div>
      </Card>

      {/* submit form */}
      <Card id="submit" className="scroll-mt-6">
        <CardHeader title="Enter projections" subtitle={defStream ? `${defStream.name} · ${fmtMonth(formPeriod)} · ${defStream.granularity === "day" ? "day by day" : defStream.granularity === "week" ? "weekly rows" : "monthly"}${defStream.dimensions.length ? ` · by ${defStream.dimensions.join(" / ")}` : ""}` : undefined}
          action={formCell && <SubChip cell={formCell} showDue />} />
        <div className="p-4">
          <form className="mb-4 flex flex-wrap items-end gap-3" action="/sop/inputs#submit">
            <label><span className="label">Stream</span>
              <select name="stream" defaultValue={defStream?.id} className="field h-9 w-64 py-1">
                {grid.streams.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.poc_name ?? s.poc_label}</option>)}
              </select>
            </label>
            <label><span className="label">Month</span>
              <select name="period" defaultValue={formPeriod} className="field h-9 w-40 py-1">
                {formPeriods.map((p) => <option key={p} value={p}>{fmtMonth(p)}</option>)}
              </select>
            </label>
            <button className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-subtle">Open</button>
          </form>
          {lock.locked && (
            <div className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ${lockedForMe ? "bg-warn-soft text-warn" : "bg-info-soft text-info"}`}>
              <Lock size={13} />{lockedForMe ? <>Locked — submitted {lock.since}. Projections lock 24 hours after submission; only an admin can change them.</> : <>Locked for the owner (submitted {lock.since}). As an admin you can still change it.</>}
            </div>
          )}
          {defStream && form ? (
            form.lines.length ? (
              <ValuesForm key={`${defStream.id}:${formPeriod}`} mode="projection" streamId={defStream.id} period={formPeriod} periodLabel={fmtMonth(formPeriod)}
                lines={form.lines} labels={form.labels} dims={form.dims} cells={form.cells} prev={form.prev} started={formPeriod <= cur}
                disabled={!canSubmit || lockedForMe} disabledReason={lockedForMe ? `Locked — submitted ${lock.since}. Projections lock 24 hours after submission; ask an admin to change them.` : canSubmit ? undefined : `Only ${defStream.poc_name ?? "the POC"} or a PM can submit`} />
            ) : <EmptyState compact title="No lines configured" body="Add lines for this stream in Projections → Data source." />
          ) : <EmptyState compact title="No streams" />}
        </div>
      </Card>

      {/* guidelines */}
      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-semibold text-ink">
          <BookOpen size={15} className="text-ink-3" />Methodology & guidelines
          <span className="text-[12px] font-normal text-ink-3">· from the S&OP workbook</span>
          <ChevronDown size={14} className="ml-auto text-ink-4 transition group-open:rotate-180" />
        </summary>
        <ul className="space-y-3 border-t border-line px-5 py-4">
          {guidelines.map((g, i) => (
            <li key={i} className="grid gap-1 md:grid-cols-[180px_1fr]">
              <div className="text-[12px] text-ink-3"><div className="font-medium text-ink-2">{g.sheet}</div>{g.owners}</div>
              <div className="whitespace-pre-line text-[13px] text-ink-2">{g.text.replace(/\s(\d)\.\s/g, "\n$1. ")}</div>
            </li>
          ))}
          {!guidelines.length && <li className="text-[13px] text-ink-3">No guidelines configured (app setting <code>sop.guidelines</code>).</li>}
        </ul>
      </details>
    </div>
  );
}

