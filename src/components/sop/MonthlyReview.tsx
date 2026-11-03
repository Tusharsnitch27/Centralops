import { Fragment } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Warehouse } from "lucide-react";
import { cn } from "@/lib/cn";
import { Collapsible, ExpandAll } from "@/components/ui/Collapsible";
import type { MonthlyReview as Data } from "@/server/sop/monthly";
import type { DailyView } from "@/server/sop/daily";
import { FunctionTile } from "./FunctionTile";
import { ExpandTable } from "./ExpandTable";
import { returnRate, type OverallRow, type FlowCalc, type Insight, type ReturnsRow, type Row, type Seg, type WhPoint } from "./reviewMath";

const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const lakh = (v: number) => `${(v / 100000).toFixed(2)}L`;
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export { UtilChip } from "./UtilChip";
import { UtilChip } from "./UtilChip";
import { WhCapacityBar } from "./WhCapacityBar";

function Rich({ segs }: { segs: Seg[] }) {
  return <>{segs.map((s, i) => typeof s === "string" ? <span key={i}>{s}</span>
    : <b key={i} className={cn("font-semibold", s.tone === "bad" ? "text-bad" : s.tone === "good" ? "text-accent-ink" : s.tone === "warn" ? "text-warn" : "text-ink")}>{s.b}</b>)}</>;
}

function InsightCards({ items }: { items: Insight[] }) {
  if (!items.length) return <div className="rounded-2xl bg-accent-soft/60 px-4 py-3 text-[13px] font-medium text-accent-ink">No material deviation — plan and actual are within ±20%.</div>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((i, n) => (
        <div key={i.key} className={cn("relative overflow-hidden rounded-2xl border p-3.5",
          i.tone === "bad" ? "border-bad/20 bg-bad-soft/50" : i.tone === "warn" ? "border-warn/20 bg-warn-soft/60" : i.tone === "good" ? "border-accent/20 bg-accent-soft/60" : "border-line bg-subtle/70")}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className={cn("flex size-5 items-center justify-center rounded-full text-[11px] font-semibold text-white", i.tone === "bad" ? "bg-bad" : i.tone === "warn" ? "bg-warn" : i.tone === "good" ? "bg-accent" : "bg-ink-3")}>{n + 1}</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">{i.tone === "bad" ? "Critical" : i.tone === "warn" ? "Watch" : i.tone === "good" ? "Healthy" : "Note"}</span>
          </div>
          <div className="text-[13px] leading-snug text-ink"><Rich segs={i.title} /></div>
          <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3"><span className="font-semibold text-ink-2">Impact: </span><Rich segs={i.impact} /></div>
        </div>
      ))}
    </div>
  );
}

