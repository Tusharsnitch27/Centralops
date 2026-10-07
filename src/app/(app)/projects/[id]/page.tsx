import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft, Gavel, ListChecks, MessageSquareText, ShieldAlert } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Progress, Prop, Tabs } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { ExecSummaryCard } from "@/components/projects/ExecSummary";
import { HealthPicker, RequestUpdateButton, StatusPicker } from "@/components/projects/ProjectControls";
import { MilestoneList, MilestoneTimeline, type MilestoneView } from "@/components/projects/Milestones";
import { UpdateComposer } from "@/components/projects/UpdateComposer";
import { LatestUpdateStrip, UpdateFeed } from "@/components/projects/UpdateFeed";
import { AddProjectTask, FileLinks } from "@/components/projects/ProjectExtras";
import { ProjectFormButton } from "@/components/projects/ProjectForm";
import { DecisionList } from "@/components/decisions/DecisionList";
import { DecisionFormButton } from "@/components/decisions/DecisionForm";
import { toDecisionView } from "@/components/decisions/view";
import { RiskTable } from "@/components/risks/RiskTable";
import { RiskFormButton } from "@/components/risks/RiskForm";
import { toRiskView } from "@/components/risks/view";
import { requireUser, canEdit, canManage } from "@/server/auth";
import { aiConfigured } from "@/server/ai/provider";
import { getProject, listAttachments, listMilestones, listProjectUpdates, openProjectFollowups, projectMeetings } from "@/server/projects/queries";
import { projectExecSummary } from "@/server/projects/exec";
import { pctInt } from "@/server/projects/metrics";
import { listTasks } from "@/server/tasks/queries";
import { listDecisions } from "@/server/decisions/queries";
import { decisionFormOptions } from "@/server/decisions/options";
import { pickerOptions } from "@/server/projects/options";
import { listRisks } from "@/server/risks/queries";
import { ago, dateOf, diffDays, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { inr, plural } from "@/lib/format";
import { MOM_STATUS, type Tone } from "@/lib/meta";
import { cn } from "@/lib/cn";

export const metadata = { title: "Project" };

const TABS = ["overview", "tasks", "milestones", "meetings", "decisions", "risks", "updates", "files"] as const;
type Tab = (typeof TABS)[number];

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, sp, user] = await Promise.all([params, searchParams, requireUser()]);
  const p = await getProject(id);
  if (!p) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const td = today();

  const [milestones, updates, tasks, decisions, risks, meetings, files, followups, exec, opts] = await Promise.all([
    listMilestones([id]), listProjectUpdates(id), listTasks({ projectId: id }), listDecisions({ projectId: id }), listRisks({ projectId: id, status: "active" }),
    projectMeetings(id), listAttachments("project", id), openProjectFollowups(id), projectExecSummary(id), decisionFormOptions(),
  ]);
  const base0 = await pickerOptions();
  const allRisks = tab === "risks" ? [...risks, ...(await listRisks({ projectId: id, status: "closed" }))] : risks;

  const editable = canEdit(user) && (canManage(user) || p.owner_id === user.id);
  const contributor = canEdit(user);
  const msView: MilestoneView[] = milestones.map((m) => ({ id: m.id, title: m.title, due_date: m.due_date, baseline_date: m.baseline_date, status: m.status, slip: m.slip, overdue: m.overdue, completed_at: m.completed_at ? String(m.completed_at) : null }));
  const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const overdue = openTasks.filter((t) => t.due_date && t.due_date < td);
  const pendingDecisions = decisions.filter((d) => d.status === "pending" || d.status === "proposed");
  const lastUpd = updates[0];
  const daysSince = lastUpd ? diffDays(td, dateOf(lastUpd.created_at)) : null;
  const pickers = { people: opts.people, projects: opts.projects };
  const base = `/projects/${id}`;
  const tabHref = (k: Tab) => (k === "overview" ? base : `${base}?tab=${k}`);
  const isOwner = p.owner_id === user.id;

  const updateDefaults = { percent: lastUpd?.percent_complete ?? pctInt(p.progress), health: p.health, expected: lastUpd?.expected_completion ?? p.target_date, previousBlockers: lastUpd?.blockers ?? null };

  return (
    <div>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ChevronLeft size={14} />Projects</Link>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">{p.code && <span className="font-mono">{p.code}</span>}{p.program_id && <><span>·</span><Link href={`/programs/${p.program_id}`} className="hover:text-ink">{p.program_name}</Link></>}</span>}
        title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <HealthPicker projectId={id} health={p.health} disabled={!editable} />
          <StatusPicker projectId={id} status={p.status} disabled={!editable} />
          <span className="text-ink-4">·</span>
          <span>{pctInt(p.progress)}% complete</span>
          <span className="text-ink-4">·</span>
          <span className={cn(p.target_date && p.target_date < td && "text-bad")}>Target {fmtDate(p.target_date)}</span>
          {daysSince != null && <><span className="text-ink-4">·</span><span className={cn(daysSince >= 7 && "text-warn")}>Updated {daysSince === 0 ? "today" : `${daysSince}d ago`}</span></>}
        </span>}
        actions={<>
          {!isOwner && <RequestUpdateButton projectId={id} ownerName={p.owner_name} openRequests={followups.length} />}
          {contributor && <UpdateComposer projectId={id} defaults={updateDefaults} variant={isOwner ? "primary" : "secondary"} />}
          {editable && <ProjectFormButton options={base0} variant="ghost"
            initial={{ id, name: p.name, code: p.code ?? "", programId: p.program_id, ownerId: p.owner_id, sponsorId: p.sponsor_id, teamIds: p.teams.map((t) => t.id), startDate: p.start_date ?? "", targetDate: p.target_date ?? "", objective: p.objective ?? "", budget: p.budget != null ? String(p.budget) : "", spent: p.spent != null ? String(p.spent) : "" }} />}
        </>}
      />

      <Tabs className="mb-6" active={tab} items={[
        { key: "overview", label: "Overview", href: tabHref("overview") },
        { key: "tasks", label: "Tasks", href: tabHref("tasks"), count: openTasks.length },
        { key: "milestones", label: "Milestones", href: tabHref("milestones"), count: milestones.length },
        { key: "meetings", label: "Meetings", href: tabHref("meetings"), count: meetings.length },
        { key: "decisions", label: "Decisions", href: tabHref("decisions"), count: pendingDecisions.length },
        { key: "risks", label: "Risks", href: tabHref("risks"), count: risks.length },
        { key: "updates", label: "Updates", href: tabHref("updates"), count: updates.length },
        { key: "files", label: "Files", href: tabHref("files"), count: files.length },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-6">
            {exec && <ExecSummaryCard name={p.name} s={exec} aiEnabled={aiConfigured()} />}
            {p.objective && (
              <section>
                <div className="eyebrow mb-1.5">Objective</div>
                <p className="text-[14px] leading-relaxed text-ink-2">{p.objective}</p>
              </section>
            )}
            <Card>
              <CardHeader title="Milestones" subtitle={milestones.some((m) => m.slip > 0) ? `${plural(milestones.filter((m) => m.status !== "done" && m.slip > 0).length, "milestone")} slipped vs baseline` : "Plan vs current"}
                action={<ButtonLink href={tabHref("milestones")} size="xs" variant="ghost">Manage</ButtonLink>} />
              {msView.length ? <div className="px-4 pt-4 pb-2"><MilestoneTimeline milestones={msView} start={p.start_date} target={p.target_date} /></div>
                : <EmptyState compact title="No milestones yet" body="Add milestones to track progress and slips." action={<ButtonLink href={tabHref("milestones")} size="sm">Add milestones</ButtonLink>} />}
            </Card>
            <Card>
              <CardHeader title="Needs attention" subtitle={overdue.length || pendingDecisions.length ? undefined : "Nothing overdue"} icon={<ListChecks size={15} />}
                action={<ButtonLink href={tabHref("tasks")} size="xs" variant="ghost">All tasks</ButtonLink>} />
              <TaskList tasks={(overdue.length ? overdue : openTasks.filter((t) => t.status === "blocked" || (t.due_date && diffDays(t.due_date, td) <= 3))).slice(0, 6)} showProject={false}
                empty={<p className="px-4 py-5 text-[13px] text-ink-3">No overdue or blocked actions on this project. {openTasks.length ? `${plural(openTasks.length, "open task")} on track.` : ""}</p>} />
              {pendingDecisions.length > 0 && (
                <div className="border-t border-line px-4 py-3">
                  {pendingDecisions.map((d) => (
                    <Link key={d.id} href={`/decisions?focus=${d.id}`} className="flex items-center gap-2 py-1 text-[13px] text-ink-2 hover:text-ink">
                      <Gavel size={13} className="text-warn" /><span className="truncate">Decision required: {d.title}</span>
                      {d.due_date && <span className={cn("ml-auto shrink-0 text-[12px] tabular", d.due_date < td ? "text-bad" : "text-ink-3")}>{relDay(d.due_date)}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
            {lastUpd && (
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Latest update</span><Link href={tabHref("updates")} className="text-[12px] text-ink-3 hover:text-ink">All updates</Link></div>
                <LatestUpdateStrip updates={updates} />
              </Card>
            )}
          </div>
          <aside className="space-y-4">
            <Card className="p-4">
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between text-[12px]"><span className="text-ink-3">Progress</span><span className="font-medium tabular">{pctInt(p.progress)}%</span></div>
                <Progress value={p.progress} tone={p.health === "on_track" ? "neutral" : p.health === "at_risk" ? "amber" : "red"} />
                <div className="mt-1.5 text-[11.5px] text-ink-4">{p.ms_done}/{p.ms_total} milestones · {p.tasks_done}/{p.tasks_total} tasks{lastUpd?.percent_complete != null ? ` · owner says ${lastUpd.percent_complete}%` : ""}</div>
              </div>
              <div className="border-t border-line pt-2">
                <Prop label="Owner"><span className="flex items-center gap-1.5"><Avatar name={p.owner_name} color={p.owner_color} size={20} />{p.owner_name ?? "—"}</span></Prop>
                <Prop label="Sponsor"><span className="flex items-center gap-1.5"><Avatar name={p.sponsor_name} color={p.sponsor_color} size={20} />{p.sponsor_name ?? "—"}</span></Prop>
                <Prop label="Program">{p.program_id ? <Link href={`/programs/${p.program_id}`} className="hover:underline">{p.program_name}</Link> : "—"}</Prop>
                <Prop label="Start">{fmtDate(p.start_date)}</Prop>
                <Prop label="Target"><span className={cn(p.target_date && p.target_date < td && "text-bad")}>{fmtDate(p.target_date, { year: true })}</span></Prop>
                {lastUpd?.expected_completion && lastUpd.expected_completion !== p.target_date && (
                  <Prop label="Expected"><span className={cn(p.target_date && lastUpd.expected_completion > p.target_date ? "text-warn" : "text-ink")}>{fmtDate(lastUpd.expected_completion)}{p.target_date && lastUpd.expected_completion > p.target_date ? ` (+${diffDays(lastUpd.expected_completion, p.target_date)}d)` : ""}</span></Prop>
                )}
                {p.budget != null && <Prop label="Budget"><span className="tabular">{inr(p.spent)} <span className="text-ink-3">of {inr(p.budget)}</span>{p.budget > 0 && p.spent != null ? <span className="ml-1 text-ink-3">· {Math.round((p.spent / p.budget) * 100)}%</span> : null}</span></Prop>}
              </div>
              {p.teams.length > 0 && (
                <div className="mt-2 border-t border-line pt-3">
                  <div className="mb-1.5 text-[12px] text-ink-3">Teams</div>
                  <div className="flex flex-wrap gap-1.5">{p.teams.map((t) => <Badge key={t.id}>{t.name}</Badge>)}</div>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="eyebrow mb-2">At a glance</div>
              <div className="space-y-1.5 text-[13px]">
                <Link href={tabHref("tasks")} className="flex justify-between hover:text-ink"><span className="text-ink-3">Overdue actions</span><span className={cn("tabular", overdue.length ? "font-medium text-bad" : "text-ink-2")}>{overdue.length}</span></Link>
                <Link href={tabHref("milestones")} className="flex justify-between"><span className="text-ink-3">Slipped milestones</span><span className={cn("tabular", p.ms_slipped ? "font-medium text-warn" : "text-ink-2")}>{p.ms_slipped}</span></Link>
                <Link href={tabHref("risks")} className="flex justify-between"><span className="text-ink-3">Open risks</span><span className="tabular text-ink-2">{p.open_risks}</span></Link>
                <Link href={tabHref("decisions")} className="flex justify-between"><span className="text-ink-3">Pending decisions</span><span className={cn("tabular", pendingDecisions.length ? "font-medium text-warn" : "text-ink-2")}>{pendingDecisions.length}</span></Link>
                {followups.length > 0 && <div className="flex justify-between"><span className="text-ink-3">Update requests open</span><span className="font-medium tabular text-warn">{followups.length}</span></div>}
              </div>
            </Card>
          </aside>
        </div>
      )}

      {tab === "tasks" && (
        <Card>
          <CardHeader title={`${plural(openTasks.length, "open task")}${overdue.length ? ` · ${overdue.length} overdue` : ""}`} subtitle={`${tasks.length - openTasks.length} closed`}
            action={contributor ? <AddProjectTask projectId={id} people={opts.people} teams={base0.teams} milestones={msView.filter((m) => m.status !== "done").map((m) => ({ value: m.id, label: m.title }))} /> : null} />
          <TaskList tasks={tasks} showProject={false} empty={<EmptyState compact icon={<ListChecks size={18} />} title="No tasks yet" body="Break the next milestone into owned, dated tasks." />} />
        </Card>
      )}

      {tab === "milestones" && (
        <div className="space-y-4">
          {msView.length > 0 && <Card className="px-4 pt-4 pb-2"><MilestoneTimeline milestones={msView} start={p.start_date} target={p.target_date} /></Card>}
          <Card><MilestoneList projectId={id} milestones={msView} editable={editable} /></Card>
        </div>
      )}

      {tab === "meetings" && (
        <Card>
          {meetings.length ? (
            <ul className="divide-y divide-line/70">
              {meetings.map((m) => {
                const ms = MOM_STATUS[m.mom_status as keyof typeof MOM_STATUS];
                const future = new Date(m.starts_at).getTime() > Date.now();
                return (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle/60">
                      <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-subtle text-[10px] leading-tight text-ink-3">
                        <span className="font-semibold text-ink">{Number(dateOf(m.starts_at).slice(8, 10))}</span>{fmtDate(dateOf(m.starts_at)).slice(0, 3)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-ink">{m.title}</div>
                        <div className="text-[12px] text-ink-3">{relDay(dateOf(m.starts_at))} · {fmtTime(m.starts_at)}{m.mom_owner_name ? ` · MoM: ${m.mom_owner_name}` : ""}{m.review_name ? ` · ${m.review_name}` : ""}</div>
                      </div>
                      {future ? <Badge tone="info">Upcoming</Badge> : ms ? <Badge tone={ms.tone as Tone}>{ms.label}</Badge> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={<CalendarClock size={18} />} title="No linked meetings" body="Meetings tagged to this project (or its review series) will show here with their MoM status." />}
        </Card>
      )}

      {tab === "decisions" && (
        <Card>
          <CardHeader title={pendingDecisions.length ? `${plural(pendingDecisions.length, "decision")} required` : "Decision log"} subtitle={`${decisions.length - pendingDecisions.length} made`}
            action={contributor ? <DecisionFormButton options={opts} variant="secondary" initial={{ projectId: id }} /> : null} />
          {decisions.length ? <DecisionList decisions={decisions.map(toDecisionView)} options={opts} editable={contributor} compact />
            : <EmptyState compact icon={<Gavel size={18} />} title="No decisions logged" body="Capture what was decided, why, and its impact — or list decisions still required." />}
        </Card>
      )}

      {tab === "risks" && (
        <Card>
          <CardHeader title={`${plural(risks.length, "open risk")}`} subtitle={risks.some((r) => r.score >= 15) ? "Includes critical risks" : undefined}
            action={contributor ? <RiskFormButton options={pickers} variant="secondary" initial={{ projectId: id }} /> : null} />
          {allRisks.length ? <RiskTable risks={allRisks.map(toRiskView)} options={pickers} editable={contributor} hideProject />
            : <EmptyState compact icon={<ShieldAlert size={18} />} title="No risks logged" body="Log what could stop this project, with a mitigation and a trigger signal." />}
        </Card>
      )}

      {tab === "updates" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <UpdateFeed updates={updates} empty={
              <Card><EmptyState icon={<MessageSquareText size={18} />} title="No updates yet" body="Structured updates are compared with the previous one — slips, health changes and new blockers stand out."
                action={contributor ? <UpdateComposer projectId={id} defaults={updateDefaults} label="Post the first update" /> : null} /></Card>} />
          </div>
          <aside className="space-y-4">
            <Card className="p-4">
              <div className="eyebrow mb-2">Cadence</div>
              <p className="text-[13px] text-ink-2">{lastUpd ? <>Last update {ago(lastUpd.created_at)} by {lastUpd.author_name}.</> : "No update posted yet."}</p>
              {daysSince != null && daysSince >= 7 && <p className="mt-1 text-[12.5px] text-warn">Updates are expected weekly.</p>}
              {followups.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-1 text-[12px] text-ink-3">Open requests</div>
                  {followups.map((f) => <div key={f.id} className="text-[12.5px] text-ink-2">{f.person_name} · asked {ago(f.created_at)}</div>)}
                </div>
              )}
              {!isOwner && <div className="mt-3"><RequestUpdateButton projectId={id} ownerName={p.owner_name} size="xs" /></div>}
            </Card>
          </aside>
        </div>
      )}

      {tab === "files" && (
        <Card>
          <CardHeader title="Files & links" subtitle="Plans, trackers and documents for this project" />
          <FileLinks entityType="project" entityId={id} files={files.map((f) => ({ ...f, created_at: String(f.created_at) }))} editable={contributor} />
        </Card>
      )}
    </div>
  );
}
