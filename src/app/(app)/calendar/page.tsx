import Link from "next/link";
import { ChevronLeft, ChevronRight, Plug } from "lucide-react";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireUser, canManage } from "@/server/auth";
import { meetingsBetween, tasksDueBetween, type MeetingRow } from "@/server/meetings/queries";
import { momDisplay, timeRange } from "@/components/meetings/bits";
import { addDays, dateOf, fmtDate, today, weekStart } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/meta";

export const metadata = { title: "Calendar" };

const START_H = 8, END_H = 21, HOUR_PX = 52;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TZ = "Asia/Kolkata";
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const minutesOfDay = (ts: string | Date) => { const [h, m] = hm.format(new Date(ts)).split(":").map(Number); return h * 60 + m; };

const toneBlock: Record<Tone, string> = {
  neutral: "border-l-ink-3 bg-surface hover:bg-subtle",
  muted: "border-l-line-strong bg-subtle/60 text-ink-3 hover:bg-subtle",
  info: "border-l-info bg-info-soft hover:brightness-[0.98]",
  green: "border-l-ok bg-ok-soft hover:brightness-[0.98]",
  amber: "border-l-warn bg-warn-soft hover:brightness-[0.98]",
  red: "border-l-bad bg-bad-soft hover:brightness-[0.98]",
  violet: "border-l-violet bg-violet-soft",
};