function ViewTable({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-[13px]">
        <thead>
          <tr className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
            <th rowSpan={2} className="thead-hl rounded-tl-xl px-3 py-2 text-left">{label}</th>
            <th colSpan={4} className="border-l-2 border-white px-3 py-1.5 text-center text-white" style={{ background: "var(--color-hero)" }}>Total</th>
            <th colSpan={3} className="border-l-2 border-white bg-[#e8f0fe] px-3 py-1.5 text-center text-[#1e40af]">South</th>
            <th colSpan={3} className="rounded-tr-xl border-l-2 border-white bg-[#fdf2e3] px-3 py-1.5 text-center text-[#9a3412]">North</th>
          </tr>
          <tr className="thead-hl text-[10.5px] font-semibold uppercase tracking-[0.06em]">
            {["Plan", "Actual", "Variance", "Util %", "Plan", "Actual", "Util %", "Plan", "Actual", "Util %"].map((h, i) => (
              <th key={i} className={cn("px-3 py-2 text-right", (i === 0 || i === 4 || i === 7) && "border-l-2 border-white")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={cn("border-b border-line/70", r.kind === "total" ? "bg-subtle font-semibold" : r.kind === "subtotal" ? "bg-subtle/60 font-semibold" : "hover:bg-subtle/40")}>
              <td className="px-3 py-2.5 font-semibold text-ink">{r.label}</td>
              <td className="border-l-2 border-line/0 px-3 text-right tabular">{fmt(r.tp)}</td>
              <td className="px-3 text-right font-semibold tabular">{fmt(r.ta)}</td>
              <td className={cn("px-3 text-right font-semibold tabular", r.gap > 0 ? "text-bad" : r.gap < 0 ? "text-warn" : "text-ink-4")}>{r.gap === 0 ? "—" : `${r.gap > 0 ? "+" : "−"}${fmt(Math.abs(r.gap))}`}</td>
              <td className="px-3 text-right"><UtilChip u={r.tu} plan={r.tp} actual={r.ta} /></td>
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

// space used, split: sellable · bad · other (blocked + not found + putaway pending)
const SEG = [
  { k: "good" as const, label: "Good", cls: "bg-ink/80" },
  { k: "bad" as const, label: "Bad", cls: "bg-bad" },
  { k: "other" as const, label: "Blocked / not found / putaway", cls: "bg-warn" },
];
function WhTile({ name, pts, tone }: { name: string; pts: WhPoint[]; tone: string }) {
  const cur = [...pts].reverse().find((p) => p.util != null);
  const prev = cur ? [...pts].reverse().find((p) => p.util != null && p.period < cur.period) : undefined;
  const u = cur?.util ?? 0;
  const cap = cur?.capacity || 1;
  const split = cur && cur.good != null;
  const free = cur ? Math.max(0, cur.capacity - (cur.inventory ?? 0)) : 0;
  const notSellable = cur && cur.inventory ? ((cur.bad ?? 0) + (cur.other ?? 0)) / cur.inventory : null;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold"><span className="size-2.5 rounded-full" style={{ background: tone }} />{name}</span>
        {cur && <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", u >= 0.9 ? "bg-bad-soft text-bad" : u >= 0.8 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink")}>{u >= 0.9 ? "Near full" : u >= 0.8 ? "Tight" : "Healthy"}</span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular">{pc(cur?.util ?? null)}</span>
        <span className="mb-1 text-[12.5px] font-medium text-ink-3">used · {cur ? mon(cur.period) : ""}</span>
        {prev?.util != null && cur?.util != null && <span className={cn("mb-1 ml-auto text-[12px] font-semibold tabular", cur.util > prev.util ? "text-bad" : "text-ok")}>{cur.util > prev.util ? "▲" : "▼"} {Math.abs((cur.util - prev.util) * 100).toFixed(1)} pts</span>}
      </div>
      {/* capacity bar: good | bad | other | free */}
      <div className="mt-3 flex h-2.5 rounded-full bg-muted">
        {(split ? [...SEG.map((sg) => ({ label: sg.label, cls: sg.cls, v: cur![sg.k] ?? 0 })), { label: "Free", cls: "", v: free }]
          : [{ label: "Used", cls: "bg-ink/80", v: cur?.inventory ?? 0 }, { label: "Free", cls: "", v: free }]).filter((x) => x.v > 0).map((x, i, all) => (
          <span key={x.label} className={cn("group relative h-full cursor-default transition-transform hover:scale-y-[1.6]", x.cls, i === 0 && "rounded-l-full", i === all.length - 1 && "rounded-r-full")} style={{ width: `${Math.min(100, (x.v / cap) * 100)}%` }}>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white shadow-lg group-hover:block">
              {x.label} · <b className="tabular">{lakh(x.v)}</b> · {pc(x.v / cap)} of capacity
            </span>
          </span>
        ))}
      </div>
      {split ? (
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          {SEG.map((sg) => (
            <span key={sg.k} className="flex items-center gap-1.5 text-ink-3"><span className={cn("size-2 rounded-sm", sg.cls)} />{sg.label}<b className="ml-auto font-semibold tabular text-ink">{lakh(cur![sg.k] ?? 0)}</b></span>
          ))}
          <span className="flex items-center gap-1.5 text-ink-3"><span className="size-2 rounded-sm bg-muted ring-1 ring-inset ring-line" />Free<b className="ml-auto font-semibold tabular text-ink">{lakh(free)}</b></span>
          <span className="col-span-2 mt-1 flex items-center gap-1.5 border-t border-line pt-1.5 text-ink-2"><b className="font-semibold">Total used</b><b className="ml-auto font-semibold tabular text-ink">{lakh(cur!.inventory ?? 0)}</b><span className="text-ink-4">of {lakh(cur!.capacity)} capacity</span></span>
        </div>
      ) : <div className="mt-2 text-[12.5px] text-ink-3"><b className="font-semibold text-ink">{cur?.inventory != null ? lakh(cur.inventory) : "—"}</b> used of <b className="font-semibold text-ink">{cur ? lakh(cur.capacity) : "—"}</b> capacity</div>}
      {cur && cur.spUsed != null && <AreaMeter p={cur} />}
      {notSellable != null && notSellable > 0 && (
        <div className={cn("mt-2.5 rounded-lg px-2.5 py-1.5 text-[12px]", notSellable >= 0.08 ? "bg-bad-soft text-bad" : "bg-subtle text-ink-2")}>
          <b className="font-semibold">{pc(notSellable)}</b> of used space isn’t sellable (bad + blocked / not found / pending)
        </div>
      )}
    </div>
  );
}
// the Details column stays pinned beside the Warehouse column while months scroll
const PIN2 = "pin left-[140px] whitespace-nowrap px-4 py-2 shadow-[inset_-1px_0_0_var(--color-line)]";
/** The pre-pack area (pre-packs as packs + perfumes / shoes / bags / trolleys) against its own capacity, hoverable like the main bar. */
function AreaMeter({ p }: { p: WhPoint }) {
  const cap = p.spCap || Math.max(1, p.spUsed ?? 0);
  const parts = [{ label: "Pre-packs (packs)", cls: "bg-accent", v: p.packs ?? 0 }, { label: "Perfumes / shoes / bags / trolleys", cls: "bg-[#7c5cbf]", v: p.special ?? 0 },
    ...(p.spCap ? [{ label: "Free", cls: "", v: Math.max(0, p.spCap - (p.spUsed ?? 0)) }] : [])].filter((x) => x.v > 0);
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-semibold text-ink-2">Pre-pack area</span>
        <span className="text-ink-3"><b className="font-semibold tabular text-ink">{lakh(p.spUsed ?? 0)}</b>{p.spCap ? <> of {lakh(p.spCap)} · <b className={cn("font-semibold tabular", (p.spUtil ?? 0) >= 0.9 ? "text-bad" : (p.spUtil ?? 0) >= 0.8 ? "text-warn" : "text-ok")}>{pc(p.spUtil)}</b></> : <span className="text-ink-4"> · set its capacity above</span>}</span>
      </div>
      <div className="mt-1.5 flex h-2 rounded-full bg-muted">
        {parts.map((x, i, all) => (
          <span key={x.label} className={cn("group relative h-full cursor-default transition-transform hover:scale-y-[1.6]", x.cls, i === 0 && "rounded-l-full", i === all.length - 1 && "rounded-r-full")} style={{ width: `${Math.min(100, (x.v / cap) * 100)}%` }}>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-white shadow-lg group-hover:block">
              {x.label} · <b className="tabular">{lakh(x.v)}</b>{p.spCap ? ` · ${pc(x.v / p.spCap)} of area` : ""}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" />Pre-packs <b className="tabular text-ink">{lakh(p.packs ?? 0)}</b></span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#7c5cbf]" />Perfumes / shoes / bags / trolleys <b className="tabular text-ink">{lakh(p.special ?? 0)}</b></span>
      </div>
    </div>
  );
}
function WhTable({ wh, prepack }: { wh: Data["wh"]; prepack: Data["prepack"] }) {
  const blocks: [string, WhPoint[], string][] = [["South (BLR)", wh.South, "#e8f0fe"], ["North (GGN)", wh.North, "#fdf2e3"], ["Total", wh.Total, "#e7f7ed"]];
  const pp = (name: string, m: string) => { const k = name.startsWith("South") ? "South" : name.startsWith("North") ? "North" : null; const v = prepack[m]; if (!v) return null; return k ? v[k] : (v.South ?? 0) + (v.North ?? 0); };
  const hasPP = Object.keys(prepack).length > 0;
  const hasArea = wh.Total.some((p) => p.spUsed != null || p.spCap != null);
  const hasSplit = wh.Total.some((p) => p.good != null);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-[13px]">
        <thead>
          <tr className="thead-hl text-[10.5px] font-semibold uppercase tracking-[0.08em]">
            <th className="pin left-0 w-[140px] min-w-[140px] px-4 py-2.5 text-left">Warehouse</th><th className="pin left-[140px] px-4 py-2.5 text-left shadow-[inset_-1px_0_0_var(--color-line)]">Details</th>
            {wh.months.map((m) => <th key={m} className="px-4 py-2.5 text-right">{new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</th>)}
          </tr>
        </thead>
        <tbody>
          {blocks.map(([name, pts, bg]) => (
            <Fragment key={name}>
              <tr className="border-t border-line">
                <td rowSpan={(hasArea ? 6 : hasPP ? 4 : 3) + (hasSplit ? 3 : 0)} className="pin left-0 w-[140px] min-w-[140px] px-4 py-2 align-middle text-[13px] font-semibold" style={{ background: bg }}>{name}</td>
                <td className={cn(PIN2, "text-ink-3")}>Capacity (lakh units)</td>
                {pts.map((p) => <td key={p.period} className="px-4 py-2 text-right tabular">{(p.capacity / 100000).toFixed(2)}</td>)}
              </tr>
              {hasSplit && ([["good", "Good stock"], ["bad", "Bad inventory"], ["other", "Blocked + not found + putaway pending"]] as const).map(([k, label]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className={cn(PIN2, k === "bad" ? "text-bad" : k === "other" ? "text-warn" : "text-ink-3")}>{label}</td>
                  {pts.map((p) => <td key={p.period} className={cn("px-4 py-2 text-right tabular", k === "good" ? "text-ink-2" : k === "bad" ? "text-bad" : "text-warn")}>{p[k] != null ? (p[k]! / 100000).toFixed(2) : <span className="text-ink-4">—</span>}</td>)}
                </tr>
              ))}
              <tr className="border-t border-line/60">
                <td className={cn(PIN2, "text-ink-3")}>{hasSplit ? "Space used (lakh units)" : "Inventory (lakh units)"}</td>
                {pts.map((p) => <td key={p.period} className="px-4 py-2 text-right font-semibold tabular">{p.inventory != null ? (p.inventory / 100000).toFixed(2) : <span className="font-normal text-ink-4">—</span>}</td>)}
              </tr>
              <tr className="border-t border-line/60 bg-subtle/50">
                <td className={cn(PIN2, "bg-subtle font-semibold")}>Utilisation %</td>
                {pts.map((p) => (
                  <td key={p.period} className="px-4 py-2 text-right">
                    {p.util != null ? <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular", p.util >= 0.9 ? "bg-bad-soft text-bad" : p.util >= 0.8 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink")}>{(p.util * 100).toFixed(2)}%</span> : <span className="text-ink-4">—</span>}
                  </td>
                ))}
              </tr>
              {hasArea && ([["spCap", "Pre-pack area capacity (lakh units)"], ["packs", "Pre-pack stock (packs)"], ["special", "Perfumes / shoes / bags / trolleys"], ["spUsed", "Pre-pack area used"]] as const).map(([k, label]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className={cn(PIN2, k === "spUsed" ? "font-medium text-ink-2" : "text-ink-3")}>{label}</td>
                  {pts.map((p) => <td key={p.period} className={cn("px-4 py-2 text-right tabular", k === "spUsed" ? "font-semibold" : "text-ink-3")}>{p[k] != null ? (p[k]! / 100000).toFixed(2) : <span className="font-normal text-ink-4">—</span>}</td>)}
                </tr>
              ))}
              {hasArea && (
                <tr className="border-t border-line/60 bg-subtle/50">
                  <td className={cn(PIN2, "bg-subtle font-semibold")}>Pre-pack area utilisation %</td>
                  {pts.map((p) => <td key={p.period} className="px-4 py-2 text-right">{p.spUtil != null ? <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular", p.spUtil >= 0.9 ? "bg-bad-soft text-bad" : p.spUtil >= 0.8 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink")}>{(p.spUtil * 100).toFixed(2)}%</span> : <span className="text-ink-4">—</span>}</td>)}
                </tr>
              )}
              {hasPP && !hasArea && (
                <tr className="border-t border-line/60">
                  <td className={cn(PIN2, "text-ink-3")}>Pre-pack stock (separate area, units)</td>
                  {pts.map((p) => { const v = pp(name, p.period); return <td key={p.period} className="px-4 py-2 text-right tabular text-ink-3">{v != null ? (v / 100000).toFixed(2) : "—"}</td>; })}
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyReviewView({ d, daily = [], canEditCapacity = false }: { d: Data; daily?: DailyView[]; canEditCapacity?: boolean }) {
  const flows: { key: "outbound" | "inbound"; title: string }[] = [
    { key: "outbound", title: "Outbound — channels & stores" },
    { key: "inbound", title: "Inbound — inward, pre-pack, returns & categories" },
  ];
  const days = d.through;
  const ids = ["sop:trend", "sop:wh", "sop:flow", "sop:returns", ...d.views.map((v) => `sop:${v.def.key}`)];
  const flagged = (items: Insight[]) => items.filter((i) => i.tone === "bad" || i.tone === "warn").length;
  const Flags = ({ items }: { items: Insight[] }) => {
    const n = flagged(items);
    return n ? <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">{n} to watch</span> : <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink">On plan</span>;
  };
  const whTotal = d.wh.Total.findLast((p) => p.util != null);
  return (
    <div className="space-y-6">
      <div className="flex justify-end -mt-2"><ExpandAll ids={ids} /></div>
      <OverallAccuracy rows={d.overall} label={d.multi ? d.label : `${mon(d.period)}${d.mtd ? ` · 1–${d.through}` : ""}`} />

      <section className="space-y-2">
        <h2 className="label-caps px-1">Overview</h2>
        <Collapsible id="sop:trend" title="Month on month" sub="Actual ÷ plan for every view, Apr → now"
          summary={<span className="text-ink-3">{d.trend[0]?.periods.length ?? 0} months</span>}>
          <TrendTable trend={d.trend} current={d.months} mtdLabel={d.mtd ? `1–${d.through}` : null} />
        </Collapsible>
      </section>

      <section className="space-y-2">
        <h2 className="label-caps px-1">Capacity</h2>
        <Collapsible id="sop:wh" icon={<Warehouse size={15} />} title="Warehouse utilisation" sub="South (BLR) · North (GGN) · space used = good + bad + blocked + not found + putaway pending, vs capacity, by month"
          summary={<>
            {whTotal && <span className="flex items-center gap-1.5 text-ink-3">Total <span className="font-semibold text-ink tabular">{pc(whTotal.util)}</span><span className="text-ink-4">· {mon(whTotal.period)}</span></span>}
            <Flags items={d.whInsights} />
          </>}>
          <WhCapacityBar settings={d.capSettings} canEdit={canEditCapacity} />
          <div className="space-y-4 p-4 md:p-5">
            <div className="grid gap-3 lg:grid-cols-3">
              <WhTile name="South (BLR)" pts={d.wh.South} tone="#2563eb" />
              <WhTile name="North (GGN)" pts={d.wh.North} tone="#ea580c" />
              <WhTile name="Total" pts={d.wh.Total} tone="var(--color-ink)" />
            </div>
            {d.whInsights.length > 0 && <InsightCards items={d.whInsights} />}
            <WhTable wh={d.wh} prepack={d.prepack} />
          </div>
        </Collapsible>
        <Collapsible id="sop:flow" icon={<ArrowDownToLine size={15} />} title="Inventory flow" sub="Opening → inward (category + returns) → outward → closing, by warehouse"
          summary={<>
            {d.flowNow.map((f) => <span key={f.warehouse} className="text-ink-3">{f.warehouse} close <b className={cn("font-semibold tabular", f.utilClose >= 1 ? "text-bad" : f.utilClose >= 0.9 ? "text-warn" : "text-ink")}>{pc(f.utilClose)}</b></span>)}
            <Flags items={d.flowInsights} />
          </>}>
          <div className="space-y-4 p-4 md:p-5">
            {d.flowInsights.length > 0 && <InsightCards items={d.flowInsights} />}
            <FlowTable rows={d.flow} current={d.period} />
          </div>
        </Collapsible>
        <Collapsible id="sop:returns" title="Returns" sub="Units returned into each warehouse, and as a share of forward volume"
          summary={<Flags items={d.returnsInsights.filter((i) => i.tone !== "info")} />}>
          <div className="space-y-4 p-4 md:p-5">
            {d.returnsInsights.length > 0 && <InsightCards items={d.returnsInsights} />}
            <ReturnsTable rows={d.returns} />
          </div>
        </Collapsible>
      </section>

      {flows.map((f) => (
        <section key={f.key} className="space-y-2">
          <h2 className="label-caps flex items-center gap-1.5 px-1">{f.key === "outbound" ? <ArrowUpFromLine size={12} /> : <ArrowDownToLine size={12} />}{f.title}</h2>
          {d.views.filter((v) => v.def.flow === f.key).map((v) => {
            const t = v.rows.find((r) => r.kind === "total")!;
            return (
              <Collapsible key={v.def.key} id={`sop:${v.def.key}`} title={v.def.title} sub={d.multi ? `${v.def.sub.replace(/ by week$/, "")} · ${d.label}` : `${v.def.sub} · 1–${days} ${mon(d.period)}`}
                summary={<>
                  <span className="hidden text-ink-3 sm:inline">Plan <b className="font-semibold text-ink tabular">{fmt(t.tp)}</b></span>
                  <span className="hidden text-ink-3 sm:inline">Actual <b className="font-semibold text-ink tabular">{fmt(t.ta)}</b></span>
                  {t.ta === 0 && t.tp > 0 ? <span className="text-[12px] text-ink-4">awaiting actuals</span> : <><UtilChip u={t.tu} plan={t.tp} actual={t.ta} /><Flags items={v.insights} /></>}
                </>}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-4 py-2.5 text-[12px] md:px-5">
                  <span className="text-ink-3">Plan <b className="font-semibold text-ink tabular">{fmt(t.tp)}</b></span>
                  <span className="text-ink-3">Actual <b className="font-semibold text-ink tabular">{fmt(t.ta)}</b></span>
                  <span className="flex items-center gap-1.5 text-ink-3">South <UtilChip u={t.su} plan={t.sp} actual={t.sa} /></span>
                  <span className="flex items-center gap-1.5 text-ink-3">North <UtilChip u={t.nu} plan={t.np} actual={t.na} /></span>
                </div>
                {/* table on the left, the function's own insight tile on the right (stacks on smaller screens) */}
                <div className="grid gap-4 p-3 md:p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0 overflow-hidden rounded-xl border border-line">
                    {d.multi ? <ViewTable rows={v.rows} label={v.def.rowLabel} />
                      : <ExpandTable rows={v.rows} label={v.def.rowLabel} viewKey={v.def.key} weekly={!!v.def.weekly} split={d.daySplit[v.def.key] ?? null} period={d.period} />}
                  </div>
                  <FunctionTile viewKey={v.def.key} total={t} rows={v.rows} insights={v.insights} daily={daily} notes={d.notes} owners={d.owners} period={d.multi ? null : d.period} />
                </div>
              </Collapsible>
            );
          })}
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className="font-semibold text-ink-2">Utilisation key:</span>
        <UtilChip u={1} plan={1} actual={1} /> within ±20% <UtilChip u={0.7} plan={1} actual={1} /> 50–80% <UtilChip u={0.4} plan={1} actual={1} /> below 50% <UtilChip u={1.3} plan={1} actual={1} /> 120–150% <UtilChip u={1.6} plan={1} actual={1} /> 150%+ · Totals are calculated from the South + North figures.
      </div>
    </div>
  );
}

const monL = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });

function TrendTable({ trend, current, mtdLabel }: { trend: { def: { key: string; title: string }; periods: string[]; cells: ({ period: string; plan: number; actual: number; util: number | null } | null)[] }[]; current: string[]; mtdLabel: string | null }) {
  const last = current.at(-1);
  const periods = trend[0]?.periods ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[640px]">
        <thead><tr><th>View</th>{periods.map((p) => <th key={p} className={cn("text-right", current.includes(p) && "!text-ink")}>{monL(p)}{p === last && mtdLabel ? ` · ${mtdLabel}` : ""}</th>)}</tr></thead>
        <tbody>{trend.map((r) => (
          <tr key={r.def.key}>
            <td className="font-medium">{r.def.title}</td>
            {r.cells.map((c, i) => (
              <td key={i} className={cn("text-right", current.includes(periods[i]) && "bg-subtle/60")} title={c ? `Plan ${fmt(c.plan)} · Actual ${fmt(c.actual)}` : undefined}>
                {c ? <UtilChip u={c.util} plan={c.plan} actual={c.actual} /> : <span className="text-ink-4">—</span>}
              </td>
            ))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FlowTable({ rows, current }: { rows: FlowCalc[]; current: string }) {
  const periods = [...new Set(rows.map((r) => r.period))].sort().reverse();
  const cell = (v: number) => <td className="text-right tabular">{lakh(v)}</td>;
  return (
    <div className="card overflow-x-auto">
      <table className="table-base min-w-[900px]">
        <thead><tr><th>Month</th><th>WH</th><th className="text-right">Capacity</th><th className="text-right">Opening</th><th className="text-right">Util (open)</th><th className="text-right">Inward · category</th><th className="text-right">Inward · returns</th><th className="text-right">Outward</th><th className="text-right">Closing</th><th className="text-right">Util (close)</th><th className="text-right">Change</th></tr></thead>
        <tbody>{periods.flatMap((p) => rows.filter((r) => r.period === p).map((r, i) => (
          <tr key={`${p}${r.warehouse}`} className={cn(p === current && "bg-subtle/50")}>
            <td className="font-medium">{i === 0 ? monL(p) : ""}</td>
            <td>{r.warehouse}</td>
            {cell(r.capacity)}{cell(r.opening)}
            <td className="text-right tabular text-ink-3">{pc(r.utilOpen)}</td>
            {cell(r.inward_category)}{cell(r.inward_returns)}{cell(r.outward)}{cell(r.closing)}
            <td className={cn("text-right font-semibold tabular", r.utilClose >= 1 ? "text-bad" : r.utilClose >= 0.9 ? "text-warn" : "text-ink")}>{pc(r.utilClose)}</td>
            <td className={cn("text-right tabular", r.build > 0 ? "text-warn" : "text-ok")}>{r.build >= 0 ? "+" : "−"}{lakh(Math.abs(r.build))}</td>
          </tr>
        )))}</tbody>
      </table>
    </div>
  );
}

function ReturnsTable({ rows }: { rows: ReturnsRow[] }) {
  const periods = [...new Set(rows.map((r) => r.period))].sort().reverse();
  const at = (p: string, w: "South" | "North") => rows.find((r) => r.period === p && r.warehouse === w);
  const rate = (v: number | null) => <span className={cn("tabular", v == null ? "text-ink-4" : v >= 0.35 ? "font-semibold text-bad" : v >= 0.25 ? "text-warn" : "text-ink-2")}>{pc(v)}</span>;
  return (
    <div className="card overflow-x-auto">
      <table className="table-base min-w-[820px]">
        <thead>
          <tr><th rowSpan={2}>Month</th><th colSpan={4} className="text-center">South</th><th colSpan={4} className="text-center">North</th></tr>
          <tr>{["South", "North"].flatMap((w) => [<th key={`${w}1`} className="text-right">B2C</th>, <th key={`${w}2`} className="text-right">B2C rate</th>, <th key={`${w}3`} className="text-right">Store / B2B</th>, <th key={`${w}4`} className="text-right">Store rate</th>])}</tr>
        </thead>
        <tbody>{periods.map((p) => (
          <tr key={p}>
            <td className="font-medium">{monL(p)}</td>
            {(["South", "North"] as const).flatMap((w) => { const r = at(p, w); return [
              <td key={`${w}a`} className="text-right tabular">{r?.b2c != null ? lakh(r.b2c) : "—"}</td>,
              <td key={`${w}b`} className="text-right">{rate(returnRate(r?.b2c ?? null, r?.fwd_b2c ?? null))}</td>,
              <td key={`${w}c`} className="text-right tabular">{r?.b2b != null ? lakh(r.b2b) : "—"}</td>,
              <td key={`${w}d`} className="text-right">{rate(returnRate(r?.b2b ?? null, r?.fwd_retail ?? null))}</td>,
            ]; })}
          </tr>
        ))}</tbody>
      </table>
      <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Rate = returns ÷ forward volume of the same month (B2C forward; retail forward for store returns). Months without a forward split show volumes only.</p>
    </div>
  );
}

/** Overall plan vs actual by flow: plan, actual, deviation and forecast accuracy (Total / South / North). */
function OverallAccuracy({ rows, label }: { rows: OverallRow[]; label: string }) {
  if (!rows.length) return null;
  const accCell = (a: number | null, strong?: boolean) => {
    if (a == null) return <span className="text-ink-4">—</span>;
    const tone = a >= 0.9 ? "bg-ok" : a >= 0.75 ? "bg-warn" : "bg-bad";
    return (
      <span className="flex items-center justify-end gap-2">
        {strong && <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.round(a * 100)}%` }} /></span>}
        <span className={cn("tabular", strong ? "font-semibold" : "", a >= 0.9 ? "text-ok" : a >= 0.75 ? "text-warn" : "text-bad")}>{pc(a)}</span>
      </span>
    );
  };
  const groups = ["Inwards", "Outwards", "Returns"] as const;
  return (
    <section className="space-y-2">
      <h2 className="label-caps px-1">Overall accuracy · {label}</h2>
      <div className="card overflow-x-auto">
        <table className="table-base min-w-[860px]">
          <thead><tr>
            <th>Flow</th><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">Deviation</th><th className="text-right">Deviation %</th>
            <th className="text-right">Accuracy</th><th className="text-right">South acc.</th><th className="text-right">North acc.</th>
          </tr></thead>
          {groups.map((g) => {
            const rs = rows.filter((r) => r.flow === g);
            if (!rs.length) return null;
            return (
              <tbody key={g}>
                <tr><td colSpan={8} className="!h-8 bg-subtle/60 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">{g}</td></tr>
                {rs.map((r) => (
                  <tr key={r.key} className={cn(r.kind === "subtotal" && "bg-subtle/40 font-semibold")}>
                    <td className={cn(r.kind ? "font-semibold" : "pl-5")}>{r.label}</td>
                    <td className="text-right tabular">{fmt(r.tp)}</td>
                    {r.ta === 0 && r.tp > 0 ? (
                      // Sep onwards comes from Snowflake: no feed yet is not a −100% miss
                      <td colSpan={6} className="text-right text-[12px] text-ink-4">Awaiting Snowflake actuals{r.key === "liquidation" ? " — Malhar uploads gatepass actuals (Inputs)" : ""}</td>
                    ) : (<>
                    <td className="text-right tabular">{fmt(r.ta)}</td>
                    <td className={cn("text-right tabular", r.dev < 0 ? "text-bad" : r.dev > 0 ? "text-warn" : "text-ink-3")}>{r.dev > 0 ? "+" : r.dev < 0 ? "−" : ""}{fmt(Math.abs(r.dev))}</td>
                    <td className={cn("text-right tabular", r.devPct == null ? "text-ink-4" : Math.abs(r.devPct) > 0.2 ? "font-semibold text-bad" : "text-ink-2")}>{r.devPct == null ? "—" : `${r.devPct > 0 ? "+" : ""}${Math.round(r.devPct * 100)}%`}</td>
                    <td className="text-right">{accCell(r.acc, true)}</td>
                    <td className="text-right">{accCell(r.sAcc)}</td>
                    <td className="text-right">{accCell(r.nAcc)}</td>
                    </>)}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Accuracy = 1 − |actual − plan| ÷ plan. Deviation + means more than planned, − means less. Detailed views follow below.</p>
      </div>
    </section>
  );
}
