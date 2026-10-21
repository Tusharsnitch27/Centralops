import Link from "next/link";
import { TaskLinks } from "@/components/tasks/TaskLinks";
import { TaskPeoplePanel } from "@/components/tasks/TaskPeoplePanel";
import { taskPeople } from "@/server/tasks/people";
import { goalOptions } from "@/server/goals/queries";
import { notFound } from "next/navigation";
import { AlertOctagon, ArrowUpRight, BellRing, CalendarClock, ChevronRight, CornerDownRight, Hourglass, MessageCircleQuestion, Route } from "lucide-react";
import { Avatar, Badge, HealthBadge, PriorityIcon, StatusBadge } from "@/components/ui";
import { DescriptionEditor, DependencyEditor, LinkList, TagEditor, TaskProperties, TitleEditor } from "@/components/tasks/TaskEditors";
import { RequestUpdateButton, TaskComposer } from "@/components/tasks/TaskComposer";
import { TaskJourney, journeySummary } from "@/components/tasks/TaskJourney";
import { CloseFollowupButton } from "@/components/tasks/FollowupActions";
import { TaskCheck } from "@/components/tasks/TaskCheck";
import { requireUser, canEdit } from "@/server/auth";
import { canSeeTask } from "@/server/org/queries";
import { listPeople, listProgramsLite, listProjectsLite, listTeams } from "@/server/core/people";
import { taskDetailBundle } from "@/server/tasks/detail";
import { listTags } from "@/server/tasks/views";
import { ago, dateOf, diffDays, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { PRIORITY, TASK_SOURCE, TASK_STATUS } from "@/lib/meta";
import { cn } from "@/lib/cn";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await taskDetailBundle(id).catch(() => null);
  return { title: b ? `CO-${b.task.number} · ${b.task.title}` : "Task" };
}

