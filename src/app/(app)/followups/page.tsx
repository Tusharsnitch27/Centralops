import Link from "next/link";
import { AlarmClockOff, ArrowRight, CheckCheck, Hourglass, Inbox, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { Avatar, Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { BulkRequestButton, CloseFollowupButton, FollowupRowActions, UnsnoozeButton } from "@/components/tasks/FollowupActions";
import { NewTaskButton } from "@/components/tasks/NewTaskButton";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser } from "@/server/auth";
import { followupsPage, ownerLabel, type FollowupItem, type FollowupRow } from "@/server/tasks/followups";
import { ago, dateOf, diffDays, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { TASK_STATUS } from "@/lib/meta";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Follow-ups" };

const CHANNEL: Record<string, string> = { in_app: "In-app", email: "Email", slack: "Slack", whatsapp: "WhatsApp" };
const SEV = {
  high: { dot: "bg-bad", label: "High", text: "text-bad" },
  medium: { dot: "bg-warn", label: "Medium", text: "text-warn" },
  low: { dot: "bg-ink-4", label: "Low", text: "text-ink-3" },
} as const;

export default async function FollowupsPage() {
  const u = await requireUser();
  const d = await followupsPage(u.id);
  const { stats } = d;
  const high = d.queue.filter((i) => i.severity === "high").length;

  return (
    <div>
      <PageHeader
        eyebrow="Work"
        title="Follow-ups"
        subtitle={stats.needs
          ? <><span className="font-medium text-ink">{plural(stats.needs, "delegated task needs", "delegated tasks need")} a nudge</span>{high > 0 && <> · {high} urgent</>} · {stats.delegatedOpen} open tasks you've delegated</>
          : <>You're on top of everything you've delegated · {stats.delegatedOpen} open</>}
        actions={<><NewTaskButton kind="followup" label="New follow-up" variant="secondary" /><BulkRequestButton count={d.queue.length} taskIds={d.queue.map((i) => i.task.id)} /></>}
      />

      {/* KPI strip — each metric points at its section */}
      <div className="card mb-8 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        <Kpi href="#needs" label="Need follow-up" value={stats.needs} hint={high ? `${high} high severity` : "Nothing urgent"} tone={high ? "red" : undefined} />
        <Kpi href="#awaiting" label="Awaiting response" value={stats.awaiting} hint={stats.awaiting ? `Oldest ${stats.oldestAwaitingDays}d` : "All answered"} tone={stats.oldestAwaitingDays >= 3 ? "amber" : undefined} />
        <Kpi href="#log" label="Response rate · 30d" value={stats.respondedRate == null ? "—" : `${Math.round(stats.respondedRate * 100)}%`} hint="of your requests answered" />
        <Kpi href="#log" label="Median response" value={stats.medianResponseHours == null ? "—" : stats.medianResponseHours < 24 ? `${Math.max(1, Math.round(stats.medianResponseHours))}h` : `${Math.round(stats.medianResponseHours / 24)}d`} hint="from request to update" />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-8">
          {/* Needs follow-up */}
          <section id="needs" className="scroll-mt-6">
            <Heading icon={<MessageCircleQuestion size={13} />} title="Needs follow-up" count={d.queue.length}
              hint="Overdue, blocked, due soon without a recent update, or quiet for 5+ days" />
            <div className="card overflow-hidden">
              {d.queue.length ? d.queue.map((i) => <QueueRow key={i.task.id} i={i} />) : (
                <EmptyState icon={<Sparkles size={18} />} title="Nobody needs chasing right now"
                  body="Every task you've delegated is on time and has a recent update. New items appear here the moment something goes quiet." compact />
              )}
            </div>
            {d.snoozed.length > 0 && (
              <details className="group mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 py-1 text-[12.5px] text-ink-3 hover:text-ink">
                  <AlarmClockOff size={12} /> {plural(d.snoozed.length, "snoozed item")}
                  <ArrowRight size={11} className="transition-transform group-open:rotate-90" />
                </summary>
                <div className="card mt-1.5 overflow-hidden">
                  {d.snoozed.map((s) => (
                    <div key={s.task.id} className="flex items-center gap-3 border-b border-line/70 px-3 py-2 last:border-0">
                      <Link href={`/tasks/${s.task.id}`} className="min-w-0 flex-1 truncate text-[13px] text-ink-2 hover:text-ink">{s.task.title}</Link>
                      <span className="shrink-0 text-[12px] text-ink-4">until {fmtDate(s.until, { dow: true })}</span>
                      <UnsnoozeButton taskId={s.task.id} />
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>

          {/* Waiting for response */}
          <section id="awaiting" className="scroll-mt-6">
            <Heading icon={<Hourglass size={13} />} title="Waiting for response" count={d.awaiting.length} hint="Requests you've sent that haven't been answered with an update" />
            <div className="card overflow-hidden">
              {d.awaiting.length ? d.awaiting.map((f) => <AwaitingRow key={f.id} f={f} />) : (
                <EmptyState icon={<CheckCheck size={18} />} title="No unanswered requests" body="Everyone you've asked has responded." compact />
              )}
            </div>
          </section>

          {/* Where I'm waiting on someone */}
          <section>
            <Heading icon={<Inbox size={13} />} title="Where you're waiting on someone" count={d.waitingOnSomeone.length} hint="Your own tasks parked on another person" />
            <div className="card overflow-hidden">
              <TaskList tasks={d.waitingOnSomeone} showOwner={false}
                empty={<EmptyState compact icon={<Hourglass size={18} />} title="You're not blocked on anyone" body="Set a task to Waiting and choose who you're waiting on to track it here." />} />
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-8">
          {/* Responded recently */}
          <section>
            <Heading icon={<CheckCheck size={13} />} title="Responded recently" count={d.responded.length} />
            <div className="card divide-y divide-line/70 overflow-hidden">
              {d.responded.length ? d.responded.map((f) => (
                <Link key={f.id} href={`/tasks/${f.task_id}`} className="block px-4 py-3 hover:bg-subtle/60">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <Avatar name={f.person_name} color={f.person_color} size={20} />
                    <span className="font-medium text-ink">{f.person_name ?? "Owner"}</span>
                    <span className="text-ink-4">responded {ago(f.responded_at ?? f.created_at)}</span>
                  </div>
                  <div className="mt-1 truncate text-[13px] text-ink-2">{f.task_title}</div>
                  {(f.response ?? f.last_update_note) && <p className="mt-1 line-clamp-2 border-l-2 border-ok/40 pl-2.5 text-[12.5px] text-ink-3">{f.response ?? f.last_update_note}</p>}
                </Link>
              )) : <p className="px-4 py-6 text-center text-[12.5px] text-ink-4">Responses from the last 7 days show up here.</p>}
            </div>
          </section>

          {/* Follow-up log */}
          <section id="log" className="scroll-mt-6">
            <Heading icon={<Send size={13} />} title="Follow-up log" count={d.log.length} />
            <div className="card overflow-hidden">
              {d.log.length ? (
                <ol className="divide-y divide-line/70">
                  {d.log.map((f) => (
                    <li key={f.id} className="flex gap-3 px-4 py-2.5">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", f.status === "open" ? "bg-warn" : f.status === "responded" ? "bg-ok" : "bg-ink-4")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                          <span className="truncate"><span className="text-ink">{f.person_name ?? "Owner"}</span> <span className="text-ink-4">·</span> <Link href={`/tasks/${f.task_id}`} className="text-ink-2 hover:text-ink hover:underline">CO-{f.task_number}</Link></span>
                          <time className="shrink-0 text-[11.5px] tabular text-ink-4" title={`${fmtDate(dateOf(f.created_at), { dow: true })} · ${fmtTime(f.created_at)}`}>{ago(f.created_at)}</time>
                        </div>
                        {f.message && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{f.message}</p>}
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-4">
                          <span>{CHANNEL[f.channel]}</span><span>·</span>
                          <span className={cn(f.status === "open" ? "text-warn" : f.status === "responded" ? "text-ok" : "")}>{f.status === "open" ? `Open ${f.age_days}d` : f.status === "responded" ? "Responded" : f.status === "closed" ? "Closed" : "Cancelled"}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState compact icon={<Send size={18} />} title="No follow-ups yet" body="Every update you request is logged here with its channel and outcome." />}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ href, label, value, hint, tone }: { href: string; label: string; value: React.ReactNode; hint: string; tone?: "red" | "amber" }) {
  return (
    <a href={href} className="group block px-5 py-4 transition-colors hover:bg-subtle/50">
      <div className="eyebrow mb-1.5 flex items-center justify-between">{label}<ArrowRight size={12} className="text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" /></div>
      <div className="font-serif text-[22px] leading-none tabular text-ink">{value}</div>
      <div className={cn("mt-1.5 text-[12px]", tone === "red" ? "text-bad" : tone === "amber" ? "text-warn" : "text-ink-3")}>{hint}</div>
    </a>
  );
}

function Heading({ icon, title, count, hint }: { icon: React.ReactNode; title: string; count?: number; hint?: string }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        <span className="text-ink-4">{icon}</span>{title}
        {count != null && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tracking-normal text-ink-2">{count}</span>}
      </h2>
      {hint && <span className="text-[12px] text-ink-4">{hint}</span>}
    </div>
  );
}

function QueueRow({ i }: { i: FollowupItem }) {
  const t = i.task;
  const td = today();
  const s = SEV[i.severity];
  const who = ownerLabel(t);
  const overdue = t.due_date && t.due_date < td;
  return (
    <div className="group flex flex-col gap-2 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-subtle/40 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="relative mt-0.5 shrink-0">
          {t.owner_name ? <Avatar name={t.owner_name} color={t.owner_color} size={28} />
            : <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-[10.5px] font-semibold text-ink-2">{(t.owner_team_name ?? "?").slice(0, 2).toUpperCase()}</span>}
          <span className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-surface", s.dot)} title={`${s.label} severity`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-ink">{i.reason}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
            <Link href={`/tasks/${t.id}`} className="font-mono text-[11px] text-ink-4 hover:text-ink">CO-{t.number}</Link>
            <span>·</span>
            <span>{TASK_STATUS[t.status].label}</span>
            <span>·</span>
            <span className={cn(overdue ? "font-medium text-bad" : t.due_date === td ? "text-warn" : "")}>
              {t.due_date ? (overdue ? `Due ${fmtDate(t.due_date)} · ${diffDays(td, t.due_date)}d late` : `Due ${relDay(t.due_date).toLowerCase()}`) : "No due date"}
            </span>
            <span>·</span>
            <span className={cn(i.daysSinceUpdate >= 5 && "text-warn")}>{i.daysSinceUpdate === 0 ? "Updated today" : `Last update ${i.daysSinceUpdate}d ago`}</span>
            {t.open_followups > 0 && <Badge tone="amber" className="h-[18px] text-[10.5px]">{t.open_followups} unanswered</Badge>}
            {t.project_code && <span className="rounded px-1 text-[11px] ring-1 ring-inset ring-line">{t.project_code}</span>}
          </div>
          {t.last_update_note && <p className="mt-1 truncate text-[12px] text-ink-4">“{t.last_update_note}”</p>}
        </div>
      </div>
      <div className="pl-10 sm:pl-0"><FollowupRowActions taskId={t.id} who={who} /></div>
    </div>
  );
}

function AwaitingRow({ f }: { f: FollowupRow }) {
  const tone = f.age_days >= 3 ? "text-bad" : f.age_days >= 1 ? "text-warn" : "text-ink-3";
  return (
    <div className="group flex items-start gap-3 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-subtle/40">
      <Avatar name={f.person_name} color={f.person_color} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span className="font-medium text-ink">{f.person_name ?? "Owner"}</span>
          <span className="text-ink-3">hasn't responded on</span>
          <Link href={`/tasks/${f.task_id}`} className="min-w-0 truncate text-ink hover:underline">{f.task_title}</Link>
        </div>
        {f.message && <p className="mt-1 line-clamp-2 border-l-2 border-line-strong pl-2.5 text-[12.5px] text-ink-3">{f.message}</p>}
        <div className="mt-1 text-[11.5px] text-ink-4">{CHANNEL[f.channel]} · sent {fmtDate(dateOf(f.created_at), { dow: true })}, {fmtTime(f.created_at)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn("text-[12px] font-medium tabular", tone)}>{f.age_days === 0 ? "Today" : `${f.age_days}d`}</span>
        <ButtonLink href={`/tasks/${f.task_id}`} size="xs" variant="ghost">Open</ButtonLink>
        <span className="opacity-0 group-hover:opacity-100"><CloseFollowupButton id={f.id} /></span>
      </div>
    </div>
  );
}
