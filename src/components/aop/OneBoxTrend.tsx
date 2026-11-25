"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** 1-box LRs as a share of all LRs, month on month: both sites, South and North (null = no LRs that month, a gap). */
export function OneBoxTrend({ data }: { data: { label: string; both: number | null; South: number | null; North: number | null }[] }) {
  const lines = [{ k: "both", name: "All sites", color: "var(--color-ink-3)", dash: "5 4" }, { k: "South", name: "South", color: "var(--color-info)" }, { k: "North", name: "North", color: "var(--color-violet)" }] as const;
  const pc = (v: unknown) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—");
  return (
    <div className="mb-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-4">1-box LRs, % of LRs · every month, by warehouse (site and month filters don't apply)</span>
        {lines.map((l) => <span key={l.k} className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2" style={{ borderColor: l.color, borderTopStyle: "dash" in l ? "dashed" : "solid" }} />{l.name}</span>)}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} />
          <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip formatter={(v, name) => [pc(v), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          {lines.map((l) => <Line key={l.k} dataKey={l.k} name={l.name} stroke={l.color} strokeWidth={l.k === "both" ? 1.5 : 2.25} strokeDasharray={"dash" in l ? l.dash : undefined}
            dot={{ r: 2.5, strokeWidth: 0, fill: l.color }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
