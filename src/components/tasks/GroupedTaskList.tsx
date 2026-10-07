import { TaskRow } from "./TaskRow";
import { cn } from "@/lib/cn";
import type { TaskListItem } from "@/server/tasks/queries";

export interface TaskGroupView { key: string; label: string; tasks: TaskListItem[]; tone?: "red" | "amber" | "neutral" }

/** Task rows, optionally under sticky group headers. `extra` renders per-row trailing meta. */
export function GroupedTaskList({ groups, extra, showProject = true }: { groups: TaskGroupView[]; extra?: (t: TaskListItem) => React.ReactNode; showProject?: boolean }) {
  return (
    <div>
      {groups.map((g) => (
        <section key={g.key}>
          {g.label && (
            <div className="sticky top-0 z-[1] flex h-9 items-center gap-2 border-b border-line bg-subtle/80 px-3 backdrop-blur-sm">
              <span className={cn("size-1.5 rounded-full", g.tone === "red" ? "bg-bad" : g.tone === "amber" ? "bg-warn" : "bg-ink-4")} />
              <span className="text-[12.5px] font-medium text-ink">{g.label}</span>
              <span className="text-[12px] tabular text-ink-4">{g.tasks.length}</span>
            </div>
          )}
          {g.tasks.map((t) => <TaskRow key={t.id} t={t} extra={extra?.(t)} showProject={showProject} />)}
        </section>
      ))}
    </div>
  );
}