const CHANNEL: Record<string, string> = { in_app: "In-app", email: "Email", slack: "Slack", whatsapp: "WhatsApp" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await canSeeTask(u, id))) notFound();
  const [b, people, teams, projects, programs, tags, tp, goals] = await Promise.all([
    taskDetailBundle(id), listPeople(), listTeams(), listProjectsLite(), listProgramsLite(), listTags(), taskPeople(id), goalOptions(),
  ]);
  if (!b) notFound();
  const { task: t, journey, thread, attachments, deps, related, followups } = b;
  const readOnly = !canEdit(u);
  const td = today();
  const open = t.status !== "completed" && t.status !== "cancelled";
  const overdue = open && t.due_date != null && t.due_date < td;
  const ownerLabel = t.owner_name ?? (t.owner_team_name ? `${t.owner_team_name} team` : null);
  const openFollowups = followups.filter((f) => f.status === "open");
  const projectOpts = projects.some((p) => p.id === t.project_id) || !t.project_id ? projects : [...projects, { id: t.project_id, name: t.project_name ?? "Project", code: null, program_id: t.program_id }];
  const summary = journeySummary(journey);
  const relatedShown = related.filter((r) => !(r.type === "meeting" && r.id === t.meeting_id) && !(r.type === "project" && r.id === t.project_id));

  return (
    <div>
      {/* breadcrumb + actions */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <Link href="/tasks" className="hover:text-ink">Tasks</Link>
          <ChevronRight size={13} className="text-ink-4" />
          {t.project_id && <><Link href={`/tasks/goals#project-${t.project_id}`} className="max-w-[220px] truncate hover:text-ink">{t.project_name}</Link><ChevronRight size={13} className="text-ink-4" /></>}
          <span className="font-mono text-[12px] text-ink-2">CO-{t.number}</span>
        </nav>
        <div className="flex items-center gap-2">
          {open && t.owner_id !== u.id && <RequestUpdateButton id={t.id} ownerLabel={ownerLabel} title={t.title} disabled={readOnly} />}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="mt-3.5"><TaskCheck id={t.id} status={t.status} disabled={readOnly} /></div>
            <div className="min-w-0 flex-1"><TitleEditor id={t.id} title={t.title} readOnly={readOnly} /></div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px] text-[12.5px] text-ink-3">
            <StatusBadge status={t.status} />
            <HealthBadge health={t.health} />
            <Badge tone={t.priority === "urgent" ? "red" : "neutral"}><PriorityIcon priority={t.priority} className="scale-75" />{PRIORITY[t.priority].label}</Badge>
            {t.due_date && (
              <Badge tone={overdue ? "red" : t.due_date === td && open ? "amber" : "muted"}>
                <CalendarClock size={11} />{overdue ? `${diffDays(td, t.due_date)}d overdue` : `Due ${relDay(t.due_date).toLowerCase()}`}
              </Badge>
            )}
            <span className="mx-1 h-3 w-px bg-line-strong" />
            <span>
              {t.meeting_id
                ? <>From <Link href={`/meetings/${t.meeting_id}`} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">{t.meeting_title}</Link></>
                : <>{TASK_SOURCE[t.source as keyof typeof TASK_SOURCE] ?? t.source}</>}
              {" · "}created by {t.created_by_name ?? "system"} {ago(t.created_at)}
            </span>
          </div>

          {/* attention callouts */}
          <div className="mt-5 space-y-2">
            {t.status === "blocked" && (
              <Callout tone="red" icon={<AlertOctagon size={14} />} title="Blocked">
                {t.blocker ?? "No blocker reason recorded — ask the owner what's in the way."}
              </Callout>
            )}
            {t.status === "waiting" && (
              <Callout tone="amber" icon={<Hourglass size={14} />} title={t.waiting_on_name ? `Waiting on ${t.waiting_on_name}` : "Waiting"}>
                {t.next_step ?? "Parked until someone else responds."}
              </Callout>
            )}
            {openFollowups.length > 0 && open && (
              <Callout tone="amber" icon={<MessageCircleQuestion size={14} />}
                title={`${openFollowups.length === 1 ? "Update requested" : `${openFollowups.length} update requests`} — no response yet`}>
                {openFollowups[0]!.requested_by_name ?? "Someone"} asked {openFollowups[0]!.person_name ?? "the owner"} {ago(openFollowups[0]!.created_at)}
                {openFollowups[0]!.message && <>: “{openFollowups[0]!.message}”</>}
              </Callout>
            )}
            {open && t.last_update_note && (
              <div className="flex gap-3 rounded-xl border border-line bg-subtle/50 px-4 py-3">
                <CornerDownRight size={14} className="mt-0.5 shrink-0 text-ink-4" />
                <div className="min-w-0 text-[13px]">
                  <div className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">
                    Last update · <span className={cn(t.days_since_update >= 5 && "text-warn")}>{ago(t.last_update_at)}</span>
                  </div>
                  <p className="mt-0.5 text-ink-2">{t.last_update_note}</p>
                </div>
              </div>
            )}
          </div>

          <Section title="Description" className="mt-7">
            <DescriptionEditor id={t.id} description={t.description} readOnly={readOnly} />
          </Section>

          <Section title="Updates & discussion" count={thread.length} className="mt-8">
            <div className="space-y-4">
              {thread.map((c) => (
                <div key={`${c.kind}-${c.id}`} className="flex gap-3">
                  <Avatar name={c.author_name} color={c.author_color} size={28} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                      <span className="font-medium text-ink">{c.author_name ?? "Someone"}</span>
                      {c.kind === "update"
                        ? <Badge tone="info">Update{c.status && ` · ${TASK_STATUS[c.status as keyof typeof TASK_STATUS]?.label ?? c.status}`}</Badge>
                        : <span className="text-ink-4">commented</span>}
                      <span className="text-ink-4" title={`${fmtDate(dateOf(c.created_at), { dow: true })} · ${fmtTime(c.created_at)}`}>{ago(c.created_at)}</span>
                    </div>
                    <p className={cn("mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2", c.kind === "update" && "rounded-lg border border-line bg-surface px-3 py-2")}>{c.body}</p>
                  </div>
                </div>
              ))}
              {!thread.length && <p className="text-[13px] text-ink-4">No updates yet. {t.owner_id === u.id ? "Post the first one so everyone knows where this stands." : "Updates from the owner will appear here."}</p>}
              <TaskComposer id={t.id} status={t.status} me={{ name: u.name, color: u.avatar_color }} isOwner={t.owner_id === u.id} readOnly={readOnly} />
            </div>
          </Section>

          <Section title="Task journey" icon={<Route size={13} />} className="mt-10"
            aside={<span className="hidden text-[12px] text-ink-3 sm:block">{summary.join(" · ")}</span>}>
            <div className="card px-4 pb-2 pt-4 sm:px-5">
              <TaskJourney events={journey} open={open} dueDate={t.due_date} ownerLabel={ownerLabel} />
            </div>
          </Section>
        </div>

        {/* properties sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <SideCard title="People & blockers">
            <TaskPeoplePanel taskId={t.id} ownerId={t.owner_id} assignees={tp.assignees} blockers={tp.blockers} goalId={t.goal_id} goals={goals} readOnly={readOnly}
              people={people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color }))} />
          </SideCard>
          <SideCard title="Links">
            <TaskLinks id={t.id} links={t.links ?? []} readOnly={readOnly} />
          </SideCard>
          <SideCard title="Properties">
            <TaskProperties readOnly={readOnly}
              t={{ id: t.id, status: t.status, health: t.health, priority: t.priority, owner_id: t.owner_id, owner_team_id: t.owner_team_id, requester_id: t.requester_id,
                due_date: t.due_date, start_date: t.start_date, original_due_date: t.original_due_date, project_id: t.project_id, program_id: t.program_id, program_name: t.program_name,
                waiting_on_id: t.waiting_on_id, next_step: t.next_step, blocker: t.blocker }}
              options={{
                people: people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color, title: p.title })),
                teams: teams.map((x) => ({ id: x.id, name: x.name })),
                projects: projectOpts.map((p) => ({ id: p.id, name: p.name, code: p.code })),
                programs: programs.map((p) => ({ id: p.id, name: p.name, code: p.code })),
              }} />
            <div className="mt-2 space-y-1 border-t border-line px-2 pt-3 text-[12.5px]">
              {t.poc_name && <Meta label="POC">{t.poc_name}</Meta>}
              <Meta label="Source">{TASK_SOURCE[t.source as keyof typeof TASK_SOURCE] ?? t.source}</Meta>
              {t.meeting_id && (
                <Meta label="Meeting">
                  <Link href={`/meetings/${t.meeting_id}`} className="inline-flex max-w-full items-center gap-1 truncate text-ink hover:underline">
                    <span className="truncate">{t.meeting_title}</span><ArrowUpRight size={12} className="shrink-0 text-ink-4" />
                  </Link>
                  {t.meeting_starts_at && <div className="text-[11.5px] text-ink-4">{fmtDate(dateOf(t.meeting_starts_at), { dow: true })}</div>}
                </Meta>
              )}
              <Meta label="Acknowledged">{t.acknowledged_at ? ago(t.acknowledged_at) : <span className="text-warn">Not yet</span>}</Meta>
              {t.completed_at && <Meta label="Completed">{fmtDate(dateOf(t.completed_at), { dow: true })}</Meta>}
            </div>
          </SideCard>

          <SideCard title="Tags"><div className="px-2"><TagEditor id={t.id} tags={b.tags} suggestions={tags.map((x) => x.tag)} readOnly={readOnly} /></div></SideCard>

          <SideCard title="Dependencies"><DependencyEditor id={t.id} blockedBy={deps.blockedBy} blocking={deps.blocking} readOnly={readOnly} /></SideCard>

          <SideCard title="Links" count={attachments.length}><LinkList id={t.id} links={attachments} readOnly={readOnly} /></SideCard>

          <SideCard title="Follow-ups" count={followups.length}>
            {followups.length ? (
              <ol className="space-y-1">
                {followups.map((f) => (
                  <li key={f.id} className="group/fu flex gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle">
                    <BellRing size={13} className={cn("mt-0.5 shrink-0", f.status === "open" ? "text-warn" : "text-ink-4")} />
                    <div className="min-w-0 flex-1 text-[12.5px]">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-ink">{f.requested_by_name?.split(" ")[0] ?? "Someone"} → {f.person_name?.split(" ")[0] ?? "owner"}</span>
                        <Badge tone={f.status === "open" ? "amber" : f.status === "responded" ? "green" : "muted"} className="h-[18px] text-[10.5px]">{f.status === "open" ? `Open ${f.age_days}d` : f.status}</Badge>
                      </div>
                      {f.message && <p className="mt-0.5 line-clamp-2 text-ink-3">{f.message}</p>}
                      <div className="mt-0.5 text-[11px] text-ink-4">{CHANNEL[f.channel]} · {ago(f.created_at)}{f.responded_at && ` · answered ${ago(f.responded_at)}`}</div>
                    </div>
                    {f.status === "open" && !readOnly && <span className="opacity-0 group-hover/fu:opacity-100"><CloseFollowupButton id={f.id} /></span>}
                  </li>
                ))}
              </ol>
            ) : <p className="px-2 text-[12.5px] text-ink-4">No follow-ups sent.</p>}
          </SideCard>

          {relatedShown.length > 0 && (
            <SideCard title="Related" count={relatedShown.length}>
              {relatedShown.map((r) => {
                const inner = (
                  <>
                    <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.04em] text-ink-4">{r.type.replace(/_/g, " ")}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
                    {r.relation !== "related" && <span className="shrink-0 text-[11px] text-ink-4">{r.relation}</span>}
                  </>
                );
                return r.href
                  ? <Link key={`${r.type}${r.id}${r.relation}`} href={r.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-subtle">{inner}</Link>
                  : <div key={`${r.type}${r.id}${r.relation}`} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]">{inner}</div>;
              })}
            </SideCard>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, count, icon, aside, className, children }: { title: string; count?: number; icon?: React.ReactNode; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          {icon}{title}
          {count != null && count > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tracking-normal text-ink-2">{count}</span>}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SideCard({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="card p-2">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}{count != null && count > 0 && <span className="font-medium tracking-normal text-ink-4">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <div className="w-[84px] shrink-0 text-ink-3">{label}</div>
      <div className="min-w-0 flex-1 text-ink-2">{children}</div>
    </div>
  );
}

function Callout({ tone, icon, title, children }: { tone: "red" | "amber"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3", tone === "red" ? "border-bad/20 bg-bad-soft/70" : "border-warn/20 bg-warn-soft/70")}>
      <span className={cn("mt-0.5 shrink-0", tone === "red" ? "text-bad" : "text-warn")}>{icon}</span>
      <div className="min-w-0 text-[13px]">
        <div className={cn("font-medium", tone === "red" ? "text-bad" : "text-warn")}>{title}</div>
        <p className="mt-0.5 text-ink-2">{children}</p>
      </div>
    </div>
  );
}
