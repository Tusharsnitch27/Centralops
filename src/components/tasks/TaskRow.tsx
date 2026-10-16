import Link from "next/link";
import { AlertOctagon, Hourglass, MessageCircleQuestion, Repeat2 } from "lucide-react";
import { Avatar, PriorityIcon, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { diffDays, relDay, today } from "@/lib/dates";
import type { TaskListItem } from "@/server/tasks/queries";
import { TaskCheck } from "./TaskCheck";

/** Compact, Linear-style task row. Server component (the checkbox is a client island). */
export function TaskRow({ t, showProject = true, showOwner = true, extra, className }: { t: TaskListItem; showProject?: boolean; showOwner?: boolean; extra?: React.ReactNode; className?: string }) {
  const td = today();
  const open = t.status !== "completed" && t.status !== "cancelled";
  const overdue = open && t.due_date != null && t.due_date < td;
  const slipped = t.original_due_date && t.due_date && t.due_date > t.original_due_date ? diffDays(t.due_date, t.original_due_date) : 0;
  return (
    <div className={cn("group flex min-h-11 items-center gap-3 border-b border-line/70 px-3 last:border-0 hover:bg-subtle/60", className)}>
      <TaskCheck id={t.id} status={t.status} />
      <PriorityIcon priority={t.priority} className="shrink-0" />
      <span className="w-14 shrink-0 font-mono text-[11px] text-ink-4">CO-{t.number}</span>
      <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-2">
        <span className={cn("truncate text-[13px]", t.status === "completed" ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}>{t.title}</span>
        {t.status === "blocked" && <Badge tone="red"><AlertOctagon size={11} />Blocked</Badge>}
        {t.status === "waiting" && <Badge tone="amber"><Hourglass size={11} />{t.waiting_on_name ? `Waiting on ${t.waiting_on_name}` : "Waiting"}</Badge>}
        {t.open_followups > 0 && <span title={`${t.open_followups} open follow-up`} className="text-warn"><MessageCircleQuestion size={13} /></span>}
        {slipped > 0 && <span title={`Due date moved ${slipped}d`} className="flex items-center gap-0.5 text-[11px] text-warn"><Repeat2 size={12} />{slipped}d</span>}
      </Link>
      {extra}
      {showProject && t.project_name && (
        <Link href={`/projects/${t.project_id}`} className="hidden max-w-[180px] truncate rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 ring-1 ring-inset ring-line hover:text-ink md:block">
          {t.project_code ?? t.project_name}
        </Link>
      )}
      <span className={cn("w-[84px] shrink-0 text-right text-[12px] tabular", overdue ? "font-medium text-bad" : t.due_date === td ? "font-medium text-warn" : "text-ink-3")}>
        {t.due_date ? (overdue ? `${diffDays(td, t.due_date)}d overdue` : relDay(t.due_date)) : "—"}
      </span>
      {showOwner && (
        <span className="w-6 shrink-0">
          {t.owner_name ? <Avatar name={t.owner_name} color={t.owner_color} size={22} /> : t.owner_team_name ? <span title={t.owner_team_name} className="flex size-[22px] items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-ink-2">{t.owner_team_name.slice(0, 2).toUpperCase()}</span> : <Avatar name={null} size={22} />}
        </span>
      )}
    </div>
  );
}

export function TaskList({ tasks, empty, ...rest }: { tasks: TaskListItem[]; empty?: React.ReactNode; showProject?: boolean; showOwner?: boolean }) {
  if (!tasks.length) return <>{empty ?? null}</>;
  return <div>{tasks.map((t) => <TaskRow key={t.id} t={t} {...rest} />)}</div>;
}
