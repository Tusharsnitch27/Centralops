import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { Avatar, EmptyState, PageHeader, PriorityIcon } from "@/components/ui";
import { TaskCapture } from "@/components/tasks/TaskCapture";
import { FocusPanel } from "@/components/tasks/FocusPanel";
import { TaskCheck } from "@/components/tasks/TaskCheck";
import { Collapsible } from "@/components/ui/Collapsible";
import { requireUser } from "@/server/auth";
import { listPeople } from "@/server/core/people";
import { myPending, ruleFocus } from "@/server/tasks/coach";
import { aiConfigured } from "@/server/ai/provider";
import type { TaskListItem } from "@/server/tasks/queries";
import { addDays, diffDays, fmtDate, relDay, today, weekStart } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Tasks" };

export default async function MyTasks() {
  const u = await requireUser();
  const [all, people] = await Promise.all([myPending(u.id), listPeople()]);
  const t = today();
  // a start date keeps a task off the active list until then — a clean charter for today
  const tasks = all.filter((x) => !x.start_date || x.start_date <= t);
  const scheduled = all.filter((x) => x.start_date && x.start_date > t).sort((a, b) => a.start_date!.localeCompare(b.start_date!));
  const weekEnd = addDays(weekStart(t), 6);
  const buckets: { key: string; label: string; items: TaskListItem[]; tone?: string }[] = [
    { key: "overdue", label: "Overdue", items: [], tone: "text-bad" },
    { key: "today", label: "Today", items: [], tone: "text-warn" },
    { key: "tomorrow", label: "Tomorrow", items: [] },
    { key: "week", label: "This week", items: [] },
    { key: "later", label: "Later", items: [] },
    { key: "none", label: "No due date", items: [] },
  ];
  const at = (k: string) => buckets.find((b) => b.key === k)!.items;
  for (const x of tasks) {
    const d = x.due_date;
    at(!d ? "none" : d < t ? "overdue" : d === t ? "today" : d === addDays(t, 1) ? "tomorrow" : d <= weekEnd ? "week" : "later").push(x);
  }
  const overdue = at("overdue").length;

  return (
    <div>
      <PageHeader title="My tasks"
        subtitle={<>{tasks.length} active{scheduled.length ? ` · ${scheduled.length} scheduled` : ""}{overdue ? <> · <span className="font-medium text-bad">{overdue} overdue</span></> : null} · sorted by due date</>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <TaskCapture meId={u.id} people={people.map((p) => ({ id: p.id, name: p.name, title: p.title }))} />
          <div className="xl:hidden"><FocusPanel initial={ruleFocus(all, u.id)} aiOn={aiConfigured()} /></div>
          {all.length ? (
            <div className="space-y-5">
              {buckets.filter((b) => b.items.length).map((b) => (
                <section key={b.key}>
                  <h2 className={cn("mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em]", b.tone ?? "text-ink-4")}>
                    {b.label}<span className="font-medium text-ink-4">{b.items.length}</span>
                  </h2>
                  <div className="card divide-y divide-line/70 overflow-hidden">
                    {b.items.map((x) => <Row key={x.id} x={x} me={u.id} />)}
                  </div>
                </section>
              ))}
              {scheduled.length > 0 && (
                <Collapsible id="tasks:scheduled" title={`Scheduled · ${scheduled.length}`} sub="Starts later — joins the active list on its start date">
                  <div className="divide-y divide-line/70">{scheduled.map((x) => <Row key={x.id} x={x} me={u.id} />)}</div>
                </Collapsible>
              )}
              <Link href="/tasks/all" className="flex items-center gap-1 px-1 text-[12.5px] text-ink-3 hover:text-ink">Delegated, waiting and done tasks are in All views <ArrowRight size={12} /></Link>
            </div>
          ) : (
            <div className="card"><EmptyState icon={<Inbox size={18} />} title="Nothing pending" body="Write your first task above — just the way you’d say it." /></div>
          )}
        </div>
        <aside className="hidden xl:block"><div className="sticky top-20"><FocusPanel initial={ruleFocus(all, u.id)} aiOn={aiConfigured()} /></div></aside>
      </div>
    </div>
  );
}

function Row({ x, me }: { x: TaskListItem; me: string }) {
  const t = today();
  const late = x.due_date != null && x.due_date < t;
  const other = x.owner_id !== me;
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 hover:bg-subtle/50">
      <span className="pt-0.5"><TaskCheck id={x.id} status={x.status} /></span>
      <Link href={`/tasks/${x.id}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <PriorityIcon priority={x.priority} className="shrink-0" />
          <span className="truncate text-[13px] text-ink">{x.title}</span>
        </span>
        {(x.next_step || other || x.poc_name || (x.start_date && x.start_date > today())) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-4">
            {other && <span className="flex items-center gap-1"><Avatar name={x.owner_name ?? x.owner_team_name} color={x.owner_color} size={14} />{x.owner_name ?? x.owner_team_name ?? "Unassigned"}</span>}
            {x.start_date && x.start_date > today() && <span>Starts {fmtDate(x.start_date, { dow: true })}</span>}
            {x.poc_name && <span>POC: {x.poc_name}</span>}
            {x.next_step && <span className="truncate">Next: {x.next_step}</span>}
          </span>
        )}
      </Link>
      <span className={cn("shrink-0 pt-0.5 text-right text-[12px] tabular", late ? "font-medium text-bad" : x.due_date === t ? "font-medium text-warn" : "text-ink-3")} title={x.due_date ? fmtDate(x.due_date, { dow: true }) : undefined}>
        {x.due_date ? (late ? `${diffDays(t, x.due_date)}d late` : relDay(x.due_date)) : "—"}
      </span>
    </div>
  );
}
