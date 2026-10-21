"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Compass, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { planMyDay } from "@/server/tasks/capture-actions";
import { cn } from "@/lib/cn";
import type { FocusBrief } from "@/lib/taskDraft";

/** Today's focus: rule-based by default, Claude on request. */
export function FocusPanel({ initial, aiOn }: { initial: FocusBrief; aiOn: boolean }) {
  const [b, setB] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-[13.5px] font-semibold"><Compass size={15} className="text-ink-4" /> Focus today</span>
        {aiOn && (
          <button disabled={pending} onClick={() => start(async () => { const r = await planMyDay(); if (r.ok && r.data) setB(r.data); else if (!r.ok) toast(r.error, "error"); })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-60">
            <Sparkles size={12} className={pending ? "animate-pulse" : undefined} />{pending ? "Planning…" : b.engine === "claude" ? "Re-plan" : "Plan with AI"}
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-[12.5px] text-ink-2">{b.headline}</p>
        {b.items.length > 0 && (
          <ol className="mt-3 space-y-2.5">
            {b.items.map((i, n) => (
              <li key={i.taskId} className="flex gap-2.5">
                <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold", i.tone === "red" ? "bg-bad-soft text-bad" : i.tone === "amber" ? "bg-warn-soft text-warn" : "bg-muted text-ink-3")}>{n + 1}</span>
                <div className="min-w-0">
                  <Link href={`/tasks/${i.taskId}`} className="line-clamp-2 text-[13px] font-medium text-ink hover:underline">{i.title}</Link>
                  <div className="text-[12px] text-ink-3">{i.why} · <span className="text-ink-2">{i.action}</span></div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {b.hygiene.length > 0 && (
          <div className="mt-3 border-t border-line pt-2.5 text-[12px] text-ink-4">{b.hygiene.join(" · ")}</div>
        )}
        <div className="mt-2 text-[11px] text-ink-4">{b.engine === "claude" ? "Planned by AI from your open tasks" : aiOn ? "Rule-based · use Plan with AI for a smarter pick" : "Rule-based focus"}</div>
      </div>
    </div>
  );
}
