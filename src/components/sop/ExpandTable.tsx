"use client";
import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { weekOfMonth } from "@/lib/sopWeeks";
import type { Row } from "./reviewMath";
import { UtilChip } from "./UtilChip";

export interface SplitDay { day: string; week: string; future: boolean; sp: number; sa: number; np: number; na: number }
export interface Split { through: number; basis: string; perLabel: Record<string, SplitDay[]> }

const BAND = 0.2;
const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const INWARD = new Set(["category_inward", "prepack", "category_view"]);
const u = (a: number, p: number) => (p > 0 ? a / p : null);

/** Days beyond ±20% among days that had a plan (and have happened). */
function beyond(days: SplitDay[]) {
  let up = 0, down = 0, judged = 0;
  for (const d of days) {
    const p = d.sp + d.np, a = d.sa + d.na;
    if (d.future || p <= 0) continue;
    judged++;
    const r = a / p - 1;
    if (r > BAND) up++; else if (r < -BAND) down++;
  }
  return { up, down, judged };
}
const sum = (days: SplitDay[]) => days.reduce((a, d) => ({ sp: a.sp + d.sp, sa: a.sa + d.sa, np: a.np + d.np, na: a.na + d.na }), { sp: 0, sa: 0, np: 0, na: 0 });
const addDays = (lists: SplitDay[][]) => {
  const m = new Map<string, SplitDay>();
  for (const l of lists) for (const d of l) { const c = m.get(d.day) ?? { ...d, sp: 0, sa: 0, np: 0, na: 0 }; c.sp += d.sp; c.sa += d.sa; c.np += d.np; c.na += d.na; m.set(d.day, c); }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
};

/**
 * Plan vs actual table where every row opens up: a channel / category row → its weeks → their days, a week row → its days.
 * The right-hand column counts the days beyond ±20% (above / below of the planned days) and opens the Detailed view filtered to them.
 */
