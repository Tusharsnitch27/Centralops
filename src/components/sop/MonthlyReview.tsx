import { ArrowDownToLine, ArrowUpFromLine, Lightbulb, Warehouse } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MonthlyReview as Data } from "@/server/sop/monthly";
import type { Insight, Row, Seg, WhPoint } from "./reviewMath";

const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const lakh = (v: number) => `${(v / 100000).toFixed(2)}L`;
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Utilisation chip: green near plan, amber drifting, red far off; grey when nothing was planned. */
export function UtilChip({ u, plan, actual, strong }: { u: number | null; plan: number; actual: number; strong?: boolean }) {
  if (plan === 0) return actual > 0 ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-bold text-warn">Unplanned</span> : <span className="text-ink-4">—</span>;
  const v = u ?? 0;
  const cls = v >= 1.4 ? "bg-bad text-white" : v >= 1.15 ? "bg-bad-soft text-bad" : v >= 0.9 ? "bg-accent-soft text-accent-ink" : v >= 0.7 ? "bg-warn-soft text-warn" : v > 0 ? "bg-bad-soft text-bad" : "bg-bad text-white";
  return <span className={cn("inline-block min-w-[52px] rounded-full px-2 py-0.5 text-center text-[12px] font-extrabold tabular", cls, strong && "ring-2 ring-white")}>{pc(u)}</span>;
}

function Rich({ segs }: { segs: Seg[] }) {
  return <>{segs.map((s, i) => typeof s === "string" ? <span key={i}>{s}</span>
    : <b key={i} className={cn("font-extrabold", s.tone === "bad" ? "text-bad" : s.tone === "good" ? "text-accent-ink" : s.tone === "warn" ? "text-warn" : "text-ink")}>{s.b}</b>)}</>;
}

function InsightCards({ items }: { items: Insight[] }) {
  if (!items.length) return <div className="rounded-2xl bg-accent-soft/60 px-4 py-3 text-[13px] font-medium text-accent-ink">No material deviation — plan and actual are within ±15%.</div>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((i, n) => (
        <div key={i.key} className={cn("relative overflow-hidden rounded-2xl border p-3.5",
          i.tone === "bad" ? "border-bad/20 bg-bad-soft/50" : i.tone === "warn" ? "border-warn/20 bg-warn-soft/60" : i.tone === "good" ? "border-accent/20 bg-accent-soft/60" : "border-line bg-subtle/70")}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-extrabold text-white", i.tone === "bad" ? "bg-bad" : i.tone === "warn" ? "bg-warn" : i.tone === "good" ? "bg-accent" : "bg-ink-3")}>{n + 1}</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-4">{i.tone === "bad" ? "Critical" : i.tone === "warn" ? "Watch" : i.tone === "good" ? "Healthy" : "Note"}</span>
          </div>
          <div className="text-[13.5px] leading-snug text-ink"><Rich segs={i.title} /></div>
          <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3"><span className="font-semibold text-ink-2">Impact: </span><Rich segs={i.impact} /></div>
        </div>
      ))}
    </div>
  );
}