/** Greedy lane assignment so overlapping meetings sit side by side. */
function layout(ms: MeetingRow[]) {
  const items = ms.map((m) => {
    const s = Math.max(START_H * 60, minutesOfDay(m.starts_at));
    const e = Math.min(END_H * 60, Math.max(s + 20, m.ends_at ? minutesOfDay(m.ends_at) : s + 30));
    return { m, s, e, lane: 0, lanes: 1 };
  }).sort((a, b) => a.s - b.s);
  const active: typeof items = [];
  let cluster: typeof items = [];
  const flush = () => { const n = Math.max(1, ...cluster.map((c) => c.lane + 1)); cluster.forEach((c) => (c.lanes = n)); cluster = []; };
  for (const it of items) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].e <= it.s) active.splice(i, 1);
    if (!active.length && cluster.length) flush();
    const used = new Set(active.map((a) => a.lane));
    let l = 0; while (used.has(l)) l++;
    it.lane = l; active.push(it); cluster.push(it);
  }
  flush();
  return items;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const td = today();
  const ws = weekStart(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : td);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const [meetings, tasks] = await Promise.all([
    meetingsBetween(u.id, canManage(u), ws, addDays(ws, 7), u.joined_at),
    tasksDueBetween(u.id, ws, addDays(ws, 6)),
  ]);
  const byDay = new Map(days.map((d) => [d, meetings.filter((m) => dateOf(m.starts_at) === d)]));
  const tasksByDay = new Map(days.map((d) => [d, tasks.filter((t) => t.due_date === d)]));
  const nowMin = minutesOfDay(new Date());
  const isThisWeek = days.includes(td);
  const title = `${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`;
  const owed = meetings.filter((m) => momDisplay(m).tone === "amber" || momDisplay(m).tone === "red").length;

  return (
    <div>
      <PageHeader eyebrow="Calendar" title={title}
        subtitle={`${meetings.length} meeting${meetings.length === 1 ? "" : "s"} · ${tasks.filter((t) => t.status !== "completed").length} tasks due${owed ? ` · ${owed} MoM${owed === 1 ? "" : "s"} owed` : ""}`}
        actions={<>
          <div className="flex items-center rounded-lg border border-line-strong bg-surface">
            <Link href={`/calendar?week=${addDays(ws, -7)}`} aria-label="Previous week" className="flex h-8 w-8 items-center justify-center rounded-l-lg text-ink-3 hover:bg-subtle hover:text-ink"><ChevronLeft size={15} /></Link>
            <Link href="/calendar" className={cn("flex h-8 items-center border-x border-line px-3 text-[12.5px] font-medium hover:bg-subtle", isThisWeek ? "text-ink-3" : "text-ink")}>Today</Link>
            <Link href={`/calendar?week=${addDays(ws, 7)}`} aria-label="Next week" className="flex h-8 w-8 items-center justify-center rounded-r-lg text-ink-3 hover:bg-subtle hover:text-ink"><ChevronRight size={15} /></Link>
          </div>
          <ButtonLink href="/integrations" variant="ghost" size="sm"><Plug size={14} />Sync</ButtonLink>
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        {([["neutral", "Upcoming"], ["amber", "MoM pending"], ["red", "MoM overdue"], ["info", "Awaiting review"], ["green", "Distributed"], ["muted", "Skipped"]] as [Tone, string][]).map(([t, l]) => (
          <span key={l} className="flex items-center gap-1.5"><span className={cn("h-3 w-1 rounded-full", { neutral: "bg-ink-3", amber: "bg-warn", red: "bg-bad", info: "bg-info", green: "bg-ok", muted: "bg-line-strong", violet: "bg-violet" }[t])} />{l}</span>
        ))}
      </div>

      <div className="card overflow-x-auto scroll-thin">
        <div className="min-w-[860px]">
          {/* day headers + task strip */}
          <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
            <div />
            {days.map((d, i) => {
              const ts = tasksByDay.get(d)!;
              const late = ts.filter((t) => t.status !== "completed" && d < td).length;
              return (
                <div key={d} className={cn("border-l border-line px-2 pb-2 pt-2.5", d === td && "bg-subtle/60")}>
                  <div className="flex items-baseline gap-1.5">
                    <span className={cn("text-[11.5px] font-medium uppercase tracking-[0.06em]", d === td ? "text-ink" : "text-ink-3")}>{DOW[i]}</span>
                    <span className={cn("font-serif text-[20px] leading-none tabular", d === td ? "text-ink" : "text-ink-2")}>{Number(d.slice(8))}</span>
                    {d === td && <span className="ml-auto rounded-full bg-ink px-1.5 text-[10px] font-medium text-white">Today</span>}
                  </div>
                  <div className="mt-2 min-h-[22px] space-y-1">
                    {ts.slice(0, 3).map((t) => (
                      <Link key={t.id} href={`/tasks/${t.id}`} title={t.title}
                        className={cn("flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11.5px] ring-1 ring-inset",
                          t.status === "completed" ? "text-ink-4 line-through ring-line" : d < td ? "bg-bad-soft text-bad ring-bad/15" : d === td ? "bg-warn-soft text-warn ring-warn/20" : "text-ink-2 ring-line hover:bg-subtle")}>
                        <span className="truncate">{t.title}</span>
                      </Link>
                    ))}
                    {ts.length > 3 && <Link href={`/tasks?due=${d}`} className="block px-1.5 text-[11px] text-ink-3 hover:text-ink">+{ts.length - 3} more{late ? ` · ${late} late` : ""}</Link>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* time grid */}
          <div className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]" style={{ height: (END_H - START_H) * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: END_H - START_H }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 text-[10.5px] tabular text-ink-4" style={{ top: i * HOUR_PX }}>{i === 0 ? "" : `${((START_H + i - 1) % 12) + 1}${START_H + i < 12 ? "am" : "pm"}`}</div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className={cn("relative border-l border-line", d === td && "bg-subtle/30")}>
                {Array.from({ length: END_H - START_H }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-line/60" style={{ top: i * HOUR_PX }} />)}
                {layout(byDay.get(d)!).map(({ m, s, e, lane, lanes }) => {
                  const disp = momDisplay(m);
                  const h = ((e - s) / 60) * HOUR_PX;
                  return (
                    <Link key={m.id} href={`/meetings/${m.id}`} title={`${m.title} · ${timeRange(m.starts_at, m.ends_at)} · ${disp.label}`}
                      className={cn("absolute overflow-hidden rounded-md border border-line/70 border-l-[3px] px-1.5 py-1 text-[11.5px] leading-tight shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[filter,background]", toneBlock[disp.tone])}
                      style={{ top: ((s - START_H * 60) / 60) * HOUR_PX + 1, height: h - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                      <div className="truncate font-medium text-ink">{m.title}</div>
                      {h > 34 && <div className="truncate text-[10.5px] text-ink-3">{timeRange(m.starts_at, m.ends_at)}</div>}
                      {h > 52 && <div className="truncate text-[10.5px] text-ink-3">{disp.label}{m.mom_owner_name ? ` · ${m.mom_owner_name}` : ""}</div>}
                    </Link>
                  );
                })}
                {d === td && nowMin >= START_H * 60 && nowMin <= END_H * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((nowMin - START_H * 60) / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-2 rounded-full bg-bad" /><span className="h-px flex-1 bg-bad" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {!meetings.length && (
        <p className="mt-4 text-center text-[13px] text-ink-3">No meetings this week. <Link href="/integrations" className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Connect Google Calendar</Link> or add one from <Link href="/meetings" className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">Meetings</Link>.</p>
      )}
    </div>
  );
}
