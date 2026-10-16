"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { impactOf, monShort } from "@/server/aop/calc";
import type { SummaryTree } from "@/server/aop/summaryData";
import { activeMonths, aggLines, fnLines, momLike, prevMonth } from "./summaryMath";

type Mode = "plan" | "forecast" | "mom";

/** Functions × months: gap vs budget / vs provision / month-on-month change in actuals. */
export function VarianceGrid({ tree }: { tree: SummaryTree }) {
  const [mode, setMode] = useState<Mode>("plan");
  const months = useMemo(() => activeMonths(tree).filter((p) => !tree.lastClosed || p <= tree.lastClosed), [tree]);
  const L = tree.labels;
  const rows = [...tree.functions.map((f) => ({ id: f.id, name: f.name, lines: fnLines(f) })), { id: "total", name: "Total", lines: tree.functions.flatMap(fnLines) }];

  const cell = (lines: ReturnType<typeof fnLines>, p: string) => {
    const a = aggLines(lines, p);
    if (!a.hasActual) return null;
    const dir = lines[0]?.direction ?? "lower_better";
    if (mode === "mom") {
      const pp = prevMonth(tree, p);
      const mm = pp ? momLike(lines, [p], [pp]) : null;
      if (!mm) return null;
      const diff = mm.cur - mm.prev;
      return { diff, rel: diff / Math.abs(mm.prev), good: dir === "lower_better" ? diff <= 0 : diff >= 0 };
    }
    const base = mode === "plan" ? a.planReported : lines.reduce((s, l) => { const v = l.vals[p]; return v && v.actual != null && v.forecast != null ? s + v.forecast : s; }, 0);
    const act = mode === "plan" ? a.actual : lines.reduce((s, l) => { const v = l.vals[p]; return v && v.actual != null && v.forecast != null ? s + v.actual : s; }, 0);
    if (!base) return null;
    const diff = act - base;
    return { diff, rel: diff / Math.abs(base), good: impactOf(dir, base, act) >= 0 };
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Monthly variance</div>
          <div className="text-[12px] text-ink-3">{mode === "mom" ? `${L.actual} change vs previous month, like-for-like lines` : `${L.actual} vs ${mode === "plan" ? L.plan : L.forecast}, reported lines only`}</div>
        </div>
        <div className="seg">
          {([["plan", `vs ${L.plan}`], ["forecast", `vs ${L.forecast}`], ["mom", "Month-on-month"]] as [Mode, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} data-on={mode === k} className="seg-item">{label}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="thead-hl border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em]">
              <th className="px-4 py-2 text-left font-medium">Function</th>
              {months.map((p) => <th key={p} className="px-3 py-2 text-right font-medium">{monShort(p)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line/60 last:border-0", r.id === "total" && "border-t border-line-strong font-medium")}>
                <td className="px-4 py-2 text-ink">{r.name}</td>
                {months.map((p) => {
                  const c = cell(r.lines, p);
                  if (!c) return <td key={p} className="px-3 py-2 text-right text-ink-4">—</td>;
                  const strong = Math.abs(c.rel) >= (mode === "mom" ? 0.2 : tree.threshold);
                  return (
                    <td key={p} className="px-1.5 py-1.5 text-right" title={`${inr(c.diff, { sign: true })} (${pct(c.rel, 1, true)})`}>
                      <span className={cn("block rounded-md px-1.5 py-1 tabular", strong ? (c.good ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad") : "text-ink-2")}>
                        {pct(c.rel, 0, true)}
                        <span className="block text-[10.5px] opacity-70">{inr(c.diff, { sign: true })}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
