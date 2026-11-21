import Link from "next/link";
import { requireSopOverview } from "@/server/sop/access";
import { EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { resolvePeriod } from "@/server/sop/period";
import { dailyDeviation } from "@/server/sop/daily";
import { attainment, SLA_STREAMS, slaBacklog, slaDays, type SlaSite } from "@/server/wcm/sla";
import { cn } from "@/lib/cn";
import { today } from "@/lib/dates";
import { currentPeriod } from "@/server/sop/model";

export const metadata = { title: "S&OP · Service levels" };
type SP = { grain?: string; p?: string; period?: string; site?: string; stream?: string };
const n0 = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const h1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} h`);
const pc = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const BUCKETS = ["0–1 d", "2 d", "3 d", "4–7 d", "> 7 d"];

/**
 * S&OP plan vs actual volume (dispatch day) next to warehouse TAT / SLA (order-line cohort = created day) on one date axis.
 * Plan and dispatched volume come from the S&OP day view (both sites); SLA from the wcm_sla_daily snapshot (per site).
 */
export default async function SlaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSopOverview();
  const sp = await searchParams;
  const per = await resolvePeriod({ ...sp, p: sp.p ?? sp.period ?? currentPeriod(today()) }); // default: the running month, not the latest planned one
  if (!per.sel) return <EmptyState title="No S&OP periods yet" body="Service levels appear once S&OP has a period." />;
  const site: SlaSite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const cfg = SLA_STREAMS.find((s) => s.stream === sp.stream) ?? SLA_STREAMS[0];
  const [days, daily, backlog] = await Promise.all([slaDays(per.sel.months, site, cfg.stream), dailyDeviation(per.sel.months), slaBacklog(site)]);
  const plan = cfg.plan ? daily.views.find((v) => v.key === cfg.plan)?.total.days ?? [] : [];
  const axis = [...new Set([...plan.map((d) => d.day), ...days.map((d) => d.day)])].sort();
  const key = per.sel.key;
  const href = (o: Partial<SP>) => `/sop/sla?${new URLSearchParams(Object.entries({ grain: per.grain, p: key, site, stream: cfg.stream, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const tot = days.reduce((a, d) => ({ eligible: a.eligible + d.eligible, dispatched: a.dispatched + d.dispatched, onTime: a.onTime + d.onTime, overdue: a.overdue + d.overdue, cancelled: a.cancelled + d.cancelled, noSla: a.noSla + d.noSla }),
    { eligible: 0, dispatched: 0, onTime: 0, overdue: 0, cancelled: 0, noSla: 0 });
  const fetched = days.map((d) => d.fetched).sort().at(-1);
  const tiles: [string, string, string][] = [
    ["SLA attainment", pc(attainment(tot)), "on time ÷ (dispatched + overdue)"], ["Eligible lines", n0(tot.eligible), "not cancelled, with an SLA deadline"],
    ["Dispatched late", n0(tot.dispatched - tot.onTime), "eligible, after deadline"], ["Overdue open", n0(tot.overdue), "not dispatched, past deadline"],
    ["Excluded", n0(tot.cancelled + tot.noSla), `${n0(tot.cancelled)} cancelled · ${n0(tot.noSla)} no deadline`],
  ];

  return (
    <div>
      <PeriodPicker base="/sop/sla" grain={per.grain} options={per.options} selected={key} partial={per.partial} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Warehouse</span>{(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="seg"><span className="seg-label">Channel</span>{SLA_STREAMS.map((s) => <Link key={s.stream} href={href({ stream: s.stream })} data-on={cfg.stream === s.stream} className="seg-item">{s.stream}</Link>)}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {tiles.map(([l, v, s]) => (
          <div key={l} className="card px-3 py-2.5"><div className="text-[11px] text-ink-4">{l}</div><div className="text-[20px] font-semibold leading-tight tabular">{v}</div><div className="text-[11px] text-ink-4">{s}</div></div>))}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base min-w-[1000px]">
          <thead>
            <tr><th rowSpan={2}>Day</th><th colSpan={3} className="text-center">Volume · S&amp;OP (dispatch day, both sites)</th><th colSpan={6} className="text-center">TAT / SLA · {site} (cohort = line created that day)</th></tr>
            <tr><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">vs plan</th>
              <th className="text-right">Eligible</th><th className="text-right">On time</th><th className="text-right">Attainment</th><th className="text-right">P50 TAT</th><th className="text-right">P90 TAT</th><th className="text-right">Open / overdue</th></tr>
          </thead>
          <tbody>{axis.map((day) => {
            const p = plan.find((x) => x.day === day), s = days.find((x) => x.day === day), a = s ? attainment(s) : null;
            return (
              <tr key={day}>
                <td className="tabular">{day.slice(5)}</td>
                <td className="text-right tabular">{cfg.plan ? n0(p?.plan) : "—"}</td><td className="text-right tabular">{cfg.plan ? n0(p?.actual) : "—"}</td>
                <td className={cn("text-right tabular", p?.dev != null && Math.abs(p.dev) > 0.2 && "text-warn")}>{p?.dev == null ? "—" : pc(p.dev)}</td>
                <td className="text-right tabular">{n0(s?.eligible)}</td><td className="text-right tabular">{n0(s?.onTime)}</td>
                <td className={cn("text-right tabular", a != null && (a < 0.95 ? "text-bad" : "text-ok"))}>{pc(a)}</td>
                <td className="text-right tabular">{h1(s?.p50 ?? null)}</td><td className="text-right tabular">{h1(s?.p90 ?? null)}</td>
                <td className="text-right tabular">{s ? `${n0(s.open)} / ${n0(s.overdue)}` : "—"}</td>
              </tr>);
          })}</tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">
          {cfg.plan ? "" : "B2B Marketplace is planned per month only, so it has no day plan. "}Volume is items dispatched per day; SLA is per order line, by the day it was created — same date axis, not the same lines.
          Deadline = Unicommerce TAT; cancelled lines and lines with no deadline are excluded; holds can&apos;t be excluded (ON_HOLD is never set upstream). Open lines not yet due aren&apos;t judged.
          {site === "Both" && " Both-site P50 / P90 are dispatched-weighted means of the site percentiles (approximate)."} Snapshot of warehouse_sla_performance (~60-day source), last read {fetched?.slice(0, 16) ?? "never"}; older days stay as last read.
        </p>
      </div>

      <div className="card mt-4 overflow-x-auto">
        <div className="px-3 pt-3 text-[13px] font-semibold">Backlog by age · {site} (open lines as of the last read)</div>
        <table className="table-base min-w-[640px]">
          <thead><tr><th>Channel</th>{BUCKETS.map((b) => <th key={b} className="text-right">{b}</th>)}</tr></thead>
          <tbody>{[...new Set(backlog.map((b) => b.stream))].map((st) => (
            <tr key={st}><td className="font-medium">{st}</td>{BUCKETS.map((b) => {
              const x = backlog.find((r) => r.stream === st && r.bucket === b);
              return <td key={b} className="text-right tabular">{x ? <>{n0(x.open)}{x.overdue ? <span className="text-bad"> · {n0(x.overdue)} late</span> : null}</> : "—"}</td>;
            })}</tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
