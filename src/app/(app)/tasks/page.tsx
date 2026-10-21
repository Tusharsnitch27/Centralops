import Link from "next/link";
import { ArrowRight, ExternalLink, Inbox } from "lucide-react";
import { Avatar, EmptyState, PageHeader, PriorityIcon } from "@/components/ui";
import { CreateTabs } from "@/components/tasks/CreateTabs";
import { goalOptions, projectOptions } from "@/server/goals/queries";
import { blockersOnMe } from "@/server/tasks/people";
import { orgPeople, taskScope } from "@/server/org/queries";
import { listTasks } from "@/server/tasks/queries";
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

export default async function MyTasks({ searchParams }: { searchParams: Promise<{ view?: string; person?: string; dept?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [all, people, goals, projects, onMe, scope] = await Promise.all([myPending(u.id), listPeople(), goalOptions(), projectOptions(), blockersOnMe(u.id), taskScope(u)]);
  // a team view for admins / program managers (everyone) and anyone with people reporting to them
  const canTeam = scope === null || scope.length > 1;
  if (canTeam && sp.view === "team") return <TeamView me={u.id} scope={scope} person={sp.person} dept={sp.dept} />;
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
      {canTeam && <ScopeTabs active="mine" />}
      <PageHeader title="My tasks"
        subtitle={<>{tasks.length} active{scheduled.length ? ` · ${scheduled.length} scheduled` : ""}{overdue ? <> · <span className="font-medium text-bad">{overdue} overdue</span></> : null} · sorted by due date</>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <CreateTabs meId={u.id} people={people.map((p) => ({ id: p.id, name: p.name, title: p.title }))} links={{ goals, projects }} />
          {onMe.length > 0 && (
            <section>
              <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-bad">Blocked on you<span className="font-medium text-ink-4">{onMe.length}</span></h2>
              <div className="card divide-y divide-line/70 overflow-hidden border-bad/20">
                {onMe.map((b) => (
                  <Link key={b.id} href={`/tasks/${b.task_id}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-subtle/50">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-bad" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-ink">{b.task_title}</span><span className="block text-[11.5px] text-ink-3">{b.body}{b.raised_by_name ? ` · raised by ${b.raised_by_name}` : ""}</span></span>
                    {b.due_date && <span className="shrink-0 text-[12px] text-ink-3">{relDay(b.due_date)}</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}
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
      {x.links.length > 0 && (
        <span className="hidden max-w-[260px] shrink-0 flex-wrap justify-end gap-1 pt-0.5 sm:flex">
          {x.links.slice(0, 3).map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} className="flex max-w-[120px] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-info ring-1 ring-inset ring-line hover:bg-info-soft">
              <ExternalLink size={10} className="shrink-0" /><span className="truncate">{l.label}</span>
            </a>
          ))}
          {x.links.length > 3 && <span className="text-[11px] text-ink-4">+{x.links.length - 3}</span>}
        </span>
      )}
      <span className={cn("shrink-0 pt-0.5 text-right text-[12px] tabular", late ? "font-medium text-bad" : x.due_date === t ? "font-medium text-warn" : "text-ink-3")} title={x.due_date ? fmtDate(x.due_date, { dow: true }) : undefined}>
        {x.due_date ? (late ? `${diffDays(t, x.due_date)}d late` : relDay(x.due_date)) : "—"}
      </span>
    </div>
  );
}

function ScopeTabs({ active }: { active: "mine" | "team" }) {
  return (
    <div className="seg mb-4">
      <Link href="/tasks" data-on={active === "mine"} className="seg-item">My tasks</Link>
      <Link href="/tasks?view=team" data-on={active === "team"} className="seg-item">Team &amp; departments</Link>
    </div>
  );
}

/** Admin / PM: everyone. Managers: the people below them. Grouped by person, soonest due first. */
async function TeamView({ me, scope, person, dept }: { me: string; scope: string[] | null; person?: string; dept?: string }) {
  const t = today();
  const org = await orgPeople();
  const team = org.filter((p) => p.id !== me && (scope === null || scope.includes(p.id)));
  const depts = [...new Set(team.map((p) => p.org_function).filter(Boolean))].sort() as string[];
  const shown = team.filter((p) => (!person || p.id === person) && (!dept || p.org_function === dept));
  const ids = shown.map((p) => p.id);
  const tasks = ids.length ? await listTasks({ open: true, order: "due", limit: 800 }).then((r) => r.filter((x) => x.owner_id && ids.includes(x.owner_id))) : [];
  const by = shown.map((p) => {
    const ts = tasks.filter((x) => x.owner_id === p.id);
    return { p, ts, overdue: ts.filter((x) => x.due_date && x.due_date < t).length, blocked: ts.filter((x) => x.status === "blocked").length, week: ts.filter((x) => x.due_date && x.due_date >= t && x.due_date <= addDays(t, 7)).length };
  }).sort((a, b) => b.overdue - a.overdue || b.ts.length - a.ts.length || a.p.name.localeCompare(b.p.name));
  const qs = (k: string, v: string | undefined) => { const u = new URLSearchParams({ view: "team" }); const cur = { person, dept, [k]: v }; for (const [a, b] of Object.entries(cur)) if (b) u.set(a, b); return `/tasks?${u}`; };
  const total = tasks.length, overdue = tasks.filter((x) => x.due_date && x.due_date < t).length;
  return (
    <div>
      <ScopeTabs active="team" />
      <PageHeader title="Team & department tasks" subtitle={<>{shown.length} people · {total} open{overdue ? <> · <span className="font-medium text-bad">{overdue} overdue</span></> : null}{scope === null ? " · everyone" : " · people reporting to you"}</>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="seg"><span className="seg-label">Dept</span>
          <Link href={qs("dept", undefined)} data-on={!dept} className="seg-item">All</Link>
          {depts.map((d) => <Link key={d} href={qs("dept", d)} data-on={dept === d} className="seg-item">{d}</Link>)}
        </div>
        {person && <Link href={qs("person", undefined)} className="seg-item rounded-lg border border-line bg-surface">Clear person ×</Link>}
      </div>
      <div className="card mb-5 overflow-hidden">
        <div className="table-wrap">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Person</th><th>Function</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Next 7 days</th><th className="text-right">Blocked</th></tr></thead>
            <tbody>{by.map(({ p, ts, overdue, blocked, week }) => (
              <tr key={p.id}>
                <td><Link href={qs("person", p.id)} className="flex items-center gap-2 font-medium hover:underline"><Avatar name={p.name} color={p.avatar_color} size={20} />{p.name}</Link></td>
                <td className="text-ink-3">{p.org_function ?? "—"}</td>
                <td className="text-right tabular">{ts.length}</td>
                <td className={cn("text-right tabular", overdue && "font-semibold text-bad")}>{overdue || "—"}</td>
                <td className="text-right tabular">{week || "—"}</td>
                <td className={cn("text-right tabular", blocked && "text-warn")}>{blocked || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="space-y-2">
        {by.filter((x) => x.ts.length).map(({ p, ts, overdue }) => (
          <Collapsible key={p.id} id={`team:${p.id}`} title={p.name} sub={[p.title, p.org_function].filter(Boolean).join(" · ")}
            summary={<><span className="text-ink-3">{ts.length} open</span>{overdue > 0 && <span className="font-semibold text-bad">{overdue} overdue</span>}</>}>
            <div className="divide-y divide-line/70">{ts.map((x) => <Row key={x.id} x={x} me={me} />)}</div>
          </Collapsible>
        ))}
        {!tasks.length && <div className="card"><EmptyState icon={<Inbox size={18} />} title="No open tasks" body="Nobody in this view has open tasks." /></div>}
      </div>
    </div>
  );
}
