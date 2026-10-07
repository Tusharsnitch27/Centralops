"use client";
import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { setTaskStatus } from "@/server/tasks/actions";
import { useToast } from "@/components/ui/client";
import type { TaskStatus } from "@/lib/meta";

/** Round checkbox that completes / reopens a task optimistically. */
export function TaskCheck({ id, status, disabled }: { id: string; status: TaskStatus; disabled?: boolean }) {
  const [opt, setOpt] = useOptimistic(status);
  const [, start] = useTransition();
  const toast = useToast();
  const done = opt === "completed";
  return (
    <button type="button" disabled={disabled} aria-label={done ? "Reopen task" : "Complete task"}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        const next: TaskStatus = done ? "in_progress" : "completed";
        start(async () => { setOpt(next); const r = await setTaskStatus(id, next); if (!r.ok) toast(r.error, "error"); else if (next === "completed") toast("Task completed", "success"); });
      }}
      className={cn("group/check flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-all",
        done ? "border-ok bg-ok text-canvas" : opt === "blocked" ? "border-bad/60 border-dashed" : opt === "in_progress" ? "border-info/70" : "border-ink-4 hover:border-ink-2")}>
      <Check size={11} strokeWidth={3} className={cn(done ? "opacity-100" : "opacity-0 group-hover/check:opacity-40")} />
    </button>
  );
}
