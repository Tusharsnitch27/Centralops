"use client";
import { useMemo, useState } from "react";
import { BASE_LEVERS, type Levers, type StreamBlock } from "@/server/aop/processingTypes";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { model } from "./levers";

const PCT_LEVERS: { k: Exclude<keyof Levers, "headcountDelta">; label: string; hint: string }[] = [
  { k: "volume", label: "Projected volume", hint: "S&OP projection" },
  { k: "productivity", label: "Productivity", hint: "units / head / day" },
  { k: "adherence", label: "S&OP adherence", hint: "actual ÷ projection" },
  { k: "salary", label: "Salary", hint: "₹ / head / month" },
];
const cpi = (v: number | null) => (v == null ? "—" : `₹${v.toFixed(2)}`);
const n = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);

/** What-if on warehouse processing cost. Nothing is saved. */
export function LeverPanel({ streams, label }: { streams: StreamBlock[]; label: string }) {
  const [l, setL] = useState<Levers>(BASE_LEVERS);
  const base = useMemo(() => model(streams, BASE_LEVERS), [streams]);
  const scen = useMemo(() => model(streams, l), [streams, l]);
  const rows = [...base.rows.map((b, i) => ({ b, s: scen.rows[i]! })), { b: base.total, s: scen.total }];

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 md:grid-cols-5">
        {PCT_LEVERS.map(({ k, label: lb, hint }) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-[12px]"><span className="font-medium">{lb}</span><span className={cn("tabular", l[k] === 1 ? "text-ink-4" : "text-info")}>{l[k] >= 1 ? "+" : "−"}{Math.abs(Math.round((l[k] - 1) * 100))}%</span></span>
            <input type="range" min={-30} max={30} step={1} value={Math.round((l[k] - 1) * 100)} onChange={(e) => setL({ ...l, [k]: 1 + Number(e.target.value) / 100 })} aria-label={lb} />
            <span className="text-[10.5px] text-ink-4">{hint}</span>
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium">Headcount ±</span>
          <input type="number" className="field h-8 tabular" value={l.headcountDelta} onChange={(e) => setL({ ...l, headcountDelta: Number(e.target.value) || 0 })} />
          <span className="text-[10.5px] text-ink-4">heads added to the total</span>
        </label>
      </div>
      <div className="flex items-center justify-between px-4 py-2 text-[11.5px] text-ink-4">
        <span>{label} · baseline = current norms (MP = ⌈projection ÷ output/head⌉), scenario = levers applied</span>
        <button type="button" className="rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink" onClick={() => setL(BASE_LEVERS)}>Reset</button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base min-w-[900px]">
          <thead><tr><th>Stream</th><th className="text-right">Projection</th><th className="text-right">MP base → scen</th><th className="text-right">Expense base</th><th className="text-right">Expense scen</th><th className="text-right">Δ ₹</th><th className="text-right">Actual CPI base</th><th className="text-right">Actual CPI scen</th><th className="text-right">Δ CPI</th></tr></thead>
          <tbody>{rows.map(({ b, s }) => {
            const d = s.exp - b.exp, dc = s.actualCpi != null && b.actualCpi != null ? s.actualCpi - b.actualCpi : null;
            return (
              <tr key={b.stream} className={b.stream === "Total" ? "bg-subtle/70 font-semibold" : undefined}>
                <td className={b.stream === "Total" ? "" : "font-medium"}>{b.stream}</td>
                <td className="text-right tabular text-ink-3">{n(s.proj)}</td>
                <td className="text-right tabular">{n(b.mp)} → {n(s.mp)}</td>
                <td className="text-right tabular text-ink-3">{inr(b.exp)}</td>
                <td className="text-right tabular">{inr(s.exp)}</td>
                <td className={cn("text-right tabular", Math.abs(d) < 1 ? "text-ink-3" : d > 0 ? "text-bad" : "text-ok")}>{inr(d, { sign: true })}</td>
                <td className="text-right tabular text-ink-3">{cpi(b.actualCpi)}</td>
                <td className="text-right tabular">{cpi(s.actualCpi)}</td>
                <td className={cn("text-right tabular", dc == null || Math.abs(dc) < 0.005 ? "text-ink-3" : dc > 0 ? "text-bad" : "text-ok")}>{dc == null ? "—" : `${dc > 0 ? "+" : dc < 0 ? "−" : ""}₹${Math.abs(dc).toFixed(2)}`}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
