"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/client";
import { linkProjectToGoal, updateGoal } from "@/server/goals/actions";
import type { GoalStatus } from "@/server/goals/queries";
import { cn } from "@/lib/cn";

const OPTS: { key: GoalStatus; label: string; cls: string }[] = [
  { key: "on_track", label: "On track", cls: "text-ok" }, { key: "at_risk", label: "At risk", cls: "text-warn" }, { key: "off_track", label: "Off track", cls: "text-bad" },
  { key: "done", label: "Done", cls: "text-ink-3" }, { key: "dropped", label: "Dropped", cls: "text-ink-4" },
];
export function GoalStatusSelect({ id, status, disabled }: { id: string; status: GoalStatus; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const cur = OPTS.find((o) => o.key === status) ?? OPTS[0];
  return (
    <select disabled={disabled || pending} value={status} onClick={(e) => e.stopPropagation()}
      onChange={(e) => start(async () => { const r = await updateGoal(id, { status: e.target.value as GoalStatus }); if (!r.ok) toast(r.error, "error"); else router.refresh(); })}
      className={cn("rounded-md bg-transparent py-0.5 text-[12px] font-semibold outline-none hover:bg-subtle", cur.cls)}>
      {OPTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

/** Map a project to a goal (or unmap it) right from Goals & projects. */
export function ProjectGoalSelect({ projectId, goalId, goals, disabled }: { projectId: string; goalId: string | null; goals: { id: string; title: string }[]; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <select disabled={disabled || pending} value={goalId ?? ""} onClick={(e) => e.stopPropagation()} title="Goal this project serves"
      onChange={(e) => start(async () => { const r = await linkProjectToGoal(projectId, e.target.value || null); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Saved", "success"); router.refresh(); } })}
      className={cn("max-w-[200px] rounded-md border border-line bg-surface px-1.5 py-1 text-[12px] outline-none hover:border-line-strong", !goalId && "text-ink-3")}>
      <option value="">{goalId ? "Remove from goal" : "Map to a goal…"}</option>
      {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
    </select>
  );
}
