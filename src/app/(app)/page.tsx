import Link from "next/link";
import { AlarmClock, ArrowUpRight, Boxes, CalendarClock, CheckCheck, ListChecks, NotebookPen, Presentation, Video } from "lucide-react";
import { Avatar, AvatarStack, Badge, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AttentionList } from "@/components/home/Attention";
import { HeroSpend } from "@/components/home/HeroSpend";
import { StatCard } from "@/components/home/StatCard";
import { homeSeries } from "@/server/home/series";
import { TaskList } from "@/components/tasks/TaskRow";
import { canManage, requireUser } from "@/server/auth";
import { NewMeetingButton } from "@/components/meetings/NewMeeting";
import { meetingFilterOptions } from "@/server/meetings/queries";
import { listPeople } from "@/server/core/people";
import { q } from "@/server/db";
import { CalendarPrompt } from "@/components/settings/CalendarConnect";
import { calendarMaster } from "@/server/integrations/actions";
import { googleStatus } from "@/server/integrations/registry";
import { runSweeps } from "@/server/inbox/sweep";
import { attention } from "@/server/home/attention";
import { aopOutcome, dueToday, homeStats, todaySchedule } from "@/server/home/overview";
import { sopHeadline } from "@/server/sop/summary";
import { fmtDate, fmtMonth, fmtTime, today } from "@/lib/dates";
import { inr, num, pct, plural } from "@/lib/format";
import { MOM_STATUS, type Tone } from "@/lib/meta";
import { cn } from "@/lib/cn";

