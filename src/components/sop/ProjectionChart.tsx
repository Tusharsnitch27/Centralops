"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, pct } from "@/lib/format";

export interface ChartPoint { label: string; projection: number | null; baseline: number | null; actual: number | null; demo: boolean }

const PROJ = "var(--color-line-strong)";   // neutral — the plan
const ACT = "var(--color-ink)";    // ink — what happened
const DEMO = "var(--color-warn)";   // amber — illustrative only

export function ProjectionChart({ data, metric, height = 240 }: { data: ChartPoint[]; metric: string; height?: number }) {
  const anyDemo = data.some((d) => d.demo && d.actual != null);
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: PROJ }} />Projection</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: anyDemo ? DEMO : ACT }} />Actual{anyDemo ? " (demo)" : ""}</span>
        <span className="ml-auto">{metric}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11.5, fill: "var(--color-ink-3)" }} />
          <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--color-ink-4)" }} tickFormatter={(v: number) => num(v)} />
          <Tooltip cursor={{ fill: "rgb(127 127 127 / 0.06)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as ChartPoint;
            const v = p.actual != null && p.baseline ? (p.actual - p.baseline) / p.baseline : null;
            return (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
                <div className="mb-1 font-medium text-ink">{p.label}</div>
                <Row k="Projection" v={num(p.projection)} />
                {p.baseline != null && p.baseline !== p.projection && <Row k="Baseline" v={num(p.baseline)} />}
                <Row k={p.demo ? "Actual (demo)" : "Actual"} v={num(p.actual)} />
                {v != null && <Row k="Variance" v={pct(v, 1, true)} />}
              </div>
            );
          }} />
          <Bar isAnimationActive={false} dataKey="projection" fill={PROJ} radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Line dataKey="actual" stroke={anyDemo ? DEMO : ACT} strokeWidth={2} strokeDasharray={anyDemo ? "4 3" : undefined}
            dot={{ r: 3.5, strokeWidth: 2, stroke: "#fff", fill: anyDemo ? DEMO : ACT }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-6 text-ink-2"><span className="text-ink-3">{k}</span><span className="tabular">{v}</span></div>;
