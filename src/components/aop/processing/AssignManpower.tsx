"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { assignManpower, proposeManpower } from "@/server/aop/processingActions";
import type { MpAssignment, StreamKey } from "@/server/aop/processingTypes";
import { cn } from "@/lib/cn";

/**
 * Attendance gives present heads per department only; the warehouse lead (Manish Charan) splits them across stream × process.
 * `options` = every stream × process line that draws from this department (from the plan), so nothing has to be typed.
 */
export function AssignManpower({ a, options }: { a: MpAssignment; options: { stream: StreamKey; process: string }[] }) {
  const key = (s: string, p: string) => `${s}|${p}`;
  const init = Object.fromEntries(options.map((o) => [key(o.stream, o.process), String(a.lines.find((l) => l.stream === o.stream && l.process === o.process)?.heads ?? "")]));
  const [v, setV] = useState<Record<string, string>>(init);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const total = Object.values(v).reduce((s, x) => s + (Number(x) || 0), 0);
  const left = Math.round((a.avgHeads - total) * 10) / 10;

  const save = () => start(async () => {
    const lines = options.map((o) => ({ stream: o.stream, process: o.process, heads: Number(v[key(o.stream, o.process)]) || 0 }));
    if (lines.some((l) => l.heads < 0)) return toast("Heads can't be negative", "error");
    const r = await assignManpower(a.period, a.warehouse, a.department, lines);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Manpower assigned", "success"); router.refresh();
  });
  const propose = () => start(async () => {
    const r = await proposeManpower(a.period, a.warehouse);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Split proposed from the plan mix", "success"); router.refresh();
  });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">{a.warehouse} · {a.department}</span>
        <span className="text-[12px] text-ink-3 tabular">{a.avgHeads.toFixed(1)} avg heads ({Math.round(a.presentManDays)} man-days ÷ {a.workingDays} days)</span>
        <span className={cn("ml-auto text-[12px] font-medium tabular", Math.abs(left) < 0.05 ? "text-ok" : "text-warn")}>{Math.abs(left) < 0.05 ? "fully assigned" : `${left > 0 ? left : `over by ${-left}`} ${left > 0 ? "open" : ""}`}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((o) => (
          <label key={key(o.stream, o.process)} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-4">{o.stream} · {o.process}</span>
            <input className="field h-8 tabular" inputMode="decimal" value={v[key(o.stream, o.process)]} onChange={(e) => setV({ ...v, [key(o.stream, o.process)]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={save}>Assign — Manish Charan</Button>
        <Button disabled={pending} onClick={propose} title="Pre-fill every department of this warehouse in proportion to the planned MP mix">Propose from plan mix</Button>
      </div>
    </div>
  );
}
