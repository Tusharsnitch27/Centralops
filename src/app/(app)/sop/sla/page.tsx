import Link from "next/link";
import { requireSopOverview } from "@/server/sop/access";
import { EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { resolvePeriod } from "@/server/sop/period";
import { dailyDeviation } from "@/server/sop/daily";
import { attainment, judged, SLA_STREAMS, slaBacklog, slaDays, slaNoDeadline, type SlaSite } from "@/server/wcm/sla";
import { cn } from "@/lib/cn";
import { today } from "@/lib/dates";
import { currentPeriod } from "@/server/sop/model";

export const metadata = { title: "S&OP · Service levels" };
type SP = { grain?: string; p?: string; period?: string; site?: string; stream?: string };
const n0 = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const h1 = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} h`);
const pc = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const BUCKETS = ["0–1 d", "2 d", "3 d", "4–7 d", "> 7 d"];
/** Dec targets: B2C SLA > 99 %, B2B SLA 100 %. */
const tone = (stream: string, a: number | null) => (a == null ? undefined : stream.startsWith("B2B") ? (a >= 0.9995 ? "text-ok" : "text-bad") : a >= 0.99 ? "text-ok" : a >= 0.95 ? "text-warn" : "text-bad");

/**
 * S&OP plan vs actual volume (dispatch day) next to warehouse SLA on one date axis. SLA = the upstream status per line / order,
 * grouped by deadline day (wcm_sla_cell): B2C SLA_STATUS (delay_flag excluded), B2B Retail HANDOVER_SLA, B2B Marketplace tracker.
 */
export default async function SlaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSopOverview();
  const sp = await searchParams;
  const per = await resolvePeriod({ ...sp, p: sp.p ?? sp.period ?? currentPeriod(today()) }); // default: the running month, not the latest planned one
  if (!per.sel) return <EmptyState title="No S&OP periods yet" body="Service levels appear once S&OP has a period." />;
  const site: SlaSite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const cfg = SLA_STREAMS.find((s) => s.stream === sp.stream) ?? SLA_STREAMS[0];
  const b2b = cfg.stream.startsWith("B2B");
  const [days, daily, backlog, noDeadline] = await Promise.all([slaDays(per.sel.months, site, cfg.stream), dailyDeviation(per.sel.months), slaBacklog(site), slaNoDeadline(per.sel.months, site, cfg.stream)]);
  const plan = cfg.plan ? daily.views.find((v) => v.key === cfg.plan)?.total.days ?? [] : [];
  const axis = [...new Set([...plan.map((d) => d.day), ...days.map((d) => d.day)])].sort();
  const key = per.sel.key;
  const href = (o: Partial<SP>) => `/sop/sla?${new URLSearchParams(Object.entries({ grain: per.grain, p: key, site, stream: cfg.stream, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const add = (k: "onTime" | "futDone" | "breached" | "pendBreach" | "futOpen" | "cancelled" | "unfulfillable" | "delayFlagged") => days.reduce((a, d) => a + d[k], 0);
  const tot = { onTime: add("onTime"), futDone: add("futDone"), breached: add("breached"), pendBreach: add("pendBreach"), futOpen: add("futOpen"), cancelled: add("cancelled"), unfulfillable: add("unfulfillable"), delayFlagged: add("delayFlagged") };
  const o2mN = days.reduce((a, d) => a + (d.o2mH == null ? 0 : d.onTime + d.futDone + d.breached), 0);
  const o2m = o2mN ? days.reduce((a, d) => a + (d.o2mH ?? 0) * (d.o2mH == null ? 0 : d.onTime + d.futDone + d.breached), 0) / o2mN : null;
  const ord = days.reduce((a, d) => ({ n: a.n + (d.orders ?? 0), late: a.late + (d.ordersLate ?? 0) }), { n: 0, late: 0 });
  const fetched = days.map((d) => d.fetched).sort().at(-1);
  const a = attainment(tot);
  const tiles: [string, string, string, string?][] = [
    ["SLA attainment", pc(a), `on time ÷ judged ${cfg.unit} · target ${b2b ? "100%" : "> 99%"}`, tone(cfg.stream, a)],
    [`Judged ${cfg.unit}`, n0(judged(tot)), "deadline passed, or done ahead of it"],
    ["Done late", n0(tot.breached), "done after the deadline"],
    ["Overdue open", n0(tot.pendBreach), "not done, deadline passed"],
    b2b ? ["Orders late", ord.n ? `${n0(ord.late)} of ${n0(ord.n)}` : "—", "any unit late or overdue"] : ["Avg order → dispatch", h1(o2m), "judged lines · target < 4.5 h (B2C)"],
    ["Excluded", n0(tot.cancelled + tot.unfulfillable + tot.delayFlagged + noDeadline),
      `${n0(tot.cancelled)} cancelled · ${n0(tot.unfulfillable)} unfulfillable${b2b ? "" : ` · ${n0(tot.delayFlagged)} delay-flagged`} · ${n0(noDeadline)} no deadline`],
  ];

  return (
    <div>
      <PeriodPicker base="/sop/sla" grain={per.grain} options={per.options} selected={key} partial={per.partial} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Warehouse</span>{(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="seg"><span className="seg-label">Channel</span>{SLA_STREAMS.map((s) => <Link key={s.stream} href={href({ stream: s.stream })} data-on={cfg.stream === s.stream} className="seg-item">{s.stream}</Link>)}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-6">
        {tiles.map(([l, v, s, t]) => (
          <div key={l} className="card px-3 py-2.5"><div className="text-[11px] text-ink-4">{l}</div><div className={cn("text-[20px] font-semibold leading-tight tabular", t)}>{v}</div><div className="text-[11px] text-ink-4">{s}</div></div>))}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base min-w-[1040px]">
          <thead>
            <tr><th rowSpan={2}>Day</th><th colSpan={3} className="text-center">Volume · S&amp;OP (dispatch day, both sites)</th><th colSpan={b2b ? 6 : 7} className="text-center">SLA · {site} · {cfg.unit} by deadline day</th></tr>
            <tr><th className="text-right">Plan</th><th className="text-right">Actual</th><th className="text-right">vs plan</th>
              <th className="text-right">Judged</th><th className="text-right">On time</th><th className="text-right">Late</th><th className="text-right">Overdue open</th><th className="text-right">Attainment</th>
              {b2b ? <th className="text-right">Orders late</th> : <><th className="text-right">Delay-flagged</th><th className="text-right">Avg O→D</th></>}</tr>
          </thead>
          <tbody>{axis.map((day) => {
            const p = plan.find((x) => x.day === day), s = days.find((x) => x.day === day), at = s ? attainment(s) : null;
            return (
              <tr key={day}>
                <td className="tabular">{day.slice(5)}</td>
                <td className="text-right tabular">{cfg.plan ? n0(p?.plan) : "—"}</td><td className="text-right tabular">{cfg.plan ? n0(p?.actual) : "—"}</td>
                <td className={cn("text-right tabular", p?.dev != null && Math.abs(p.dev) > 0.2 && "text-warn")}>{p?.dev == null ? "—" : pc(p.dev)}</td>
                <td className="text-right tabular">{s ? n0(judged(s)) : "—"}</td><td className="text-right tabular">{s ? n0(s.onTime + s.futDone) : "—"}</td>
                <td className="text-right tabular">{n0(s?.breached)}</td><td className={cn("text-right tabular", s?.pendBreach ? "text-bad" : undefined)}>{n0(s?.pendBreach)}</td>
                <td className={cn("text-right tabular", tone(cfg.stream, at))}>{pc(at)}</td>
                {b2b ? <td className="text-right tabular">{s?.orders ? `${n0(s.ordersLate)} / ${n0(s.orders)}` : "—"}</td>
                  : <><td className="text-right tabular text-ink-3">{n0(s?.delayFlagged)}</td><td className="text-right tabular">{h1(s?.o2mH ?? null)}</td></>}
              </tr>);
          })}</tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">
          {cfg.plan ? "" : "B2B Marketplace is planned per month only, so it has no day plan. "}SLA rule: {cfg.rule}. Volume is items dispatched per day; SLA is grouped by the day the deadline falls — same date axis, not the same lines.
          {b2b ? " B2B is counted in units (quantity); “Orders late” counts orders with any unit late or overdue." : " Lines with delay_flag (exchange, warehouse switch, error order) are excluded from every count and shown apart; cancelled and unfulfillable lines aren’t judged; holds can’t be excluded (ON_HOLD is never set upstream). Lines done ahead of a deadline still to come count as on time."}
          {cfg.stream === "B2B Marketplace" && " The tracker's Dispatch_date is the deadline (taken as 18:00); done = RTS_DATE. Dispatched rows with no RTS date can't be judged and sit under no deadline."}
          {" "}Open work whose deadline is still ahead isn’t judged. Snapshot, last read {fetched?.slice(0, 16) ?? "never"}; the B2C source keeps ~60 days, older days stay as last read.
        </p>
      </div>

      <div className="card mt-4 overflow-x-auto">
        <div className="px-3 pt-3 text-[13px] font-semibold">Open work by age · {site} (lines for B2C, units for B2B; as of the last read)</div>
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
