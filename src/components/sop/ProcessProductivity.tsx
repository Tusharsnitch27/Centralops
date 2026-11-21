import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { processProductivity } from "@/server/wcm/productivity";

type Data = Awaited<ReturnType<typeof processProductivity>>;
const n0 = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const wk = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const tone = (v: number | null) => (v == null ? "text-ink-3" : v < 0.8 ? "text-bad" : v > 1.2 ? "text-warn" : "text-ok");

/** S&OP › Productivity › By process: weekly units per man-hour per process × site, % of IPP, role-measured share, idle, bottom 10 %. */
export function ProcessProductivity({ data }: { data: Data }) {
  const { rows, sites, weeks, lastFull, firstFull } = data;
  if (!rows.length) return <div className="card px-4 py-3 text-[13px] text-ink-3">No deployment yet — the daily planner fills it from attendance each morning.</div>;
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-[13px] font-semibold">Hours by site and week</div>
        <table className="table-base mt-2 min-w-[760px]">
          <thead><tr><th>Site</th><th>Week of</th><th className="text-right">Present man-hours</th><th className="text-right">On stages</th><th className="text-right">Idle (reason-coded)</th><th className="text-right">Idle %</th><th className="text-right">OT % of man-hours</th></tr></thead>
          <tbody>{sites.map((s) => (
            <tr key={`${s.site}|${s.week}`} className={cn(s.partial && "text-ink-3")}>
              <td className="font-medium">{s.site}</td><td className="tabular">{wk(s.week)}{s.partial && <span className="ml-1 text-[11px] text-ink-4">partial</span>}</td>
              <td className="text-right tabular">{n0(s.presentHours)}</td><td className="text-right tabular">{n0(s.stageHours)}</td><td className="text-right tabular">{n0(s.idleHours)}</td>
              <td className="text-right tabular">{s.presentHours ? pc(s.idleHours / s.presentHours) : "—"}</td>
              <td className="text-right text-ink-4" title="Waiting for the attendance app's OT endpoint (mp_ot_daily is empty)">open</td>
            </tr>))}</tbody>
        </table>
      </div>

      {(["South", "North"] as const).map((site) => {
        const rs = rows.filter((r) => r.site === site);
        if (!rs.length) return null;
        return (
          <div key={site} className="card overflow-x-auto">
            <div className="px-3 pt-3 text-[13px] font-semibold">{site} · units per man-hour by process</div>
            <table className="table-base mt-2 min-w-[1100px]">
              <thead>
                <tr><th rowSpan={2}>Process</th><th rowSpan={2} className="text-right">IPP / day</th>
                  {weeks.map((w) => <th key={w} className="text-center">{wk(w)}{w !== lastFull && weeks.indexOf(w) === weeks.length - 1 ? " ·  to date" : ""}</th>)}
                  <th rowSpan={2} className="text-right">Δ UPH<div className="text-[10.5px] font-normal text-ink-4">{firstFull && lastFull && firstFull !== lastFull ? `${wk(firstFull)} → ${wk(lastFull)}` : "needs 2 full weeks"}</div></th>
                  <th rowSpan={2} className="text-right">Role-measured<div className="text-[10.5px] font-normal text-ink-4">last full week</div></th></tr>
                <tr>{weeks.map((w) => <th key={w} className="text-center text-[10.5px] font-normal text-ink-4">UPH · % IPP</th>)}</tr>
              </thead>
              <tbody>{rs.map((r) => {
                const m = r.weeks.find((w) => w.week === lastFull)?.measured ?? null;
                return (
                  <tr key={`${r.stream}|${r.stage}`} className={cn(r.bottom && "bg-bad-soft/40")}>
                    <td><span className="font-medium">{r.stream} · {r.stage}</span>{r.bottom && <Badge tone="red" className="ml-1.5">bottom 10%</Badge>}
                      {!r.feed && <div className="text-[11px] text-ink-4">no output feed — hours only</div>}
                      {r.feed === "picked" && <div className="text-[11px] text-ink-4">pick scans partly captured upstream — understated, not ranked</div>}</td>
                    <td className="text-right tabular text-ink-3">{n0(r.ipp)}</td>
                    {r.weeks.map((w) => (
                      <td key={w.week} className={cn("text-center tabular", w.partial && "opacity-60")}>
                        {w.hours ? <>{w.uph == null ? "—" : w.uph.toFixed(1)} · <span className={tone(w.pctIpp)}>{pc(w.pctIpp)}</span><div className="text-[10.5px] text-ink-4">{n0(w.hours)} h</div></> : <span className="text-ink-4">—</span>}
                      </td>))}
                    <td className={cn("text-right tabular", r.change == null ? "text-ink-3" : r.change >= 0.08 ? "text-ok" : r.change < 0 ? "text-bad" : "text-warn")}>{r.change == null ? "—" : `${r.change >= 0 ? "+" : "−"}${Math.abs(Math.round(r.change * 100))}%`}</td>
                    <td className={cn("text-right tabular", m != null && m < 0.5 ? "text-warn" : "text-ink-3")}>{pc(m)}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        );
      })}
      <p className="px-1 text-[11.5px] text-ink-4">
        UPH = stage output (warehouse_sla_performance / putaway_tracking feed) ÷ man-hours on the stage (daily planner deployment × shift hours: Day 9 h; Night 8 h South, 9 h North).
        % IPP = output ÷ (DE × the IPP in effect that day); green 80–120 %. Δ UPH compares the first and last full weeks — Maddy&apos;s target is IPP +8 % quarter on quarter, so read it as direction until a quarter of history exists.
        Role-measured = share of the stage&apos;s DE covered by people whose attendance role works that stage; the rest was placed by workload (Unclassified HR grades) and reads ≈ 100 % of IPP by construction — rows under 50 % are amber and left out of the bottom-10 % ranking.
        Pick output is understated (pick scans 48–82 % captured upstream), so pick rows aren&apos;t ranked. Idle = reason-coded idle lines in the planner; unassigned time isn&apos;t idle. OT % stays open until the attendance app&apos;s OT endpoint is deployed.
      </p>
    </div>
  );
}
