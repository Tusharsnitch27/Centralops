import Link from "next/link";
import { ArrowRight, ArrowUpRight, Boxes, CalendarClock, CheckCheck, Gavel, Rocket, Video } from "lucide-react";
import { Avatar, AvatarStack, Badge, ButtonLink, Card, CardHeader, EmptyState } from "@/components/ui";
import { AttentionList } from "@/components/home/Attention";
import { AopTrend } from "@/components/home/AopTrend";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser } from "@/server/auth";
import { runSweeps } from "@/server/inbox/sweep";
import { attention } from "@/server/home/attention";
import { aopOutcome, dueToday, followupPreview, homeStats, todaySchedule } from "@/server/home/overview";
import { sopHeadline } from "@/server/sop/summary";
import { q } from "@/server/db";
import { fmtDate, fmtMonth, fmtTime, relDay, today } from "@/lib/dates";
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
  const [items, stats, schedule, due, aop, sop, follow, decisions] = await Promise.all([
    attention(u), homeStats(u), todaySchedule(u), dueToday(u), aopOutcome(), sopHeadline(), followupPreview(u),
    q<{ id: string; title: string; due_date: string | null; maker: string | null }>(
      `select d.id, d.title, d.due_date, m.name as maker from decisions d left join users m on m.id = d.decision_maker_id
       where d.status in ('pending','proposed') order by d.due_date nulls last limit 4`),
  ]);
  const now = Date.now();
  const first = u.name.split(" ")[0];
  const cost = aop?.kind === "cost";
  const aopTone: Tone = aop?.status === "delayed" ? "red" : aop?.status === "at_risk" ? "amber" : "green";

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="eyebrow mb-2">{fmtDate(today(), { dow: true })}</div>
          <h1 className="font-serif text-[38px] leading-[1.05] tracking-[-0.015em]">{greeting()}, {first}</h1>
          <p className="mt-2 text-[14px] text-ink-3">
            {items.length ? <>Here’s what needs your attention today — <span className="text-ink-2">{plural(items.length, "item")}</span>, most important first.</> : "Nothing needs your attention right now. Enjoy the calm."}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-7 gap-y-3">
          {[
            { k: "Meetings today", v: stats.meetingsToday, href: "/meetings" },
            { k: "Open tasks", v: stats.openTasks, href: "/tasks" },
            { k: "Overdue", v: stats.overdue, href: "/tasks?view=overdue", tone: stats.overdue ? "text-bad" : "" },
            { k: "To follow up", v: stats.followupsDue, href: "/followups", tone: stats.followupsDue ? "text-warn" : "" },
            { k: "MoMs pending", v: stats.momPending, href: "/meetings", tone: stats.momPending ? "text-warn" : "" },
          ].map((s) => (
            <Link key={s.k} href={s.href} className="group">
              <dt className="text-[11.5px] text-ink-3 group-hover:text-ink-2">{s.k}</dt>
              <dd className={cn("font-serif text-[26px] leading-tight tabular", s.tone)}>{s.v}</dd>
            </Link>
          ))}
        </dl>
      </header>

      {!u.onboarded_at && (
        <Link href="/welcome" className="group flex items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong" style={{ boxShadow: "var(--shadow-card)" }}>
          <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-white"><Rocket size={17} /></span>
          <div className="flex-1">
            <div className="text-[14px] font-semibold">Capture everything you’re working on</div>
            <div className="text-[12.5px] text-ink-3">Dump your projects, open actions, recurring reviews and the people you’re waiting on — Central Ops structures it and tracks from today.</div>
          </div>
          <span className="flex items-center gap-1 text-[13px] font-medium text-ink">Start <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
        </Link>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {/* Attention */}
          <Card className="overflow-hidden">
            <CardHeader title="Needs your attention" subtitle="Ranked across tasks, follow-ups, meetings, decisions, AOP and S&OP" />
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
                          <span className="truncate text-[13.5px] font-medium">{m.title}</span>
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
          {aop && (
            <Card className="overflow-hidden">
              <div className="px-4 pt-4">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">{aop.cycleName}</span>
                  <Badge tone={aopTone} dot>{aop.status === "on_track" ? "On track" : aop.status === "at_risk" ? "Watch" : cost ? "Over budget" : "Behind plan"}</Badge>
                </div>
                <div className="mt-3 font-serif text-[30px] leading-none tabular">{inr(aop.ytdActual)}</div>
                <div className="mt-1 text-[12px] text-ink-3">{aop.labels.actual} YTD through {fmtMonth(aop.lastClosed)} (lines with actuals)</div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <span className={cn("font-medium tabular", (cost ? aop.variance > 0 : aop.variance < 0) ? "text-bad" : "text-ok")}>{inr(aop.variance, { sign: true })} vs {aop.labels.plan.toLowerCase()}</span>
                  <span className="text-ink-3">{pct(aop.variancePct, 1, true)}</span>
                  <span className="text-ink-3">· FY projection {inr(aop.projection)} of {inr(aop.fyPlan)}</span>
                </div>
              </div>
              <div className="px-2 pt-2"><AopTrend data={aop.trend} labels={aop.labels} /></div>
              <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
                <ButtonLink href="/aop" variant="secondary" size="xs">View deviations</ButtonLink>
                <ButtonLink href="/aop/inputs" variant="ghost" size="xs">Input status</ButtonLink>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader title="Follow up today" subtitle="Delegated work with no recent update" action={<ButtonLink href="/followups" variant="ghost" size="xs">All <ArrowUpRight size={12} /></ButtonLink>} />
            {follow.length ? (
              <div className="divide-y divide-line/70">
                {follow.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                    <Avatar name={t.owner_name ?? t.owner_team_name} color={t.owner_color} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{t.title}</div>
                      <div className="text-[11.5px] text-ink-3">{t.owner_name ?? t.owner_team_name ?? "Unassigned"} · no update in {t.days_since_update}d{t.due_date ? ` · due ${relDay(t.due_date).toLowerCase()}` : ""}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : <EmptyState compact title="No one to chase" body="Every delegated task has a recent update." />}
          </Card>

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

          <Card className="overflow-hidden">
            <CardHeader title="Decisions pending" icon={<Gavel size={15} />} action={<ButtonLink href="/decisions" variant="ghost" size="xs">Log <ArrowUpRight size={12} /></ButtonLink>} />
            {decisions.length ? (
              <div className="divide-y divide-line/70">
                {decisions.map((d) => (
                  <Link key={d.id} href={`/decisions?focus=${d.id}`} className="block px-4 py-2.5 hover:bg-subtle/60">
                    <div className="text-[13px]">{d.title}</div>
                    <div className="text-[11.5px] text-ink-3">{d.maker ?? "—"}{d.due_date ? ` · by ${fmtDate(d.due_date)}` : ""}</div>
                  </Link>
                ))}
              </div>
            ) : <EmptyState compact title="No decisions pending" />}
          </Card>
        </div>
      </div>
    </div>
  );
}
