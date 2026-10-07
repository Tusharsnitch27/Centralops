"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "@/lib/format";

export interface MonthPoint { period: string; label: string; plan: number | null; forecast: number | null; actual: number | null; closed: boolean }
interface Labels { plan: string; forecast: string; actual: string }

const C = { plan: "var(--color-line-strong)", forecast: "var(--color-accent)", actual: "var(--color-ink)", grid: "var(--color-line)", axis: "var(--color-ink-4)" };

function Tip({ active, payload, labels }: { active?: boolean; payload?: { payload: MonthPoint }[]; labels: Labels }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: [string, number | null, string][] = [[labels.plan, p.plan, C.plan], [labels.forecast, p.forecast, C.forecast], [labels.actual, p.actual, C.actual]];
  const v = p.actual != null && p.plan ? p.actual - p.plan : null;
  return (
    <div className="min-w-[180px] rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
      <div className="mb-1.5 font-medium text-ink">{p.label}{!p.closed && <span className="ml-1.5 font-normal text-ink-4">open</span>}</div>
      {rows.map(([k, val, c]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-ink-3"><span className="size-2 rounded-sm" style={{ background: c }} />{k}</span>
          <span className="tabular text-ink">{inr(val)}</span>
        </div>
      ))}
      {v != null && <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-ink-3"><span>Δ vs {labels.plan.toLowerCase()}</span><span className="tabular text-ink-2">{inr(v, { sign: true })}</span></div>}
    </div>
  );
}

/** Monthly plan (bars) vs forecast (dashed) vs actual (bars). One axis. */
export function MonthlyChart({ data, labels, height = 240, compact = false }: { data: MonthPoint[]; labels: Labels; height?: number; compact?: boolean }) {
  const lastClosed = [...data].reverse().find((d) => d.closed)?.label;
  return (
    <div>
      {!compact && (
        <div className="mb-2 flex items-center gap-4 text-[11.5px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.plan }} />{labels.plan}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.actual }} />{labels.actual}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed" style={{ borderColor: C.forecast }} />{labels.forecast}</span>
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: compact ? -24 : 0 }} barGap={2} barCategoryGap={compact ? "22%" : "28%"}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: C.axis }} interval={0} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: C.axis }} width={compact ? 40 : 58} tickFormatter={(v: number) => inr(v).replace("₹", "")} hide={compact} />
            <Tooltip content={<Tip labels={labels} />} cursor={{ fill: "rgb(127 127 127 / 0.06)" }} />
            {lastClosed && !compact && <ReferenceLine x={lastClosed} stroke="transparent" label={{ value: "last closed", position: "insideTopRight", fontSize: 10, fill: C.axis }} />}
            <Bar isAnimationActive={false} dataKey="plan" fill={C.plan} radius={[3, 3, 0, 0]} maxBarSize={18} />
            <Bar isAnimationActive={false} dataKey="actual" fill={C.actual} radius={[3, 3, 0, 0]} maxBarSize={18} />
            <Line dataKey="forecast" stroke={C.forecast} strokeWidth={1.75} strokeDasharray="4 3" dot={{ r: 2.5, fill: C.forecast, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
