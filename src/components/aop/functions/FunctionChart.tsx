"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num } from "@/lib/format";

/** One chart point, labelled on the server; null = missing (a gap, never 0). */
export interface FnChartPoint { label: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
  idealHeads: number | null; actualHeads: number | null; costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null;
  /** rulebook scenario only: heads the store orders need, as placed and on rulebook days */
  neededAsIs?: number | null; neededRulebook?: number | null }

const PROJ = "var(--color-ink-3)", REC = "var(--color-line-strong)", PROC = "var(--color-ink)", ISS = "var(--color-bad)";
const CPU = "var(--color-accent)", OVL = "var(--color-warn)", NEED = "var(--color-ok)";
const r2 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);

/** Units on the left (projected, received, processed, issues), manpower ₹ per unit on the right, overlay % on its own hidden 0–100 axis,
 *  heads needed (rulebook scenario) on their own hidden heads axis. */
export function FunctionChart({ data, heads, received, overlay, height = 300 }: {
  data: FnChartPoint[]; heads: string; received: string; overlay: string | null; height?: number;
}) {
  const hasIssues = data.some((d) => d.issues != null), hasOverlay = overlay != null && data.some((d) => d.overlay != null);
  const maxIss = Math.max(1, ...data.map((d) => d.issues ?? 0));
  const hasNeed = data.some((d) => d.neededAsIs != null || d.neededRulebook != null);
  const maxNeed = Math.max(1, ...data.flatMap((d) => [d.neededAsIs ?? 0, d.neededRulebook ?? 0]));
  const key = [
    { label: "Projected", line: PROJ, dash: true }, { label: received, box: REC }, { label: "Processed", line: PROC },
    ...(hasIssues ? [{ label: "Issues", box: ISS }] : []),
    { label: "₹ / unit", line: CPU }, { label: "Ideal ₹ / unit", line: CPU, dash: true },
    ...(hasOverlay ? [{ label: overlay!, line: OVL }] : []),
    ...(hasNeed ? [{ label: "Heads needed, as placed", line: NEED, dash: true }, { label: "Heads needed, on rulebook days", line: NEED }] : []),
  ];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {key.map((k) => (
          <span key={k.label} className="flex items-center gap-1.5">
            {"box" in k ? <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: k.box }} />
              : <span className="inline-block w-4 border-t-2" style={{ borderColor: k.line, borderTopStyle: k.dash ? "dashed" : "solid" }} />}
            {k.label}
          </span>
        ))}
        <span className="ml-auto text-ink-4">units · ₹ per unit{hasNeed ? " · heads on their own scale" : ""}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} minTickGap={12} />
          <YAxis yAxisId="u" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--color-ink-4)" }} tickFormatter={(v: number) => num(v)} />
          <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--color-ink-4)" }} tickFormatter={(v: number) => `₹${v}`} />
          {/* issues sit low on their own scale; overlay on 0–100 % */}
          <YAxis yAxisId="i" hide domain={[0, maxIss * 4]} />
          <YAxis yAxisId="p" hide domain={[0, 100]} />
          <YAxis yAxisId="h" hide domain={[0, maxNeed * 1.15]} />
          <Tooltip cursor={{ fill: "rgb(127 127 127 / 0.06)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as FnChartPoint;
            return (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
                <div className="mb-1 font-medium text-ink">{p.label}</div>
                <Row k="Projected" v={num(p.projected)} />
                <Row k={received} v={num(p.received)} />
                <Row k="Processed" v={num(p.processed)} />
                {hasIssues && <Row k="Issues" v={num(p.issues)} />}
                <Row k={`${heads}, actual`} v={num(p.actualHeads)} />
                <Row k={`${heads}, ideal`} v={num(p.idealHeads)} />
                <Row k="₹ / unit" v={r2(p.costPerUnit)} />
                <Row k="Ideal ₹ / unit" v={r2(p.idealCostPerUnit)} />
                {hasOverlay && <Row k={overlay!} v={p.overlay == null ? "—" : `${p.overlay.toFixed(0)}%`} />}
                {hasNeed && <Row k="Heads needed, as placed" v={num(p.neededAsIs ?? null)} />}
                {hasNeed && <Row k="Heads needed, on rulebook days" v={num(p.neededRulebook ?? null)} />}
              </div>
            );
          }} />
          <Bar yAxisId="u" dataKey="received" fill={REC} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          {hasIssues && <Bar yAxisId="i" dataKey="issues" fill={ISS} radius={[2, 2, 0, 0]} maxBarSize={8} isAnimationActive={false} />}
          <Line yAxisId="u" dataKey="projected" stroke={PROJ} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 1.5, strokeWidth: 0, fill: PROJ }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="u" dataKey="processed" stroke={PROC} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: PROC }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="r" dataKey="costPerUnit" stroke={CPU} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: CPU }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="r" dataKey="idealCostPerUnit" stroke={CPU} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 1.5, strokeWidth: 0, fill: CPU }} connectNulls={false} isAnimationActive={false} />
          {hasOverlay && <Line yAxisId="p" dataKey="overlay" stroke={OVL} strokeWidth={1} dot={false} connectNulls={false} isAnimationActive={false} />}
          {hasNeed && <Line yAxisId="h" dataKey="neededAsIs" stroke={NEED} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />}
          {hasNeed && <Line yAxisId="h" dataKey="neededRulebook" stroke={NEED} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: NEED }} connectNulls={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-6 text-ink-2"><span className="text-ink-3">{k}</span><span className="tabular">{v}</span></div>;