export const metadata = { title: "Summary" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function CommandCentre() {
  const u = await requireUser();
  await runSweeps(u);
  const [items, stats, schedule, due, aop, sop, series, mopts, people, moms] = await Promise.all([
    attention(u), homeStats(u), todaySchedule(u), dueToday(u), aopOutcome(), sopHeadline(), homeSeries(u), meetingFilterOptions(), listPeople(),
    // minutes still to write / review: mine as MoM owner, or every one for PMs
    q<{ id: string; title: string; starts_at: string; mom_status: string; owner: string | null }>(
      `select m.id, m.title, m.starts_at::text, m.mom_status, o.name as owner from meetings m left join users o on o.id = m.mom_owner_id
       where not m.cancelled and m.ends_at < now() and m.mom_status in ('pending','draft','submitted') and ($2 or m.mom_owner_id = $1)
       order by m.starts_at desc limit 5`, [u.id, canManage(u)]),
  ]);
  // ask each person to connect their own calendar — never connected for them; "Not now" hides it
  const [master, g, dismissed] = await Promise.all([calendarMaster(), googleStatus(u.id), q(`select 1 from app_settings where key = $1`, [`calendar.prompt_dismissed.${u.id}`])]);
  const askCalendar = master && g.configured && !g.connected && !dismissed.length;
  const meetingOpts = { people: people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color, title: p.title })), reviews: mopts.reviews, projects: mopts.projects, programs: mopts.programs };
  const sum = (xs: { value: number }[], n = 7) => xs.slice(-n).reduce((a, x) => a + x.value, 0);
  const now = Date.now();
  const first = u.name.split(" ")[0];
  const cost = aop?.kind === "cost";
  const aopTone: Tone = aop?.status === "delayed" ? "red" : aop?.status === "at_risk" ? "amber" : "green";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[26px] font-semibold leading-[1.08] tracking-[-0.02em]">{greeting()}, <span className="text-gradient">{first}</span></h1>
          <p className="mt-2 text-[13.5px] font-medium text-ink-3">
            {items.length ? <>Here’s what needs your attention today — <span className="text-ink-2">{plural(items.length, "item")}</span>, most important first.</> : "Nothing needs your attention right now. Enjoy the calm."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
          <CalendarClock size={14} /> {fmtDate(today(), { dow: true })}
        </div>
      </header>

      {askCalendar && <CalendarPrompt />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Open tasks" value={stats.openTasks} href="/tasks" icon={<ListChecks size={15} />} bars={series.completed.map((d) => d.value)}
          badge={`${sum(series.completed)} done this week`} foot="Completed per day · 14 days" />
        <StatCard label="Overdue" value={stats.overdue} href="/tasks/all?view=overdue" icon={<AlarmClock size={15} />}
          badge={stats.overdue ? "Needs action" : "All clear"} badgeTone={stats.overdue ? "bad" : "accent"} foot={stats.overdue ? "Past due date" : "Nothing past due"} />
        <StatCard label="MoMs pending" value={stats.momPending} href="/meetings" icon={<NotebookPen size={15} />}
          badge={stats.momPending ? "Awaiting" : "Up to date"} badgeTone={stats.momPending ? "warn" : "accent"} foot="Ended meetings without minutes" />
        <StatCard label="Meetings today" value={stats.meetingsToday} href="/meetings" icon={<Presentation size={15} />} bars={series.meetings.map((d) => d.value)}
          foot="Meetings per day · 14 days" />
      </div>


      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {/* Attention */}
          <Card className="overflow-hidden">
            <CardHeader title="Needs your attention" subtitle="Ranked across tasks, goals, meetings, AOP and S&OP" />
            {items.length ? <AttentionList items={items} /> : <EmptyState compact icon={<CheckCheck size={18} />} title="All clear" body="No exceptions across your programs. New ones will surface here automatically." />}
          </Card>

          {/* Today */}
          <Card className="overflow-hidden">
            <CardHeader title="Today" subtitle={`${plural(schedule.length, "meeting")} · ${plural(due.length, "task")} due or overdue`} icon={<CalendarClock size={15} />}
              action={<ButtonLink href="/meetings" variant="ghost" size="xs">Meetings <ArrowUpRight size={12} /></ButtonLink>} />
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-line">
              <div className="p-2">
                {schedule.length ? schedule.map((m) => {
                  const start = new Date(m.starts_at).getTime(), end = m.ends_at ? new Date(m.ends_at).getTime() : start;
                  const live = now >= start && now <= end, past = now > end;
                  const ms = MOM_STATUS[m.mom_status as keyof typeof MOM_STATUS];
                  return (
                    <Link key={m.id} href={`/meetings/${m.id}`} className={cn("flex gap-3 rounded-lg px-2.5 py-2.5 hover:bg-subtle/70", past && "opacity-70")}>
                      <div className="w-[62px] shrink-0 pt-0.5 text-right">
                        <div className="text-[12.5px] font-medium tabular text-ink">{fmtTime(m.starts_at)}</div>
                        {m.ends_at && <div className="text-[11px] tabular text-ink-4">{fmtTime(m.ends_at)}</div>}
                      </div>
                      <div className={cn("w-[2px] shrink-0 rounded-full", live ? "bg-ok" : past ? "bg-line-strong" : "bg-ink-2")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium">{m.title}</span>
                          {live && <Badge tone="green" dot>Now</Badge>}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                          <AvatarStack people={m.attendees} max={4} size={18} />
                          {(m.review || m.project) && <span className="truncate">{m.project ?? m.review}</span>}
                        </div>
                        {past && ms && m.mom_status !== "distributed" && <div className="mt-1.5"><Badge tone={ms.tone as Tone}>{m.mom_owner ? `${ms.label} · ${m.mom_owner}` : ms.label}</Badge></div>}
                        {!past && m.prep_notes && <div className="mt-1 line-clamp-1 text-[12px] text-ink-3">Prep: {m.prep_notes}</div>}
                      </div>
                    </Link>
                  );
                }) : <EmptyState compact icon={<Video size={16} />} title="No meetings today" body="Connect Google Calendar to import your meetings automatically." action={<ButtonLink href="/integrations" size="xs">Integrations</ButtonLink>} />}
              </div>
              <div className="border-t border-line lg:border-t-0">
                <TaskList tasks={due} showProject={false} empty={<EmptyState compact title="Nothing due today" body="Tasks due today and overdue show up here." />} />
              </div>
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title="Meetings & MoM" icon={<NotebookPen size={15} />} subtitle={moms.length ? `${moms.length} minute${moms.length === 1 ? "" : "s"} to write or review` : "All minutes are in"}
              action={<NewMeetingButton options={meetingOpts} me={u.id} joinedAt={u.joined_at} variant="secondary" />} />
            {moms.length ? (
              <div className="divide-y divide-line/70">
                {moms.map((m) => (
                  <Link key={m.id} href={`/meetings/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{m.title}</div>
                      <div className="text-[11.5px] text-ink-3">{fmtDate(m.starts_at.slice(0, 10))} · {m.owner ?? "No MoM owner"}</div>
                    </div>
                    <Badge tone={m.mom_status === "submitted" ? "info" : "amber"}>{m.mom_status === "submitted" ? "Review" : m.mom_status === "draft" ? "Draft" : "Write MoM"}</Badge>
                  </Link>
                ))}
              </div>
            ) : <EmptyState compact title="No minutes pending" body="Add a meeting here; its MoM, actions and AI brief live on the meeting." />}
            <div className="border-t border-line px-4 py-2 text-right"><ButtonLink href="/meetings" variant="ghost" size="xs">All meetings <ArrowUpRight size={12} /></ButtonLink></div>
          </Card>
          {aop && aop.lastClosed && (
            <HeroSpend title={aop.cycleName} ytdActual={aop.ytdActual} variance={aop.variance} variancePct={aop.variancePct} projection={aop.projection} fyPlan={aop.fyPlan}
              lastClosed={aop.lastClosed} labels={aop.labels} cost={cost} trend={aop.trend.map((t) => ({ period: t.period, plan: t.plan, actual: t.actual }))} />
          )}


          <Card className="overflow-hidden">
            <CardHeader title="S&OP" subtitle={`${sop.submitted} of ${sop.total} inputs in for ${fmtMonth(sop.nextPeriod)}`} icon={<Boxes size={15} />}
              action={<ButtonLink href="/sop" variant="ghost" size="xs">Open <ArrowUpRight size={12} /></ButtonLink>} />
            <div className="divide-y divide-line/70">
              {sop.pendingStreams.slice(0, 4).map((p) => (
                <Link key={p.id} href="/sop/inputs" className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-subtle/60">
                  <Avatar name={p.poc_name} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{p.name}</div>
                    <div className="text-[11.5px] text-ink-3">{p.poc_name ?? "No POC"} · due {fmtDate(p.due_date)}</div>
                  </div>
                  {p.late && <Badge tone="red">Late</Badge>}
                </Link>
              ))}
              {sop.capacityBreaches.slice(0, 2).map((c, i) => (
                <Link key={i} href="/sop/capacity" className="block px-4 py-2.5 hover:bg-subtle/60">
                  <div className="text-[13px] text-bad">{c.warehouse} · {c.department}</div>
                  <div className="text-[11.5px] text-ink-3">{fmtMonth(c.period)} · needs {num(c.required)}/day vs {num(c.available)} available</div>
                </Link>
              ))}
              {!sop.pendingStreams.length && !sop.capacityBreaches.length && <EmptyState compact title="All inputs in, no capacity breaches" />}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
