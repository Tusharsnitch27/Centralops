import Link from "next/link";
import { FolderKanban, Target } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { GoalStatusSelect, ProjectGoalSelect } from "@/components/tasks/GoalStatus";
import { canEdit, requireUser } from "@/server/auth";
import { goalProjects, goalTasks, listGoals } from "@/server/goals/queries";
import { fmtDate, relDay, today } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Goals & projects" };

/** Goals → their projects → tasks (linked to the goal directly or through a project). Add new ones from My list › Goal / Project. */
export default async function GoalsPage() {
  const u = await requireUser();
  const [goals, projects, tasks] = await Promise.all([listGoals(), goalProjects(), goalTasks()]);
  const t = today();
  const loose = projects.filter((p) => !p.goal_id);
  const goalOpts = goals.filter((g) => !["done", "dropped"].includes(g.status)).map((g) => ({ id: g.id, title: g.title }));
  const editable = canEdit(u);
  const bar = (done: number, total: number) => (
    <span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-ok" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></span><span className="text-[11.5px] tabular text-ink-3">{done}/{total}</span></span>
  );
  const TaskLine = ({ x }: { x: (typeof tasks)[number] }) => (
    <Link href={`/tasks/${x.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-subtle/50">
      <span className={cn("size-2 shrink-0 rounded-full", x.status === "completed" ? "bg-ok" : x.status === "blocked" ? "bg-bad" : "bg-line-strong")} />
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", x.status === "completed" ? "text-ink-4 line-through" : "text-ink")}>{x.title}</span>
      <span className="hidden text-[12px] text-ink-4 sm:inline">{x.owner_name}</span>
      <span className={cn("w-[84px] text-right text-[12px] tabular", x.status !== "completed" && x.due_date && x.due_date < t ? "font-medium text-bad" : "text-ink-3")}>{x.due_date ? relDay(x.due_date) : "—"}</span>
    </Link>
  );
  return (
    <div>
      <PageHeader title="Goals & projects" subtitle={<>{goals.filter((g) => !["done", "dropped"].includes(g.status)).length} active goals · {projects.length} projects · add new ones from <Link href="/tasks" className="underline">My list</Link> › Goal / Project</>} />
      {!goals.length && !projects.length ? (
        <div className="card"><EmptyState icon={<Target size={18} />} title="No goals yet" body="Add one from My list › Goal. Goals can hold projects and tasks; tasks and projects don’t need a goal." /></div>
      ) : (
        <div className="space-y-2">
          {goals.map((g) => {
            const gp = projects.filter((p) => p.goal_id === g.id);
            const direct = tasks.filter((x) => x.goal_id === g.id && !gp.some((p) => p.id === x.project_id));
            return (
              <Collapsible key={g.id} id={`goal:${g.id}`} icon={<Target size={15} />} title={g.title}
                sub={[g.owner_name, g.target_date ? `by ${fmtDate(g.target_date)}` : null, `${g.projects} project${g.projects === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                summary={<>{bar(g.tasks_done, g.tasks_total)}{g.tasks_overdue > 0 && <Badge tone="red">{g.tasks_overdue} overdue</Badge>}<GoalStatusSelect id={g.id} status={g.status} disabled={!canEdit(u)} /></>}>
                {g.description && <p className="border-b border-line px-4 py-3 text-[12.5px] text-ink-2">{g.description}</p>}
                {gp.map((p) => (
                  <div key={p.id} id={`project-${p.id}`} className="scroll-mt-20 border-b border-line last:border-0">
                    <div className="flex flex-wrap items-center gap-2 bg-subtle/40 px-4 py-2 text-[12.5px]"><FolderKanban size={13} className="text-ink-4" /><span className="font-semibold">{p.name}</span><span className="text-ink-4">{p.owner_name}</span>
                      <span className="ml-auto flex items-center gap-3">{bar(p.tasks_done, p.tasks_total)}<ProjectGoalSelect projectId={p.id} goalId={p.goal_id} goals={goalOpts} disabled={!editable} /></span></div>
                    {tasks.filter((x) => x.project_id === p.id).map((x) => <TaskLine key={x.id} x={x} />)}
                  </div>
                ))}
                {direct.length > 0 && <div><div className="bg-subtle/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Tasks on this goal</div>{direct.map((x) => <TaskLine key={x.id} x={x} />)}</div>}
                {!gp.length && !direct.length && <p className="px-4 py-3 text-[12.5px] text-ink-4">Nothing linked yet — pick this goal when adding a task or project.</p>}
              </Collapsible>
            );
          })}
          {loose.length > 0 && (
            <section className="pt-4">
              <h2 className="label-caps mb-2 flex items-center gap-2 px-1">Unmapped projects <span className="font-normal normal-case tracking-normal text-ink-4">{loose.length} · pick the goal each one serves</span></h2>
              <div className="card divide-y divide-line/70 overflow-hidden">
                {loose.map((p) => (
                  <div key={p.id} className="scroll-mt-20" id={`project-${p.id}`}>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <FolderKanban size={14} className="text-ink-4" /><span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.name}</span>
                      <span className="hidden text-[12px] text-ink-4 sm:inline">{p.owner_name}</span>{bar(p.tasks_done, p.tasks_total)}
                      <ProjectGoalSelect projectId={p.id} goalId={null} goals={goalOpts} disabled={!editable || !goalOpts.length} />
                    </div>
                    {tasks.filter((x) => x.project_id === p.id).map((x) => <TaskLine key={x.id} x={x} />)}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
