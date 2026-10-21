import { Suspense } from "react";
import { AlertOctagon, ArrowRight, CircleCheck, Clock, Hourglass, Inbox, MessageCircleQuestion, Search, Sparkles } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { GroupedTaskList } from "@/components/tasks/GroupedTaskList";
import { NewTaskButton } from "@/components/tasks/NewTaskButton";
import { SavedViewPills } from "@/components/tasks/SavedViewPills";
import { TaskToolbar } from "@/components/tasks/TaskToolbar";
import { requireUser } from "@/server/auth";
import { listPeople, listProjectsLite, listTeams } from "@/server/core/people";
import {
  TASK_VIEWS, groupTasks, listSavedViews, listTags, listTasksForParams, parseTaskParams, taskInsights, taskQuery, taskViewCounts,
  STALE_DAYS, type TaskInsight, type TaskParams, type TaskViewKey,
} from "@/server/tasks/views";
import type { TaskListItem } from "@/server/tasks/queries";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { ago } from "@/lib/dates";

export const metadata = { title: "Tasks" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const params = parseTaskParams(await searchParams);
  const [counts, tasks, saved, people, teams, projects, tags] = await Promise.all([
    taskViewCounts(u), listTasksForParams(params, u), listSavedViews(u.id), listPeople(), listTeams(), listProjectsLite(), listTags(),
  ]);
  const insights = taskInsights(counts);
  const groups = groupTasks(tasks, params.group);
  const attention = counts.overdue + counts.blocked + counts.noupdate;
  const currentHref = taskQuery(params);
  const filtered = !!(params.owner || params.team || params.project || params.priority || params.status || params.tag || params.search);
  const viewMeta = TASK_VIEWS.find((v) => v.key === params.view)!;

  return (
    <div>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        subtitle={attention
          ? <><span className="font-medium text-ink">{plural(attention, "task needs", "tasks need")} attention</span> · {counts.all} open in your scope</>
          : <>Nothing needs attention · {counts.all} open in your scope</>}
        actions={<><ButtonLink href="/followups" variant="secondary"><MessageCircleQuestion size={14} /> Follow-ups</ButtonLink><NewTaskButton /></>}
      />

      <InsightStrip insights={insights} />

      <div className="mb-3 mt-5">
        <SavedViewPills activeHref={currentHref}
          views={saved.map((v) => ({ id: v.id, name: v.name, builtin: v.builtin, href: taskQuery({ view: "mine", group: "none", ...v.filters } as TaskParams) }))} />
      </div>

      <div className="-mx-4 overflow-x-auto px-4 scroll-thin md:mx-0 md:px-0">
        <Tabs className="min-w-max" active={params.view}
          items={TASK_VIEWS.map((v) => ({ key: v.key, label: v.label, count: counts[v.key], href: taskQuery({ view: v.key, group: params.group }) }))} />
      </div>

      <div className="my-3">
        <Suspense>
          <TaskToolbar meId={u.id}
            options={{
              people: people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color })),
              teams: teams.map((t) => ({ id: t.id, name: t.name })),
              projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
              tags: tags.map((t) => t.tag),
            }} />
        </Suspense>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-[12px] text-ink-3">
          <span>{viewMeta.hint}{filtered && " · filtered"}</span>
          <span className="tabular">{plural(tasks.length, "task")}</span>
        </div>
        {tasks.length ? (
          <GroupedTaskList groups={groups} extra={rowExtra(params.view)} />
        ) : (
          <ViewEmpty view={params.view} filtered={filtered} />
        )}
      </div>
    </div>
  );
}

/** Per-view trailing meta on rows: staleness for delegated work, completion time for done. */
function rowExtra(view: TaskViewKey) {
  if (view === "delegated" || view === "noupdate")
    return function Extra(t: TaskListItem) {
      return (
        <span className={cn("hidden shrink-0 items-center gap-1 text-[11.5px] tabular sm:flex", t.days_since_update >= STALE_DAYS ? "text-warn" : "text-ink-4")}
          title={t.last_update_note ?? undefined}>
          <Clock size={11} /> {t.days_since_update === 0 ? "Updated today" : `${t.days_since_update}d since update`}
        </span>
      );
    };
  if (view === "done")
    return function Extra(t: TaskListItem) {
      return <span className="hidden shrink-0 text-[11.5px] text-ink-4 sm:block">Done {ago(t.completed_at)}</span>;
    };
  return undefined;
}

const INSIGHT_ICON: Record<string, React.ReactNode> = {
  overdue: <Clock size={14} />, blocked: <AlertOctagon size={14} />, noupdate: <MessageCircleQuestion size={14} />, unack: <Hourglass size={14} />, today: <CircleCheck size={14} />,
};

function InsightStrip({ insights }: { insights: TaskInsight[] }) {
  if (!insights.length)
    return (
      <div className="card flex items-center gap-3 px-4 py-3 text-[13px] text-ink-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-ok-soft text-ok"><Sparkles size={14} /></span>
        Everything in your scope is on track — nothing overdue, blocked or waiting on an update.
      </div>
    );
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {insights.map((i) => (
        <div key={i.key} className="group flex items-center gap-3 px-4 py-2.5">
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg",
            i.tone === "red" ? "bg-bad-soft text-bad" : i.tone === "amber" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}>
            {INSIGHT_ICON[i.key]}
          </span>
          <p className="min-w-0 flex-1 text-[13px] text-ink">{i.text}</p>
          <ButtonLink href={i.href} size="xs" variant="ghost" className="text-ink-2 group-hover:bg-subtle">
            {i.cta} <ArrowRight size={12} />
          </ButtonLink>
        </div>
      ))}
    </div>
  );
}

function ViewEmpty({ view, filtered }: { view: TaskViewKey; filtered: boolean }) {
  if (filtered)
    return <EmptyState icon={<Search size={18} />} title="No tasks match these filters" body="Try removing a filter or searching for something broader."
      action={<ButtonLink href={taskQuery({ view })} size="sm">Clear filters</ButtonLink>} />;
  const copy: Record<TaskViewKey, { title: string; body: string; cta?: React.ReactNode }> = {
    mine: { title: "Your plate is clear", body: "No open tasks are assigned to you. Capture what you're working on so it's tracked.", cta: <NewTaskButton label="Add a task" /> },
    delegated: { title: "Nothing delegated yet", body: "Tasks you assign to people or teams show up here with their last update.", cta: <NewTaskButton label="Assign a task" /> },
    waiting: { title: "You're not waiting on anyone", body: "Set a task to Waiting and pick who you're waiting on to track it here." },
    overdue: { title: "Nothing overdue", body: "Every open task in your scope is within its due date." },
    today: { title: "Nothing due today", body: "Use the time to unblock something or chase a stale update.", cta: <ButtonLink href="/followups" size="sm">Open follow-ups</ButtonLink> },
    week: { title: "Nothing else due this week", body: "Look ahead at what's coming next week.", cta: <ButtonLink href="/tasks/all?view=all&group=due" size="sm">See all by due date</ButtonLink> },
    noupdate: { title: "Every delegated task has a fresh update", body: `Nobody has gone ${STALE_DAYS}+ days without updating work you assigned.` },
    done: { title: "Nothing completed recently", body: "Completed tasks from the last two weeks appear here." },
    all: { title: "No tasks yet", body: "Create a task or accept actions from a meeting to get started.", cta: <NewTaskButton label="Add a task" /> },
  };
  const c = copy[view];
  return <EmptyState icon={<Inbox size={18} />} title={c.title} body={c.body} action={c.cta} />;
}