function PlanBar({ plan, actual, max }: { plan: number; actual: number; max: number }) {
  const over = actual > plan;
  return (
    <div className="relative h-2 w-full min-w-[90px] overflow-hidden rounded-full bg-muted">
      <div className="absolute inset-y-0 left-0 rounded-full bg-line-strong" style={{ width: `${(plan / max) * 100}%` }} />
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(actual / max) * 100}%`, background: over ? "linear-gradient(90deg,#fb7185,#dc2626)" : "linear-gradient(90deg, var(--color-accent-2), var(--color-accent))", opacity: 0.9 }} />
    </div>
  );
}

function ViewTable({ rows, label }: { rows: Row[]; label: string }) {
  const max = Math.max(1, ...rows.filter((r) => !r.kind).flatMap((r) => [r.tp, r.ta]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-[13px]">
        <thead>
          <tr className="text-[10.5px] font-bold uppercase tracking-[0.08em]">
            <th rowSpan={2} className="thead-hl rounded-tl-xl px-3 py-2 text-left">{label}</th>
            <th colSpan={4} className="border-l-2 border-white px-3 py-1.5 text-center text-white" style={{ background: "var(--color-hero)" }}>Total</th>
            <th colSpan={3} className="border-l-2 border-white bg-[#e8f0fe] px-3 py-1.5 text-center text-[#1e40af]">South</th>
            <th colSpan={3} className="rounded-tr-xl border-l-2 border-white bg-[#fdf2e3] px-3 py-1.5 text-center text-[#9a3412]">North</th>
          </tr>
          <tr className="thead-hl text-[10.5px] font-bold uppercase tracking-[0.06em]">
            {["Plan", "Actual", "Util %", "Plan vs actual", "Plan", "Actual", "Util %", "Plan", "Actual", "Util %"].map((h, i) => (
              <th key={i} className={cn("px-3 py-2", i === 3 ? "text-left" : "text-right", (i === 0 || i === 4 || i === 7) && "border-l-2 border-white")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={cn("border-b border-line/70", r.kind === "total" ? "bg-subtle font-extrabold" : r.kind === "subtotal" ? "bg-subtle/60 font-bold" : "hover:bg-subtle/40")}>
              <td className="px-3 py-2.5 font-semibold text-ink">{r.label}</td>
              <td className="border-l-2 border-line/0 px-3 text-right tabular">{fmt(r.tp)}</td>
              <td className="px-3 text-right font-bold tabular">{fmt(r.ta)}</td>
              <td className="px-3 text-right"><UtilChip u={r.tu} plan={r.tp} actual={r.ta} /></td>
              <td className="px-3">{!r.kind && <PlanBar plan={r.tp} actual={r.ta} max={max} />}</td>
              <td className="px-3 text-right tabular text-ink-2">{fmt(r.sp)}</td>
              <td className="px-3 text-right tabular">{fmt(r.sa)}</td>
              <td className="px-3 text-right"><UtilChip u={r.su} plan={r.sp} actual={r.sa} /></td>
              <td className="px-3 text-right tabular text-ink-2">{fmt(r.np)}</td>
              <td className="px-3 text-right tabular">{fmt(r.na)}</td>
              <td className="px-3 text-right"><UtilChip u={r.nu} plan={r.np} actual={r.na} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WhTile({ name, pts, tone }: { name: string; pts: WhPoint[]; tone: string }) {
  const cur = [...pts].reverse().find((p) => p.util != null);
  const u = cur?.util ?? 0;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[14px] font-bold"><span className="size-2.5 rounded-full" style={{ background: tone }} />{name}</span>
        {cur && <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", u >= 0.9 ? "bg-bad-soft text-bad" : u >= 0.8 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink")}>{u >= 0.9 ? "Near full" : u >= 0.8 ? "Tight" : "Healthy"}</span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-[36px] font-extrabold leading-none tracking-[-0.04em] tabular">{pc(cur?.util ?? null)}</span>
        <span className="mb-1 text-[12.5px] font-medium text-ink-3">utilised · {cur ? mon(cur.period) : ""}</span>
      </div>
      <div className="mt-1 text-[12.5px] text-ink-3"><b className="font-bold text-ink">{cur?.inventory != null ? lakh(cur.inventory) : "—"}</b> on hand of <b className="font-bold text-ink">{cur ? lakh(cur.capacity) : "—"}</b> capacity</div>
      <div className="mt-4 flex h-20 items-end gap-2">
        {pts.map((p) => (
          <div key={p.period} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative flex h-14 w-full items-end overflow-hidden rounded-lg bg-muted">
              {p.util != null && <div className="w-full rounded-lg" style={{ height: `${Math.min(100, p.util * 100)}%`, background: p.util >= 0.9 ? "linear-gradient(180deg,#fb7185,#dc2626)" : p.util >= 0.8 ? "linear-gradient(180deg,#fbbf24,#d97706)" : "linear-gradient(180deg, var(--color-accent-2), var(--color-accent))" }} />}
            </div>
            <span className="text-[10.5px] font-semibold text-ink-4">{mon(p.period).split(" ")[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyReviewView({ d }: { d: Data }) {
  const flows: { key: "outbound" | "inbound"; title: string; icon: React.ReactNode }[] = [
    { key: "outbound", title: "Outbound — channels & stores", icon: <ArrowUpFromLine size={16} /> },
    { key: "inbound", title: "Inbound — inward, pre-pack & categories", icon: <ArrowDownToLine size={16} /> },
  ];
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent"><Warehouse size={16} /></span><h2 className="text-[19px] font-extrabold tracking-[-0.02em]">Warehouse utilisation</h2></div>
        <div className="grid gap-4 lg:grid-cols-3">
          <WhTile name="South (BLR)" pts={d.wh.South} tone="#2563eb" />
          <WhTile name="North (GGN)" pts={d.wh.North} tone="#ea580c" />
          <WhTile name="Total" pts={d.wh.Total} tone="var(--color-ink)" />
        </div>
        {d.whInsights.length > 0 && <div className="mt-4"><InsightCards items={d.whInsights} /></div>}
      </section>

      {flows.map((f) => (
        <section key={f.key} className="space-y-5">
          <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-xl bg-accent-soft text-accent">{f.icon}</span><h2 className="text-[19px] font-extrabold tracking-[-0.02em]">{f.title}</h2></div>
          {d.views.filter((v) => v.def.flow === f.key).map((v) => {
            const t = v.rows.find((r) => r.kind === "total")!;
            return (
              <div key={v.def.key} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[17px] font-extrabold tracking-[-0.02em]">{v.def.title}</div>
                    <div className="text-[12.5px] font-medium text-ink-3">{v.def.sub} · 1–{new Date(Date.UTC(Number(d.period.slice(0, 4)), Number(d.period.slice(5, 7)), 0)).getUTCDate()} {mon(d.period)}</div>
                  </div>
                  <div className="flex items-center gap-4 text-[12.5px]">
                    <span className="text-ink-3">Plan <b className="font-extrabold text-ink tabular">{fmt(t.tp)}</b></span>
                    <span className="text-ink-3">Actual <b className="font-extrabold text-ink tabular">{fmt(t.ta)}</b></span>
                    <span className="flex items-center gap-1.5 text-ink-3">Total <UtilChip u={t.tu} plan={t.tp} actual={t.ta} /></span>
                    <span className="flex items-center gap-1.5 text-ink-3">South <UtilChip u={t.su} plan={t.sp} actual={t.sa} /></span>
                    <span className="flex items-center gap-1.5 text-ink-3">North <UtilChip u={t.nu} plan={t.np} actual={t.na} /></span>
                  </div>
                </div>
                <div className="border-b border-line bg-subtle/30 px-5 py-4">
                  <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-4"><Lightbulb size={13} className="text-accent" /> Top insights</div>
                  <InsightCards items={v.insights} />
                </div>
                <ViewTable rows={v.rows} label={v.def.rowLabel} />
              </div>
            );
          })}
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className="font-bold text-ink-2">Utilisation key:</span>
        <UtilChip u={0.95} plan={1} actual={1} /> within ±10% <UtilChip u={0.78} plan={1} actual={1} /> 70–90% <UtilChip u={0.5} plan={1} actual={1} /> below 70% <UtilChip u={1.2} plan={1} actual={1} /> 115–140% <UtilChip u={1.5} plan={1} actual={1} /> 140%+ · Totals are calculated from the South + North figures.
      </div>
    </div>
  );
}
