"use client";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, Boxes, CalendarPlus, CircleCheck, FolderKanban, Gavel, Info, NotebookPen, Plus, Target, TriangleAlert, Users, X } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/core/result";
import type { Suggestion } from "@/server/insights/engine";
import { createTaskFromSuggestion, dismissSuggestion, nudgeFromSuggestion, requestUpdatesFromSuggestion, scheduleReviewFromSuggestion } from "@/server/insights/actions";

const KIND_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  aop_overspend: Target, aop_missing: Target, sop_late: Boxes, capacity: Boxes, stale_tasks: Users, milestone_slip: FolderKanban,
  mom_missing: NotebookPen, decision_due: Gavel, project_update: FolderKanban,
};
const SEV = {
  critical: { label: "Critical", dot: "bg-bad", text: "text-bad", icon: AlertOctagon },
  warning: { label: "Needs attention", dot: "bg-warn", text: "text-warn", icon: TriangleAlert },
  info: { label: "Heads-up", dot: "bg-info", text: "text-info", icon: Info },
} as const;

export function SuggestionList({ items, readOnly }: { items: Suggestion[]; readOnly?: boolean }) {
  const [list, remove] = useOptimistic(items, (cur, id: string) => cur.filter((x) => x.id !== id));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const act = <T,>(id: string, fn: () => Promise<ActionResult<T>>, after?: (r: ActionResult<T> & { ok: true }) => void) =>
    start(async () => {
      remove(id);
      const r = await fn();
      if (!r.ok) { toast(r.error, "error"); router.refresh(); return; }
      toast(r.message ?? "Done", "success");
      after?.(r);
    });

  if (!list.length)
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-subtle text-ok"><CircleCheck size={18} /></span>
        <div className="text-[14px] font-medium text-ink">You're on top of everything</div>
        <p className="mt-1 max-w-sm text-[13px] text-ink-3">No open suggestions. New ones appear as soon as something slips, goes over budget or misses an update.</p>
      </div>
    );

  return (
    <ul className="divide-y divide-line/70">
      {list.map((s) => {
        const sev = SEV[s.severity as keyof typeof SEV] ?? SEV.info;
        const Icon = KIND_ICON[s.kind] ?? sev.icon;
        const p = s.payload ?? { primary: "task", primaryLabel: "Create task" };
        const primary = () => {
          if (p.primary === "review") act(s.id, () => scheduleReviewFromSuggestion(s.id), (r) => r.data && router.push(`/meetings/${r.data.meetingId}`));
          else if (p.primary === "request_updates") act(s.id, () => requestUpdatesFromSuggestion(s.id));
          else if (p.primary === "nudge") act(s.id, () => nudgeFromSuggestion(s.id));
          else act(s.id, () => createTaskFromSuggestion(s.id));
        };
        return (
          <li key={s.id} className="group flex gap-3.5 px-4 py-4">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface", sev.text)}><Icon size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px]">
                <span className={cn("size-1.5 rounded-full", sev.dot)} /><span className={cn("font-medium", sev.text)}>{sev.label}</span>
              </div>
              <Link href={s.href ?? "#"} className="text-[14px] font-medium leading-snug text-ink hover:underline decoration-ink-4 underline-offset-2">{s.title}</Link>
              {s.body && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{s.body}</p>}
              {s.recommendation && <p className="mt-1.5 text-[12.5px] text-ink-2"><span className="text-violet">→</span> {s.recommendation}</p>}
              {!readOnly && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button disabled={pending} onClick={primary} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[12px] font-medium text-white hover:bg-ink-2 disabled:opacity-50">{p.primaryLabel}</button>
                  {p.primary !== "task" && <button disabled={pending} onClick={() => act(s.id, () => createTaskFromSuggestion(s.id))} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] text-ink-2 hover:bg-subtle hover:text-ink"><Plus size={13} />Create task</button>}
                  {p.primary !== "review" && <button disabled={pending} onClick={() => act(s.id, () => scheduleReviewFromSuggestion(s.id), (r) => r.data && router.push(`/meetings/${r.data.meetingId}`))} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[12px] text-ink-2 hover:bg-subtle hover:text-ink"><CalendarPlus size={13} />Schedule review</button>}
                  <button disabled={pending} onClick={() => act(s.id, () => dismissSuggestion(s.id))} className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-3 hover:bg-subtle hover:text-ink"><X size={13} />Dismiss</button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