export function ExpandTable({ rows, label, viewKey, weekly, split, period }: { rows: Row[]; label: string; viewKey: string; weekly: boolean; split?: Split | null; period: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = split ? Object.values(split.perLabel) : [];
  // the days behind a table row
  const daysOf = (r: Row): SplitDay[] => {
    if (!split) return [];
    if (r.kind === "total") return addDays(all);
    if (weekly) return (split.perLabel[""] ?? []).filter((d) => d.week === r.label.replace(/\s/g, "_"));
    if (r.kind === "subtotal") return addDays(rows.filter((x) => !x.kind && x.group && r.label.startsWith(x.group)).map((x) => split.perLabel[x.label] ?? []));
    return split.perLabel[r.label] ?? [];
  };
  const href = (r: Row | null, dev?: "above" | "below") => {
    const p = new URLSearchParams({ flow: INWARD.has(viewKey) ? "inward" : "outbound", f: viewKey, p: period });
    if (r && !r.kind && !weekly) p.set("l", r.label);
    if (dev) p.set("dev", dev);
    return `/sop/detailed?${p}`;
  };
  const Cells = ({ x, strong }: { x: { sp: number; sa: number; np: number; na: number }; strong?: boolean }) => {
    const tp = x.sp + x.np, ta = x.sa + x.na, gap = ta - tp;
    return (<>
      <td className="px-3 text-right tabular">{fmt(tp)}</td>
      <td className={cn("px-3 text-right tabular", strong && "font-semibold")}>{fmt(ta)}</td>
      <td className={cn("px-3 text-right tabular", strong && "font-semibold", gap > 0 ? "text-bad" : gap < 0 ? "text-warn" : "text-ink-4")}>{gap === 0 ? "—" : `${gap > 0 ? "+" : "−"}${fmt(Math.abs(gap))}`}</td>
      <td className="px-3 text-right"><UtilChip u={u(ta, tp)} plan={tp} actual={ta} /></td>
      <td className="px-3 text-right tabular text-ink-2">{fmt(x.sp)}</td>
      <td className="px-3 text-right tabular">{fmt(x.sa)}</td>
      <td className="px-3 text-right"><UtilChip u={u(x.sa, x.sp)} plan={x.sp} actual={x.sa} /></td>
      <td className="px-3 text-right tabular text-ink-2">{fmt(x.np)}</td>
      <td className="px-3 text-right tabular">{fmt(x.na)}</td>
      <td className="px-3 text-right"><UtilChip u={u(x.na, x.np)} plan={x.np} actual={x.na} /></td>
    </>);
  };
  const Beyond = ({ days, r }: { days: SplitDay[]; r: Row | null }) => {
    if (!split) return <td className="px-3 text-right text-[11px] text-ink-4">—</td>;
    const b = beyond(days);
    if (!b.judged) return <td className="px-3 text-right text-[11px] text-ink-4">—</td>;
    const off = b.up + b.down;
    return (
      <td className="whitespace-nowrap px-3 text-right text-[12px]">
        <span className={cn("mr-1.5 font-semibold tabular", off / b.judged >= 0.4 ? "text-bad" : off ? "text-ink" : "text-ok")}>{off}/{b.judged}</span>
        {b.up > 0 && <Link href={href(r, "above")} className="mr-1 rounded bg-[#e8f0fe] px-1 py-0.5 tabular text-[#1d4ed8] hover:underline" title="Days above +20% — open in Detailed">{b.up}↑</Link>}
        {b.down > 0 && <Link href={href(r, "below")} className="rounded bg-bad-soft px-1 py-0.5 tabular text-bad hover:underline" title="Days below −20% — open in Detailed">{b.down}↓</Link>}
      </td>
    );
  };
  const DayRows = ({ days, depth }: { days: SplitDay[]; depth: number }) => (<>{days.map((d) => {
    const p = d.sp + d.np, a = d.sa + d.na, dev = p > 0 && !d.future ? a / p - 1 : null;
    return (
      <tr key={d.day} className={cn("border-b border-line/40 text-[12px]", d.future ? "text-ink-4" : "bg-subtle/25")}>
        <td className="py-1.5 pr-3 text-ink-3" style={{ paddingLeft: 12 + depth * 18 }}>
          {Number(d.day.slice(8))} {new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", month: "short", timeZone: "UTC" })}
        </td>
        {d.future ? <td colSpan={10} className="px-3 text-right text-[11px]">plan {fmt(p)}</td> : <Cells x={d} />}
        <td className="px-3 text-right text-[11.5px] tabular">{dev == null ? <span className="text-ink-4">—</span> : <span className={cn("font-semibold", dev > BAND ? "text-[#1d4ed8]" : dev < -BAND ? "text-bad" : "text-ok")}>{dev > 0 ? "+" : ""}{Math.round(dev * 100)}%</span>}</td>
      </tr>
    );
  })}</>);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1060px] border-collapse text-[13px]">
        <thead>
          <tr className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
            <th rowSpan={2} className="thead-hl rounded-tl-xl px-3 py-2 text-left">{label}</th>
            <th colSpan={4} className="border-l-2 border-white px-3 py-1.5 text-center text-white" style={{ background: "var(--color-hero)" }}>Total</th>
            <th colSpan={3} className="border-l-2 border-white bg-[#e8f0fe] px-3 py-1.5 text-center text-[#1e40af]">South</th>
            <th colSpan={3} className="border-l-2 border-white bg-[#fdf2e3] px-3 py-1.5 text-center text-[#9a3412]">North</th>
            <th rowSpan={2} className="thead-hl rounded-tr-xl border-l-2 border-white px-3 py-2 text-right" title="Days beyond ±20% of the day plan (above ↑ / below ↓) of the planned days">Days ±20%</th>
          </tr>
          <tr className="thead-hl text-[10.5px] font-semibold uppercase tracking-[0.06em]">
            {["Plan", "Actual", "Variance", "Util %", "Plan", "Actual", "Util %", "Plan", "Actual", "Util %"].map((h, i) => (
              <th key={i} className={cn("px-3 py-2 text-right", (i === 0 || i === 4 || i === 7) && "border-l-2 border-white")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const days = daysOf(r);
            const can = days.some((d) => !d.future);
            const k = r.label;
            const isOpen = open.has(k);
            const weeks = !weekly ? [...new Set(days.map((d) => d.week || weekOfMonth(d.day)))] : [];
            return (
              <Fragment key={k}>
                <tr className={cn("border-b border-line/70", r.kind === "total" ? "bg-subtle font-semibold" : r.kind === "subtotal" ? "bg-subtle/60 font-semibold" : "hover:bg-subtle/40")}>
                  <td className="px-3 py-2.5 font-semibold text-ink">
                    {can ? <button type="button" onClick={() => toggle(k)} className="flex items-center gap-1 text-left hover:text-info">
                      <ChevronRight size={13} className={cn("shrink-0 text-ink-4 transition-transform", isOpen && "rotate-90")} />{r.label}</button> : <span className="pl-[17px]">{r.label}</span>}
                  </td>
                  <Cells x={r} strong />
                  <Beyond days={days} r={r.kind === "total" ? null : r} />
                </tr>
                {isOpen && (weekly
                  ? <DayRows days={days} depth={1} />
                  : weeks.map((w) => {
                    const wd = days.filter((d) => (d.week || weekOfMonth(d.day)) === w);
                    const wk = `${k}|${w}`;
                    const wOpen = open.has(wk);
                    return (
                      <Fragment key={wk}>
                        <tr className="border-b border-line/50 bg-subtle/40 text-[12.5px]">
                          <td className="py-2 pr-3" style={{ paddingLeft: 30 }}>
                            <button type="button" onClick={() => toggle(wk)} className="flex items-center gap-1 font-medium text-ink-2 hover:text-info">
                              <ChevronRight size={12} className={cn("shrink-0 text-ink-4 transition-transform", wOpen && "rotate-90")} />{w.replace("_", " ")}</button>
                          </td>
                          <Cells x={sum(wd.filter((d) => !d.future))} />
                          <Beyond days={wd} r={r.kind === "total" ? null : r} />
                        </tr>
                        {wOpen && <DayRows days={wd} depth={2} />}
                      </Fragment>
                    );
                  }))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {split && <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Open a row for its weeks and days · days ±20%: planned days whose actual was more than 20% above (↑) or below (↓) the day plan · day plan: {split.basis === "daily" ? "day-wise inputs / projection sheet" : split.basis}.</p>}
    </div>
  );
}
