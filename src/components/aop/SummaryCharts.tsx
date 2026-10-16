"use client";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Layers } from "lucide-react";
import { inr, pct } from "@/lib/format";
import { monShort } from "@/server/aop/calc";
import type { SummaryTree } from "@/server/aop/summaryData";
import { aggLines, fnLines } from "./summaryMath";

const tip = { borderRadius: 14, border: "1px solid var(--color-line)", background: "var(--color-surface)", boxShadow: "var(--shadow-pop)", fontSize: 12.5, padding: "8px 12px" };

/** Budget (soft bars) vs actuals (accent gradient bars) vs provision (line), selected period highlighted. */
export function MonthlySpendChart({ tree, selected }: { tree: SummaryTree; selected: string[] }) {
  const all = tree.functions.flatMap(fnLines);
  const L = tree.labels;
  const data = tree.months.map((p) => {
    const a = aggLines(all, p);
    return { p, m: monShort(p), plan: a.hasPlan ? a.plan : null, actual: a.hasActual ? a.actual : null, forecast: a.hasForecast ? a.forecast : null, on: selected.includes(p) };
  }).filter((d) => d.plan != null || d.actual != null || d.forecast != null);
  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex items-center justify-center text-ink-4"><BarChart3 size={16} /></span>
        <div className="text-[14.5px] font-semibold tracking-[-0.01em]">Monthly spend</div>
      </div>
      <div className="mb-3 ml-10 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-medium text-ink-3">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted" />{L.plan}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "linear-gradient(180deg, var(--color-accent-2), var(--color-accent))" }} />{L.actual}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: "var(--color-ink-2)" }} />{L.forecast}</span>
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer>
          <ComposedChart data={data} barGap={3} barCategoryGap="24%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-2)" /><stop offset="100%" stopColor="var(--color-accent)" />
              </linearGradient>
              <linearGradient id="actGradDim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent-2)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 4" />
            <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-ink-3)", fontWeight: 500 }} />
            <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11.5, fill: "var(--color-ink-4)" }} tickFormatter={(v: number) => inr(v).replace("₹", "")} />
            <Tooltip cursor={{ fill: "rgb(127 127 127 / 0.06)" }} contentStyle={tip} formatter={(v, n) => [inr(Number(v)), n === "plan" ? L.plan : n === "actual" ? L.actual : L.forecast]} />
            <Bar isAnimationActive={false} dataKey="plan" radius={[6, 6, 0, 0]} maxBarSize={22} fill="var(--color-muted)" />
            <Bar isAnimationActive={false} dataKey="actual" radius={[6, 6, 0, 0]} maxBarSize={22}>
              {data.map((d) => <Cell key={d.p} fill={d.on || !selected.length ? "url(#actGrad)" : "url(#actGradDim)"} />)}
            </Bar>
            <Line isAnimationActive={false} dataKey="forecast" stroke="var(--color-ink-2)" strokeWidth={2} dot={{ r: 3, fill: "var(--color-surface)", stroke: "var(--color-ink-2)", strokeWidth: 2 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Per function, for the selected period: budget vs actual (reported lines) with gap %. */
export function FunctionBars({ tree, periods }: { tree: SummaryTree; periods: string[] }) {
  const L = tree.labels;
  const rows = tree.functions.map((f) => {
    const a = aggLines(fnLines(f), periods);
    return { name: f.name.replace(" & Fulfilment", ""), plan: a.planReported || a.plan, actual: a.hasActual ? a.actual : 0, gap: a.planReported ? (a.actual - a.planReported) / a.planReported : null };
  });
  const max = Math.max(1, ...rows.flatMap((r) => [r.plan, r.actual]));
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex items-center justify-center text-ink-4"><Layers size={16} /></span>
        <div className="text-[14.5px] font-semibold tracking-[-0.01em]">By function</div>
        <span className="ml-auto text-[12px] font-medium text-ink-3">{L.actual} vs {L.plan.toLowerCase()}</span>
      </div>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">{r.name}</span>
              <span className="text-[13px] tabular"><b className="font-semibold text-ink">{inr(r.actual)}</b> <span className="text-ink-4">/ {inr(r.plan)}</span>
                {r.gap != null && <span className={r.gap > 0.005 ? "ml-2 font-semibold text-bad" : "ml-2 font-semibold text-accent-ink"}>{pct(r.gap, 0, true)}</span>}</span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="absolute inset-y-0 left-0 rounded-full bg-line-strong/70" style={{ width: `${(r.plan / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.actual / max) * 100}%`, background: r.gap != null && r.gap > 0.005 ? "linear-gradient(90deg, #f87171, #dc2626)" : "linear-gradient(90deg, var(--color-accent-2), var(--color-accent))" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export { BarChart };
