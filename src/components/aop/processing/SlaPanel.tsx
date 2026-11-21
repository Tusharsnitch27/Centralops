"use client";
import { useMemo, useState } from "react";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { BASE_SLA, fit, simulate, type SlaLevers, type SlaModel } from "./slaSim";

const n0 = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
const n1 = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const LEVERS: { k: "b2cHeads" | "b2bHeads" | "night"; label: string; hint: string; min: number; max: number }[] = [
  { k: "b2cHeads", label: "B2C Forward heads", hint: "present DE, both shifts", min: -60, max: 30 },
  { k: "b2bHeads", label: "B2B Forward heads", hint: "present DE, both shifts", min: -60, max: 30 },
  { k: "night", label: "Day ↔ night", hint: "+ moves day DE to night, − night to day", min: -100, max: 100 },
];

/**
 * SLA headroom under the levers: the judged SLA cells replayed against present DE per shift (slaSim.ts). Shows an SLA read only
 * when the replay reproduces history; otherwise "no reliable SLA read" and the capacity check alone, never "the cut is safe".
 */
export function SlaPanel({ model, volume, productivity }: { model: SlaModel; volume: number; productivity: number }) {
  const [s, setS] = useState<SlaLevers>(BASE_SLA);
  const hist = useMemo(() => simulate(model, BASE_SLA), [model]);
  const scen = useMemo(() => simulate(model, { ...s, volume, productivity }), [model, s, volume, productivity]);
  const neutral = s.b2cHeads === 0 && s.b2bHeads === 0 && s.night === 0 && volume === 1 && productivity === 1;

  // ₹ per month for the heads levers: Δ present DE (avg per day) × the site's monthly salary (salary master)
  const deDays = new Set(model.de.map((r) => r.day)).size || 1;
  const cost = (["South", "North"] as const).flatMap((site) => (["B2C Forward", "B2B Forward"] as const).map((func) => {
    const de = model.de.filter((r) => r.func === func && (site === "North" ? r.wh === "NORTH" : r.wh !== "NORTH")).reduce((a, r) => a + r.de, 0) / deDays;
    const d = de * (func === "B2C Forward" ? s.b2cHeads : s.b2bHeads), sal = model.salary[site];
    return { site, func, de, d, inr: sal ? d * sal.monthly : null, isDefault: sal?.isDefault ?? true };
  }));
  const dInr = cost.reduce((a, c) => a + (c.inr ?? 0), 0), dDe = cost.reduce((a, c) => a + c.d, 0);

  return (
    <div className="border-t border-line">
      <div className="px-4 pt-3 text-[13px] font-semibold">SLA headroom · do B2C and B2B SLAs still hold?</div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
        {LEVERS.map(({ k, label, hint, min, max }) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-[12px]"><span className="font-medium">{label}</span><span className={cn("tabular", s[k] === 0 ? "text-ink-4" : "text-info")}>{s[k] >= 0 ? "+" : "−"}{Math.abs(Math.round(s[k] * 100))}%</span></span>
            <input type="range" min={min} max={max} step={5} value={Math.round(s[k] * 100)} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) / 100 })} aria-label={label} />
            <span className="text-[10.5px] text-ink-4">{hint}</span>
          </label>
        ))}
        <div className="flex flex-col justify-center text-[12px]">
          <span className="text-ink-4">Heads levers · per month</span>
          <span className={cn("text-[18px] font-semibold tabular", dInr < 0 ? "text-ok" : dInr > 0 ? "text-bad" : "")}>{dDe === 0 ? "—" : `${dDe > 0 ? "+" : "−"}${n1(Math.abs(dDe))} DE/day · ${inr(dInr, { sign: true })}`}</span>
          <span className="text-[10.5px] text-ink-4">Δ present DE × salary master{cost.some((c) => c.d !== 0 && c.isDefault) ? " (default ₹21,983 rate — enter real rates on AOP › Cost per day)" : ""}; volume and productivity come from the levers above</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base min-w-[1040px]">
          <thead><tr><th>Lane</th><th className="text-right">Present DE/day</th><th className="text-right">Judged units</th><th className="text-right">Actual late</th><th className="text-right">Replay late (as staffed)</th><th>SLA read</th>
            <th className="text-right">Load ÷ capacity · peak week, history → scen</th><th className="text-right">Scenario: days capacity short</th><th>Scenario read</th></tr></thead>
          <tbody>{hist.map((h) => {
            const f = fit(h), x = scen.find((y) => y.id === h.id);
            const de = model.de.filter((r) => r.func === h.func && h.whs.includes(r.wh)).reduce((a, r) => a + r.de, 0) / deDays;
            const short = x ? x.days.filter((d) => d.pred > 0.5).length : 0;
            const untested = x?.peakUtil != null && h.peakUtil != null && x.peakUtil > h.peakUtil + 1e-9;
            const read = neutral ? "—" : f.reliable && !untested && x ? `${pc(1 - x.pred / (x.units || 1))} predicted SLA`
              : untested ? "Untested — history never ran this lean" : "No reliable SLA read";
            return (
              <tr key={h.id}>
                <td className="font-medium">{h.label}{h.missing && <div className="text-[11px] font-normal text-ink-4">{h.missing}</div>}{h.noDe ? <div className="text-[11px] font-normal text-ink-4">{h.noDe} days without attendance left out</div> : null}</td>
                <td className="text-right tabular text-ink-3">{h.id.startsWith("B2B Marketplace") ? `${n0(model.mpUnitsPerDay)} units/day` : n1(de)}</td>
                <td className="text-right tabular">{n0(h.units)}</td>
                <td className="text-right tabular">{n0(h.actual)} <span className="text-ink-4">({pc(h.units ? h.actual / h.units : null)})</span></td>
                <td className="text-right tabular">{n0(h.pred)}</td>
                <td className={cn(f.reliable ? "text-ok" : "text-warn")}><span className="font-medium">{f.reliable ? "Fits history" : "Weak fit"}</span><div className="text-[11px] text-ink-4">{f.reason} · n {f.n}</div></td>
                <td className="text-right tabular">{pc(h.peakUtil)} → <span className={cn(untested && "text-warn")}>{pc(x?.peakUtil ?? null)}</span></td>
                <td className={cn("text-right tabular", short ? "text-bad" : "text-ink-3")}>{x ? `${short} of ${x.days.length}` : "—"}</td>
                <td className={cn(read.startsWith("No") || read.startsWith("Untested") ? "text-warn" : undefined)}>{read}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">
        Replay of every judged SLA cell from {model.from} to {model.to} (S&amp;OP › Service levels data), hour by hour, earliest deadline first, against present DE per shift
        (Day 09–18; Night 21–05 South, 21–06 North) × today&apos;s site IPP. Work not covered before a cut-off rolls past it.
        “Actual late” = breached + overdue as computed upstream; “Replay late” = what capacity alone explains. The SLA read appears only if the replay reproduces history (≥ 14 days, daily ρ ≥ 0.6, total within ±25 %);
        otherwise the capacity columns are a check, not an SLA forecast — breaches in this window weren&apos;t driven by heads. Load ÷ capacity is per 7-day block (POs are due on one day but worked over several); a scenario that loads capacity beyond the history peak week is untested.
        B2C runs per building (WH1, WH2, North); B2B per site with B2B Forward heads pooled; B2B Marketplace at {n0(model.mpUnitsPerDay)} units/day per warehouse, scaled with B2B heads
        (ponytail: the B2B pool isn&apos;t split between Retail and Marketplace — both lanes see the full heads change).
        {model.unfed.length ? ` Not in the work per unit (no output feed): ${model.unfed.map((u) => `${u.site} ${u.stream} ${u.stage} ${u.ipp}`).join(", ")}.` : ""}
      </p>
    </div>
  );
}
