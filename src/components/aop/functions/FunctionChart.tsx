"use client";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num } from "@/lib/format";

/** One chart point, labelled on the server; null = missing (a gap, never 0). */
export interface FnChartPoint { label: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
  idealHeads: number | null; actualHeads: number | null; costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null;
  /** rulebook scenario only: heads the store orders need, as placed and on rulebook days */
  neededAsIs?: number | null; neededRulebook?: number | null; asPlaced?: number | null }

// one hue per meaning, shape inside it (charts.md › Color): volume = blue (bars received, line processed), plan = grey dashed,
// cost = violet (solid actual, dashed ideal), overlay % = green, issues = red, rulebook heads = amber. Axis ticks carry their series' hue.
const VOL = "var(--color-info)", REC = "rgb(29 78 216 / 0.16)", PROJ = "var(--color-ink-4)", PROC = VOL, ISS = "var(--color-bad)";
const CPU = "var(--color-violet)", OVL = "var(--color-ok)", NEED = "var(--color-warn)";
const r2 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);

/** Units on the left (projected, received, processed, issues), manpower ₹ per unit on the right, overlay % on its own hidden 0–100 axis.
 *  The rulebook scenario (points carrying neededAsIs) draws ScenarioChart instead. */
export function FunctionChart({ data, heads, received, overlay, height = 300 }: {
  data: FnChartPoint[]; heads: string; received: string; overlay: string | null; height?: number;
}) {
  if (data.some((d) => d.neededAsIs !== undefined)) return <ScenarioChart data={data} height={height} />;
  const hasIssues = data.some((d) => d.issues != null), hasOverlay = overlay != null && data.some((d) => d.overlay != null);
  const maxIss = Math.max(1, ...data.map((d) => d.issues ?? 0));
  type K = { label: string; line?: string; box?: string; edge?: string; dash?: boolean };
  const groups: { title: string; items: K[] }[] = [
    { title: "Volume", items: [{ label: "Projected", line: PROJ, dash: true }, { label: received, box: REC, edge: VOL }, { label: "Processed", line: PROC },
      ...(hasIssues ? [{ label: "Issues", box: ISS }] : [])] },
    { title: "Cost", items: [{ label: "₹ / unit", line: CPU }, { label: "Ideal ₹ / unit", line: CPU, dash: true }] },
    ...(hasOverlay ? [{ title: "Other", items: [{ label: overlay!, line: OVL }] }] : []),
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12px] text-ink-3">
        {groups.map((g) => (
          <span key={g.title} className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-4">{g.title}</span>
            {g.items.map((k) => (
              <span key={k.label} className="flex items-center gap-1.5">
                {k.box ? <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: k.box, boxShadow: k.edge ? `inset 0 0 0 1px ${k.edge}` : undefined }} />
                  : <span className="inline-block w-4 border-t-2" style={{ borderColor: k.line, borderTopStyle: k.dash ? "dashed" : "solid" }} />}
                {k.label}
              </span>
            ))}
          </span>
        ))}
        <span className="ml-auto text-ink-4"><span style={{ color: VOL }}>units</span> left · <span style={{ color: CPU }}>₹ per unit</span> right</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} minTickGap={12} />
          <YAxis yAxisId="u" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: VOL, fillOpacity: 0.75 }} tickFormatter={(v: number) => num(v)} />
          <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: CPU, fillOpacity: 0.75 }} tickFormatter={(v: number) => `₹${v}`} />
          {/* issues sit low on their own scale; overlay on 0–100 % */}
          <YAxis yAxisId="i" hide domain={[0, maxIss * 4]} />
          <YAxis yAxisId="p" hide domain={[0, 100]} />
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
              </div>
            );
          }} />
          <Bar yAxisId="u" dataKey="received" fill={REC} stroke={VOL} strokeOpacity={0.35} strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          {hasIssues && <Bar yAxisId="i" dataKey="issues" fill={ISS} radius={[2, 2, 0, 0]} maxBarSize={8} isAnimationActive={false} />}
          <Line yAxisId="u" dataKey="projected" stroke={PROJ} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 1.5, strokeWidth: 0, fill: PROJ }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="u" dataKey="processed" stroke={PROC} strokeWidth={2.25} dot={{ r: 2.75, strokeWidth: 0, fill: PROC }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="r" dataKey="costPerUnit" stroke={CPU} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: CPU }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="r" dataKey="idealCostPerUnit" stroke={CPU} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 1.5, strokeWidth: 0, fill: CPU }} connectNulls={false} isAnimationActive={false} />
          {hasOverlay && <Line yAxisId="p" dataKey="overlay" stroke={OVL} strokeWidth={1.5} strokeOpacity={0.8} dot={false} connectNulls={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
/** Rulebook followed, kept to the one question: store orders moved to their rulebook days (bars) against as placed (dashed), units left,
 *  and the heads those volumes need (amber: solid on rulebook days, dashed as placed), heads right. Cost and the rest stay on "As is". */
function ScenarioChart({ data, height }: { data: FnChartPoint[]; height: number }) {
  const key = (k: { label: string; line?: string; box?: string; dash?: boolean }) => (
    <span key={k.label} className="flex items-center gap-1.5">
      {k.box ? <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: k.box, boxShadow: `inset 0 0 0 1px ${VOL}` }} />
        : <span className="inline-block w-4 border-t-2" style={{ borderColor: k.line, borderTopStyle: k.dash ? "dashed" : "solid" }} />}
      {k.label}
    </span>
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
        {[{ label: "Store orders on rulebook days", box: REC }, { label: "Store orders as placed", line: PROJ, dash: true },
          { label: "Heads needed, on rulebook days", line: NEED }, { label: "Heads needed, as placed", line: NEED, dash: true }].map(key)}
        <span className="ml-auto text-ink-4"><span style={{ color: VOL }}>units</span> left · <span style={{ color: NEED }}>heads</span> right</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} minTickGap={12} />
          <YAxis yAxisId="u" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: VOL, fillOpacity: 0.75 }} tickFormatter={(v: number) => num(v)} />
          <YAxis yAxisId="h" orientation="right" tickLine={false} axisLine={false} width={36} tick={{ fontSize: 11, fill: NEED, fillOpacity: 0.9 }} tickFormatter={(v: number) => num(v)} />
          <Tooltip cursor={{ fill: "rgb(127 127 127 / 0.06)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as FnChartPoint;
            return (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
                <div className="mb-1 font-medium text-ink">{p.label}</div>
                <Row k="Store orders on rulebook days" v={num(p.received)} />
                <Row k="Store orders as placed" v={num(p.asPlaced ?? null)} />
                <Row k="Heads needed, on rulebook days" v={num(p.neededRulebook ?? null)} />
                <Row k="Heads needed, as placed" v={num(p.neededAsIs ?? null)} />
              </div>
            );
          }} />
          <Bar yAxisId="u" dataKey="received" fill={REC} stroke={VOL} strokeOpacity={0.35} strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Line yAxisId="u" dataKey="asPlaced" stroke={PROJ} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="h" dataKey="neededAsIs" stroke={NEED} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="h" dataKey="neededRulebook" stroke={NEED} strokeWidth={2.25} dot={{ r: 2.5, strokeWidth: 0, fill: NEED }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-6 text-ink-2"><span className="text-ink-3">{k}</span><span className="tabular">{v}</span></div>;
