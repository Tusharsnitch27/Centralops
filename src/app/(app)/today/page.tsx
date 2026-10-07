import Link from "next/link";
import { AlertCircle, CalendarClock, CalendarDays, CircleCheck, Hourglass, Moon, Send, Sun, UserRoundCheck } from "lucide-react";
import { AvatarStack, Avatar, ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser } from "@/server/auth";
import { listTasks } from "@/server/tasks/queries";
import { getTodayMeetings, myOpenFollowups, type TodayMeeting } from "@/server/meetings/queries";
import { EodReview } from "@/components/today/EodReview";
import { MomBadge, phaseOf, timeRange } from "@/components/meetings/bits";
import { addDays, ago, fmtDate, today } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";

export const metadata = { title: "Today" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ eod?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const td = today();
  const [meetings, dueToday, overdue, upcoming, waiting, delegated, followups, doneToday] = await Promise.all([
    getTodayMeetings(u.id),
    listTasks({ ownerId: u.id, open: true, dueOn: td }),
    listTasks({ ownerId: u.id, overdue: true }),
    listTasks({ ownerId: u.id, open: true, dueFrom: addDays(td, 1), dueTo: addDays(td, 7) }),
    listTasks({ waitingOnOthersFor: u.id, open: true }),
    listTasks({ delegatedBy: u.id, open: true, limit: 30 }),
    myOpenFollowups(u.id),
    listTasks({ ownerId: u.id, completedSince: td }),
  ]);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  const eod = sp.eod === "1";
  const momOwed = meetings.filter((m) => m.is_mine_mom && phaseOf(m) === "ended" && (m.mom_status === "pending" || m.mom_status === "draft"));
  const nextMeeting = meetings.find((m) => phaseOf(m) !== "ended");

  const attention = [
    overdue.length ? { tone: "red", text: `${plural(overdue.length, "task")} overdue`, href: "#overdue" } : null,
    dueToday.length ? { tone: "amber", text: `${dueToday.length} due today`, href: "#due" } : null,
    momOwed.length ? { tone: "amber", text: `${plural(momOwed.length, "MoM")} to write`, href: `/meetings/${momOwed[0].id}` } : null,
    followups.length ? { tone: "neutral", text: `${plural(followups.length, "follow-up")} pending`, href: "#followups" } : null,
  ].filter(Boolean) as { tone: string; text: string; href: string }[];

  return (
    <div>
      <PageHeader eyebrow={fmtDate(td, { dow: true })} title={hour < 12 ? "Today" : hour < 17 ? "This afternoon" : "This evening"}
        subtitle={nextMeeting ? <>Next: <Link href={`/meetings/${nextMeeting.id}`} className="text-ink-2 hover:underline">{nextMeeting.title}</Link> at {timeRange(nextMeeting.starts_at, null)}</> : meetings.length ? "No more meetings today." : "No meetings on your calendar today."}
        actions={<>
          <ButtonLink href="/calendar" variant="ghost" size="sm"><CalendarDays size={14} />Week</ButtonLink>
          {eod ? <ButtonLink href="/today" size="sm"><Sun size={14} />Hide review</ButtonLink> : <ButtonLink href="/today?eod=1" size="sm" variant={hour >= 17 ? "primary" : "secondary"}><Moon size={14} />End-of-day review</ButtonLink>}
        </>} />

      {attention.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {attention.map((a) => (
            <Link key={a.text} href={a.href} className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
              a.tone === "red" ? "border-bad/20 bg-bad-soft text-bad hover:border-bad/40" : a.tone === "amber" ? "border-warn/20 bg-warn-soft text-warn hover:border-warn/40" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
              {a.tone === "red" && <AlertCircle size={13} />}{a.text}
            </Link>
          ))}
        </div>
      )}

      {eod && (
        <EodReview
          completed={doneToday.map((t) => ({ id: t.id, number: t.number, title: t.title }))}
          open={[...overdue, ...dueToday].map((t) => ({ id: t.id, number: t.number, title: t.title, due_date: t.due_date, overdue: t.due_date != null && t.due_date < td }))}
          meetings={momOwed.map((m) => ({ id: m.id, title: m.title, time: timeRange(m.starts_at, null) }))}
          followups={followups.map((f) => ({ id: f.id, label: f.task_title ?? f.message ?? "Update", person: f.person_name, color: f.person_color, href: f.entity_type === "task" ? `/tasks/${f.entity_id}` : `/meetings/${f.entity_id}` }))} />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {overdue.length > 0 && (
            <Card id="overdue"><CardHeader icon={<AlertCircle size={15} className="text-bad" />} title="Overdue" subtitle="Update, re-plan or close these first" /><TaskList tasks={overdue} /></Card>
          )}
          <Card id="due">
            <CardHeader icon={<CircleCheck size={15} />} title="Due today" subtitle={dueToday.length ? undefined : "Nothing due today"} />
            <TaskList tasks={dueToday} empty={<EmptyState compact title="Clear for today" body="Nothing is due today. Pull something forward from the week ahead." />} />
          </Card>
          <Card>
            <CardHeader icon={<CalendarClock size={15} />} title="Next 7 days" subtitle={upcoming.length ? plural(upcoming.length, "task") : undefined} />
            <TaskList tasks={upcoming.slice(0, 12)} empty={<EmptyState compact title="Nothing scheduled this week" />} />
            {upcoming.length > 12 && <div className="border-t border-line px-4 py-2.5 text-[12.5px]"><Link href="/tasks" className="text-ink-3 hover:text-ink">View all {upcoming.length} →</Link></div>}
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<Hourglass size={15} />} title="Waiting on someone" subtitle="Your tasks blocked on others" />
              <TaskList tasks={waiting} showProject={false} empty={<EmptyState compact title="Not waiting on anyone" />} />
            </Card>
            <Card>
              <CardHeader icon={<UserRoundCheck size={15} />} title="Delegated by you" subtitle={delegated.length ? `${delegated.filter((t) => t.due_date && t.due_date < td).length} overdue` : undefined} />
              <TaskList tasks={delegated.slice(0, 10)} showProject={false} empty={<EmptyState compact title="Nothing delegated" />} />
            </Card>
          </div>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader icon={<CalendarDays size={15} />} title="Meetings today" subtitle={meetings.length ? plural(meetings.length, "meeting") : undefined}
              action={<Link href="/meetings" className="text-[12px] text-ink-3 hover:text-ink">All</Link>} />
            {meetings.length ? <ol className="divide-y divide-line/70">{meetings.map((m) => <TodayMeetingItem key={m.id} m={m} />)}</ol>
              : <EmptyState compact icon={<CalendarDays size={16} />} title="No meetings today" body="Deep-work day." action={<ButtonLink href="/integrations" size="xs" variant="ghost">Connect calendar</ButtonLink>} />}
          </Card>
          <Card id="followups">
            <CardHeader icon={<Send size={15} />} title="Follow-ups you're waiting on" />
            {followups.length ? (
              <ul className="divide-y divide-line/70">
                {followups.map((f) => (
                  <li key={f.id}>
                    <Link href={f.entity_type === "task" ? `/tasks/${f.entity_id}` : `/meetings/${f.entity_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                      <Avatar name={f.person_name} color={f.person_color} size={22} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-ink">{f.task_title ?? f.message ?? "Update requested"}</div>
                        <div className="text-[11.5px] text-ink-3">{f.person_name ?? "—"} · asked {ago(f.created_at)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="No pending follow-ups" body="When you ask someone for an update, it shows here until they reply." />}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function TodayMeetingItem({ m }: { m: TodayMeeting }) {
  const ph = phaseOf(m);
  const owed = ph === "ended" && (m.mom_status === "pending" || m.mom_status === "draft");
  const review = m.mom_status === "submitted";
  return (
    <li className={cn("px-4 py-3", ph === "live" && "bg-info-soft/40")}>
      <div className="flex items-start gap-3">
        <div className="w-[62px] shrink-0 pt-0.5 text-[12px] tabular text-ink-3">{timeRange(m.starts_at, null)}</div>
        <div className="min-w-0 flex-1">
          <Link href={`/meetings/${m.id}`} className={cn("block truncate text-[13.5px] font-medium hover:underline", ph === "ended" ? "text-ink-2" : "text-ink")}>{m.title}</Link>
          <div className="mt-0.5 truncate text-[12px] text-ink-3">{[m.review_name, m.project_name ?? m.program_name].filter(Boolean).join(" · ") || "Ad-hoc"}{m.mom_owner_name ? ` · MoM ${m.is_mine_mom ? "you" : m.mom_owner_name}` : ""}</div>
          {m.prep_notes && ph !== "ended" && <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-2">{m.prep_notes}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AvatarStack people={m.attendees} max={5} size={20} />
            {m.previous_open_actions > 0 && <span className="text-[11.5px] text-warn">{m.previous_open_actions} open from last time</span>}
            <span className="ml-auto">
              {owed && m.is_mine_mom ? <ButtonLink href={`/meetings/${m.id}`} size="xs" variant="primary">Add MoM</ButtonLink>
                : review ? <ButtonLink href={`/meetings/${m.id}`} size="xs">Review</ButtonLink>
                  : <MomBadge m={m} />}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
