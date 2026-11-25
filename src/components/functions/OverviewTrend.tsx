"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num } from "@/lib/format";

/** One trend point, labelled on the server; null = not covered (a gap, never 0). partial = the period's feeds did not cover every day. */
export interface TrendPoint { label: string; txn: number | null; heads: number | null; partial: boolean; perTxn: number | null }

// as the function charts: volume blue (bars), cost violet (₹ per item, right axis, tinted to match), heads grey (own scale)
const TXN = "var(--color-info)", TXN_SOFT = "rgb(29 78 216 / 0.22)", COST = "var(--color-violet)", HEADS = "var(--color-ink-4)";

/** Items handled (bars, left axis), ₹ per item (line, right axis) and heads present (dashed line, own scale). Partial periods are lighter. */
export function OverviewTrend({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: TXN }} />Items handled</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: TXN_SOFT, boxShadow: `inset 0 0 0 1px ${TXN}` }} />Partial coverage</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2" style={{ borderColor: COST }} />₹ per item</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t-2" style={{ borderColor: HEADS, borderTopStyle: "dashed" }} />Heads present (daily average)</span>
        <span className="ml-auto text-ink-4"><span style={{ color: TXN }}>items</span> left · <span style={{ color: COST }}>₹ per item</span> right</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} minTickGap={10} />
          <YAxis yAxisId="t" tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: TXN, fillOpacity: 0.8 }} tickFormatter={(v: number) => num(v)} />
          <YAxis yAxisId="c" orientation="right" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: COST, fillOpacity: 0.8 }} tickFormatter={(v: number) => `₹${v}`} />
          <YAxis yAxisId="h" hide domain={[0, (max: number) => max * 1.6]} />
          <Tooltip cursor={{ fill: "rgb(127 127 127 / 0.06)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as TrendPoint;
            return (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
                <div className="mb-1 font-medium text-ink">{p.label}{p.partial && <span className="ml-1.5 text-warn">partial</span>}</div>
                <Row k="Items handled" v={num(p.txn)} />
                <Row k="Heads present (daily average)" v={num(p.heads)} />
                <Row k="₹ per item" v={p.perTxn == null ? "—" : `₹${p.perTxn.toFixed(2)}`} />
              </div>
            );
          }} />
          <Bar yAxisId="t" dataKey="txn" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}
            shape={(props: unknown) => { const { x, y, width, height: h, payload } = props as { x: number; y: number; width: number; height: number; payload: TrendPoint };
              return <rect x={x} y={y} width={width} height={Math.max(0, h)} rx={3} fill={payload.partial ? TXN_SOFT : TXN} stroke={payload.partial ? TXN : "none"} strokeOpacity={0.6} />; }} />
          <Line yAxisId="h" dataKey="heads" stroke={HEADS} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="c" dataKey="perTxn" stroke={COST} strokeWidth={2.25} dot={{ r: 2.75, strokeWidth: 0, fill: COST }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-6 text-ink-2"><span className="text-ink-3">{k}</span><span className="tabular">{v}</span></div>;
