"use client";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { weekOfMonth } from "@/lib/sopWeeks";
import type { MpDay, MpLine } from "@/server/manpower/model";

const BAND = 0.2;
const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(v));
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const achTone = (v: number | null) => (v == null ? "text-ink-4" : v < 1 - BAND ? "text-warn font-semibold" : v > 1 + BAND ? "text-bad font-semibold" : "text-ok");
const coverTone = (v: number | null) => (v == null ? "text-ink-4" : v < 0.95 ? "text-bad font-semibold" : "text-ink-2");
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });

/**
 * Per warehouse: department → heads on the floor → actual capacity (heads × standard) vs what capacity planning needed →
 * output from S&OP actuals → achieved %. A row opens into its days; the right column counts days outside ±20%.
 */
export function ProductivityTable({ wh, lines }: { wh: string; lines: MpLine[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const tot = lines.reduce((a, l) => ({ heads: a.heads + (l.headsAvg ?? 0), cap: a.cap + (l.capDay ?? 0), req: a.req + (l.capDay != null ? l.required ?? 0 : 0), out: a.out + (l.outDay ?? 0), capJ: a.capJ + (l.ach != null && l.capDay ? l.capDay : 0), outJ: a.outJ + (l.ach != null && l.outDay ? l.outDay : 0) }),
    { heads: 0, cap: 0, req: 0, out: 0, capJ: 0, outJ: 0 });
  return (
    <div className="card overflow-x-auto">
      <table className="table-base min-w-[980px]">
        <thead>
          <tr>
            <th>{wh} · function</th>
            <th className="text-right">Heads / day</th>
            <th className="text-right" title="Standard units per head per day (Standards tab)">Std / head</th>
            <th className="text-right">Actual capacity / day</th>
            <th className="text-right" title="Required per day in Capacity planning">Plan required</th>
            <th className="text-right" title="Actual capacity ÷ plan required">Cover</th>
            <th className="text-right">Output / day</th>
            <th className="text-right" title="Output ÷ actual capacity, on days with both">Achieved</th>
            <th className="text-right">Units / head</th>
            <th className="text-right" title="Days below 80% / above 120% achieved">Days &lt;80% · &gt;120%</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const k = `${l.warehouse}|${l.department}`, isOpen = open.has(k);
            return (
              <Fragment key={k}>
                <tr className="cursor-pointer hover:bg-subtle/60" onClick={() => toggle(k)}>
                  <td>
                    <div className="flex items-center gap-1.5 font-medium"><ChevronRight size={13} className={cn("shrink-0 text-ink-4 transition", isOpen && "rotate-90")} />{l.department}</div>
                    <div className="pl-5 text-[11px] text-ink-4">{l.source ?? "no output feed — heads & capacity only"}{l.covers.length > 1 && <> · plan = {l.covers.join(" + ")}</>}</div>
                  </td>
                  <td className="text-right tabular">{n(l.headsAvg)}</td>
                  <td className={cn("text-right tabular", l.rateNow == null && l.department !== "Ops & Logistics" && "text-warn")}>{l.department === "Ops & Logistics" ? "—" : l.rateNow == null ? "set" : n(l.rateNow)}</td>
                  <td className="text-right tabular font-medium">{n(l.capDay)}</td>
                  <td className="text-right tabular text-ink-3">{n(l.required)}</td>
                  <td className={cn("text-right tabular", coverTone(l.cover))}>{pc(l.cover)}</td>
                  <td className="text-right tabular">{n(l.outDay)}</td>
                  <td className={cn("text-right tabular", achTone(l.ach))}>{pc(l.ach)}</td>
                  <td className="text-right tabular text-ink-3">{n(l.uph, 1)}</td>
                  <td className="text-right tabular text-[12px]">{l.judged ? <><span className={cn(l.under && "font-semibold text-warn")}>{l.under}</span><span className="text-ink-4"> · </span><span className={cn(l.over && "font-semibold text-bad")}>{l.over}</span><span className="text-ink-4"> of {l.judged}</span></> : <span className="text-ink-4">—</span>}</td>
                </tr>
                {isOpen && <Days days={l.days} />}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-subtle font-semibold">
            <td>{wh} total</td><td className="text-right tabular">{n(tot.heads)}</td><td />
            <td className="text-right tabular">{n(tot.cap || null)}</td><td className="text-right tabular" title="Departments with manpower only">{n(tot.req || null)}</td>
            <td className={cn("text-right tabular", coverTone(tot.req ? tot.cap / tot.req : null))}>{pc(tot.req && tot.cap ? tot.cap / tot.req : null)}</td>
            <td className="text-right tabular">{n(tot.out || null)}</td>
            <td className={cn("text-right tabular", achTone(tot.capJ ? tot.outJ / tot.capJ : null))}>{pc(tot.capJ ? tot.outJ / tot.capJ : null)}</td>
            <td /><td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** A department row opens into its weeks; a week opens into its days (same row → week → day pattern as the review tables). */
function Days({ days }: { days: MpDay[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const shown = days.filter((d) => d.heads > 0 || d.out != null);
  if (!shown.length) return <tr className="bg-subtle/40"><td colSpan={10} className="pl-8 text-[12px] text-ink-4">No manpower or output on any day yet.</td></tr>;
  const weeks = [...new Set(shown.map((d) => weekOfMonth(d.day)))];
  return (
    <>
      {weeks.map((w) => {
        const ds = shown.filter((d) => weekOfMonth(d.day) === w), isOpen = open.has(w);
        const worked = ds.filter((d) => d.heads > 0), judged = ds.filter((d) => d.ach != null), capd = ds.filter((d) => d.cap != null), outd = ds.filter((d) => d.out != null && d.heads > 0);
        const sCap = judged.reduce((a, d) => a + d.cap!, 0), sOut = judged.reduce((a, d) => a + d.out!, 0);
        const under = judged.filter((d) => d.ach! < 1 - BAND).length, over = judged.filter((d) => d.ach! > 1 + BAND).length;
        return (
          <Fragment key={w}>
            <tr className="cursor-pointer bg-subtle/40 text-[12.5px] hover:bg-subtle" onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(w)) x.delete(w); else x.add(w); return x; })}>
              <td className="pl-6"><span className="flex items-center gap-1.5 font-medium text-ink-2"><ChevronRight size={12} className={cn("text-ink-4 transition", isOpen && "rotate-90")} />{w.replace("_", " ")}<span className="font-normal text-ink-4">· {ds.length}d</span></span></td>
              <td className="text-right tabular">{worked.length ? n(worked.reduce((a, d) => a + d.heads, 0) / worked.length) : "—"}</td>
              <td />
              <td className="text-right tabular">{capd.length ? n(capd.reduce((a, d) => a + d.cap!, 0) / capd.length) : "—"}</td>
              <td /><td />
              <td className="text-right tabular">{outd.length ? n(outd.reduce((a, d) => a + d.out!, 0) / outd.length) : "—"}</td>
              <td className={cn("text-right tabular", achTone(sCap ? sOut / sCap : null))}>{pc(sCap ? sOut / sCap : null)}</td>
              <td className="text-right tabular text-ink-4">{outd.length ? n(outd.reduce((a, d) => a + d.out!, 0) / outd.reduce((a, d) => a + d.heads, 0), 1) : "—"}</td>
              <td className="text-right tabular text-[12px]">{judged.length ? <><span className={cn(under && "font-semibold text-warn")}>{under}</span><span className="text-ink-4"> · </span><span className={cn(over && "font-semibold text-bad")}>{over}</span><span className="text-ink-4"> of {judged.length}</span></> : <span className="text-ink-4">—</span>}</td>
            </tr>
            {isOpen && ds.map((d) => (
              <tr key={d.day} className="bg-subtle/20 text-[12px]">
                <td className="pl-11 text-ink-3">{dayLabel(d.day)}</td>
                <td className="text-right tabular">{d.heads ? n(d.heads) : <span className="text-warn">no heads</span>}</td>
                <td className="text-right tabular text-ink-4">{n(d.rate)}</td>
                <td className="text-right tabular">{n(d.cap)}</td>
                <td /><td />
                <td className="text-right tabular">{n(d.out)}</td>
                <td className={cn("text-right tabular", achTone(d.ach))}>{pc(d.ach)}</td>
                <td className="text-right tabular text-ink-4">{d.heads && d.out != null ? n(d.out / d.heads, 1) : "—"}</td>
                <td />
              </tr>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
