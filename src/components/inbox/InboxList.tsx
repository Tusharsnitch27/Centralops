"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import * as Icons from "lucide-react";
import { Kbd } from "@/components/ui";
import { MenuItem, Popover, useToast } from "@/components/ui/client";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { resolveInboxItem, snoozeInboxItem } from "@/server/inbox/actions";
import type { InboxItem } from "@/server/inbox/queries";

const KIND: Record<string, { icon: keyof typeof Icons; label: string; tone: string; cta: string }> = {
  mom_pending: { icon: "NotebookPen", label: "MoM pending", tone: "text-warn", cta: "Add MoM" },
  mom_review: { icon: "ClipboardCheck", label: "MoM to review", tone: "text-info", cta: "Review" },
  overdue: { icon: "AlarmClock", label: "Overdue", tone: "text-bad", cta: "Update" },
  task_assigned: { icon: "CircleDot", label: "Assigned to you", tone: "text-info", cta: "Open" },
  task_suggestion: { icon: "Sparkles", label: "Suggestion", tone: "text-violet", cta: "Review" },
  owner_update: { icon: "MessageSquareText", label: "Owner update", tone: "text-info", cta: "Read" },
  aop_submission: { icon: "Target", label: "AOP input", tone: "text-warn", cta: "Submit" },
  sop_submission: { icon: "Boxes", label: "S&OP input", tone: "text-warn", cta: "Submit" },
  decision: { icon: "Gavel", label: "Decision required", tone: "text-warn", cta: "Decide" },
  risk: { icon: "TriangleAlert", label: "Risk", tone: "text-bad", cta: "Resolve" },
  onboarding: { icon: "Rocket", label: "Get started", tone: "text-ink", cta: "Start" },
  integration: { icon: "Plug", label: "Integration", tone: "text-ink-2", cta: "Open" },
};

export function InboxList({ items, readOnly }: { items: InboxItem[]; readOnly?: boolean }) {
  const [list, remove] = useOptimistic(items, (cur, id: string) => cur.filter((i) => i.id !== id));
  const [sel, setSel] = useState(0);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const act = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => { remove(id); const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else toast(msg, "success"); });

  useEffect(() => {
    if (readOnly) return;
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      const it = list[sel];
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (!it) return;
      if (e.key === "e") act(it.id, () => resolveInboxItem(it.id, "done"), "Marked done");
      if (e.key === "s") act(it.id, () => snoozeInboxItem(it.id, 1), "Snoozed until tomorrow");
      if (e.key === "Enter" && it.href) router.push(it.href);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  return (
    <div>
      {list.map((it, i) => {
        const k = KIND[it.kind] ?? { icon: "Circle", label: it.kind, tone: "text-ink-3", cta: "Open" };
        const Icon = (Icons[k.icon] ?? Icons.Circle) as React.ComponentType<{ size?: number; className?: string }>;
        return (
          <div key={it.id} onMouseEnter={() => setSel(i)}
            className={cn("group relative flex items-start gap-3 border-b border-line/70 px-4 py-3 last:border-0 transition-colors", i === sel && !readOnly ? "bg-subtle/70" : "hover:bg-subtle/40")}>
            {i === sel && !readOnly && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-ink" />}
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface", k.tone)}><Icon size={14} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-4">
                <span className={cn("font-medium", k.tone)}>{k.label}</span>·<span>{ago(it.created_at)}</span>
              </div>
              <Link href={it.href ?? "#"} className="mt-0.5 block text-[13.5px] font-medium text-ink hover:underline decoration-ink-4 underline-offset-2">{it.title}</Link>
              {it.body && <p className="mt-0.5 text-[12.5px] text-ink-3">{it.body}</p>}
            </div>
            {!readOnly && (
              <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                {it.href && <Link href={it.href} className="h-7 rounded-lg bg-ink px-2.5 text-[12px] font-medium leading-7 text-white hover:bg-ink-2">{k.cta}</Link>}
                <button title="Done (E)" onClick={() => act(it.id, () => resolveInboxItem(it.id, "done"), "Marked done")} className="flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-muted hover:text-ink"><Icons.Check size={15} /></button>
                <Popover align="end" trigger={({ toggle }) => <button onClick={toggle} title="Snooze (S)" className="flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-muted hover:text-ink"><Icons.Clock size={14} /></button>}>
                  {(close) => (
                    <>
                      {[[1, "Tomorrow"], [3, "In 3 days"], [7, "Next week"]].map(([d, l]) => (
                        <MenuItem key={d} onClick={() => { close(); act(it.id, () => snoozeInboxItem(it.id, d as number), `Snoozed — ${(l as string).toLowerCase()}`); }}>{l}</MenuItem>
                      ))}
                      <MenuItem danger onClick={() => { close(); act(it.id, () => resolveInboxItem(it.id, "dismissed"), "Dismissed"); }}>Dismiss</MenuItem>
                    </>
                  )}
                </Popover>
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && list.length > 0 && (
        <div className="flex items-center gap-3 border-t border-line bg-subtle/40 px-4 py-2 text-[11.5px] text-ink-4">
          <span><Kbd>J</Kbd> <Kbd>K</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>E</Kbd> done</span><span><Kbd>S</Kbd> snooze</span>
        </div>
      )}
    </div>
  );
}
