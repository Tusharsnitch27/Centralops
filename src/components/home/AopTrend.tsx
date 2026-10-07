"use client";
import { Bar, BarChart, Line, ResponsiveContainer, Tooltip, XAxis, ComposedChart } from "recharts";
import { inr } from "@/lib/format";
import { fmtMonth } from "@/lib/dates";

/** Compact budget-vs-actual trend: plan as quiet bars, actual as a line. */
export function AopTrend({ data, labels }: { data: { period: string; plan: number; actual: number | null; forecast: number | null }[]; labels: { plan: string; actual: string; forecast: string } }) {
  const rows = data.map((d) => ({ ...d, m: fmtMonth(d.period, false) }));
  return (
    <div className="h-[120px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
          <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fontSize: 10.5, fill: "var(--color-ink-4)" }} />
          <Tooltip cursor={{ fill: "rgba(127,127,127,0.06)" }}
            contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)", fontSize: 12, boxShadow: "0 8px 24px -8px rgba(0,0,0,.15)" }}
            formatter={(v, n) => [inr(Number(v)), n === "plan" ? labels.plan : n === "actual" ? labels.actual : labels.forecast]} />
          <Bar isAnimationActive={false} dataKey="plan" fill="var(--color-muted)" radius={[3, 3, 0, 0]} />
          <Line isAnimationActive={false} dataKey="actual" stroke="var(--color-ink)" strokeWidth={1.75} dot={{ r: 2.2, fill: "var(--color-ink)" }} connectNulls={false} />
          <Line isAnimationActive={false} dataKey="forecast" stroke="var(--color-accent)" strokeWidth={1.25} strokeDasharray="3 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
export { Bar, BarChart };
