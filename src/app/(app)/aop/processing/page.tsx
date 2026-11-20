import { Fragment } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { AdhChip, cpi, impactTone, n0, n1, Pickers, Section, SplitBar } from "@/components/aop/processing/bits";
import { AssignManpower } from "@/components/aop/processing/AssignManpower";
import { requireUser } from "@/server/auth";
import { processingMonths } from "@/components/aop/processing/months";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { mpAssignments, processingMonth, warehouseAttribution } from "@/server/aop/processing";
import { logisticsAttribution } from "@/server/aop/logistics";
import { CHANNELS, type AttributionRow, type Wh } from "@/server/aop/processingTypes";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Processing" };

type SP = { month?: string; wh?: string; cycle?: string };

const WH_SRC: Record<string, { label: string; tone: "green" | "amber" | "neutral" }> = {
  attendance: { label: "Attendance", tone: "green" }, proposed: { label: "Proposed", tone: "amber" }, sheet: { label: "Sheet", tone: "neutral" },
};

/** AOP › Processing: S&OP projection → planned manpower → actual manpower & adherence → cost per item by channel. */
export default async function ProcessingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, months] = await Promise.all([listCycles(), resolveCycle(sp.cycle), processingMonths()]);
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  const wh = sp.wh === "South" || sp.wh === "North" ? sp.wh : "Both";
  const whs: Wh[] = wh === "Both" ? ["South", "North"] : [wh];
  const href = (o: { month?: string; wh?: string }) =>
    `/aop/processing?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, wh, ...o }).filter(([, v]) => v) as [string, string][])}`;

  const header = <AopHeader active="processing" cycleId={cycle?.id ?? null} cycles={cycles} title="Processing cost & manpower"
    subtitle="S&OP projection → planned manpower → actual manpower & adherence → cost per item, by channel and process." />;
  if (!month) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No processing data yet" body="Processing history loads from the Cost Master sheet (YLK / TAURU Processing Costs) at the next deploy." /></div></div>;

  const [pm, assigns, whAttr, logAttr] = await Promise.all([
    Promise.all(whs.map((w) => processingMonth(month, w))),
    Promise.all(whs.map((w) => mpAssignments(month, w))).then((x) => x.flat()),
    warehouseAttribution([month]),
    logisticsAttribution([month]),
  ]);
  const open = assigns.filter((a) => a.unassigned > 0.05);
  // like-for-like: CPI gap × output, so a month-to-date or part-captured month never reads as a saving against the full-month plan
  const impactRows = pm.flatMap((m) => m.streams.flatMap((s) => s.rows)).filter((r) => r.costImpact != null);
  const impact = impactRows.reduce((a, r) => a + r.costImpact!, 0), impactN = impactRows.length;
  const tot = pm.reduce((a, m) => ({ planned: a.planned + m.totals.plannedExp, actual: a.actual + (m.totals.actualExp ?? 0), pmp: a.pmp + m.totals.plannedMp, amp: a.amp + (m.totals.actualMp ?? 0) }), { planned: 0, actual: 0, pmp: 0, amp: 0 });

  return (
    <div className="animate-fade-in">
      {header}
      <Pickers months={months} month={month} wh={wh} href={href} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Planned manpower cost" value={inr(tot.planned)} sub={`${n1(tot.pmp)} planned heads`} />
        <Tile label="Actual manpower cost" value={inr(tot.actual || null)} sub={`${n1(tot.amp)} actual heads`} />
        <Tile label="Cost vs plan" value={inr(impact, { sign: true })} tone={impactTone(impactN ? impact : null)} sub="(planned − actual CPI) × output · + = under plan" />
        <Tile label="Open for assignment" value={String(open.length)} tone={open.length ? "text-warn" : "text-ok"} sub={open.length ? "departments with unassigned heads" : "all heads assigned"} />
      </div>

      <div className="space-y-3">
        <Section open title="① S&OP projections received" sub="Projected volume per stream (channel) vs what the warehouse actually processed">
          {pm.map((m) => (
            <div key={m.warehouse} className="overflow-x-auto">
              {whs.length > 1 && <WhHead wh={m.warehouse} />}
              <table className="table-base min-w-[640px]">
                <thead><tr><th>Stream</th><th>Channel</th><th className="text-right">S&OP projection</th><th className="text-right">Final output</th><th className="text-right">Volume adherence</th></tr></thead>
                <tbody>{m.streams.map((s) => (
                  <tr key={s.stream}><td className="font-medium">{s.stream}</td><td className="text-ink-3">{s.channel}</td>
                    <td className="text-right tabular">{n0(s.sopProj)}</td><td className="text-right tabular">{n0(s.finalOutput)}</td><td className="text-right"><AdhChip v={s.volumeAdherence} /></td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </Section>

        <Section title="② Planned manpower" sub="MP required = ⌈projection ÷ (target/head/day × working days)⌉ · CPI = expense ÷ projection · stream CPI = Σ processes"
          summary={<span className="tabular text-white/80">{n1(tot.pmp)} heads · {inr(tot.planned)}</span>}>
          {pm.map((m) => (
            <div key={m.warehouse} className="overflow-x-auto">
              {whs.length > 1 && <WhHead wh={m.warehouse} />}
              <table className="table-base min-w-[900px]">
                <thead><tr><th>Process</th><th className="text-right">Target / head / day</th><th className="text-right">Output / head / month</th><th className="text-right">MP required</th><th className="text-right">Planned MP</th><th className="text-right">Planned exp</th><th className="text-right">Ideal CPI</th><th className="text-right">Planned CPI</th></tr></thead>
                <tbody>{m.streams.map((s) => (
                  <Fragment key={s.stream}>
                    <tr className="bg-subtle/70 font-semibold"><td>{s.stream}</td><td /><td /><td className="text-right tabular">{n1(s.rows.reduce((a, r) => a + (r.mpRequired ?? 0), 0))}</td><td className="text-right tabular">{n1(s.plannedMp)}</td>
                      <td className="text-right tabular">{inr(s.rows.reduce((a, r) => a + (r.plannedExp ?? 0), 0))}</td><td className="text-right tabular">{cpi(s.idealCpi)}</td><td className="text-right tabular">{cpi(s.plannedCpi)}</td></tr>
                    {s.rows.map((r) => (
                      <tr key={r.process}><td className="pl-6 text-ink-2">{r.process}</td><td className="text-right tabular">{n0(r.targetPerDay)}</td><td className="text-right tabular text-ink-3">{n0(r.outputPerHead)}</td>
                        <td className="text-right tabular">{n1(r.mpRequired)}</td><td className="text-right tabular">{n1(r.plannedMp)}</td><td className="text-right tabular">{inr(r.plannedExp)}</td>
                        <td className="text-right tabular text-ink-3">{cpi(r.idealCpi)}</td><td className="text-right tabular">{cpi(r.plannedCpi)}</td></tr>
                    ))}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          ))}
        </Section>

        <Section title="③ Actual manpower & adherence" sub="Attendance heads (department) split to stream × process · actual CPI = actual expense ÷ final output"
          summary={open.length ? <span className="text-warn">{open.length} open for assignment</span> : <span className="text-ok">all assigned</span>}>
          {open.length > 0 && (
            <div className="space-y-2 border-b border-line bg-warn-soft/30 p-3">
              <div className="text-[12.5px] text-ink-2"><span className="font-semibold">Open for assignment.</span> The attendance app reports heads per department only (no sub-function or channel). Split each department across its streams and processes — until then the app shows a proposed split from the plan mix.</div>
              {open.map((a) => (
                <AssignManpower key={`${a.warehouse}|${a.department}`} a={a}
                  options={pm.find((m) => m.warehouse === a.warehouse)!.streams.filter((s) => s.dept === a.department).flatMap((s) => s.rows.map((r) => ({ stream: s.stream, process: r.process })))} />
              ))}
            </div>
          )}
          {pm.map((m) => (
            <div key={m.warehouse} className="overflow-x-auto">
              {whs.length > 1 && <WhHead wh={m.warehouse} />}
              <table className="table-base min-w-[980px]">
                <thead><tr><th>Process</th><th className="text-right">Planned MP</th><th className="text-right">Actual MP</th><th>Source</th><th className="text-right">MP adherence</th><th className="text-right">Actual exp</th><th className="text-right">Actual CPI</th><th className="text-right">Δ CPI vs plan</th><th className="text-right">₹ impact</th></tr></thead>
                <tbody>{m.streams.map((s) => {
                  const impact = s.rows.reduce((a, r) => (r.costImpact == null ? a : (a ?? 0) + r.costImpact), null as number | null);
                  return (
                    <Fragment key={s.stream}>
                      <tr className="bg-subtle/70 font-semibold"><td>{s.stream}</td><td className="text-right tabular">{n1(s.plannedMp)}</td><td className="text-right tabular">{n1(s.actualMp)}</td><td />
                        <td className="text-right"><AdhChip v={s.actualMp != null && s.plannedMp ? s.actualMp / s.plannedMp : null} /></td>
                        <td className="text-right tabular">{inr(s.rows.reduce((a, r) => (r.actualExp == null ? a : (a ?? 0) + r.actualExp), null as number | null))}</td>
                        <td className="text-right tabular">{cpi(s.actualCpi)}</td><Dcpi a={s.actualCpi} p={s.plannedCpi} /><td className={cn("text-right tabular", impactTone(impact))}>{inr(impact, { sign: true })}</td></tr>
                      {s.rows.map((r) => (
                        <tr key={r.process}><td className="pl-6 text-ink-2">{r.process}</td><td className="text-right tabular">{n1(r.plannedMp)}</td><td className="text-right tabular">{n1(r.actualMp)}</td>
                          <td>{r.actualMpSource ? <Badge tone={WH_SRC[r.actualMpSource].tone}>{WH_SRC[r.actualMpSource].label}</Badge> : <span className="text-ink-4">—</span>}</td>
                          <td className="text-right"><AdhChip v={r.mpAdherence} /></td><td className="text-right tabular">{inr(r.actualExp)}</td><td className="text-right tabular">{cpi(r.actualCpi)}</td>
                          <Dcpi a={r.actualCpi} p={r.plannedCpi} /><td className={cn("text-right tabular", impactTone(r.costImpact))}>{inr(r.costImpact, { sign: true })}</td></tr>
                      ))}
                    </Fragment>
                  );
                })}</tbody>
              </table>
            </div>
          ))}
        </Section>

        <Section title="④ Cost per item by channel" sub="Warehouse: channel manpower direct; rent, utilities, security and overhead departments sit in Shared (storage & handling) · Logistics: per channel"
          summary={<span className="tabular text-white/80">{inr(whAttr.filter((r) => r.period === month).reduce((a, r) => a + r.amount, 0) + logAttr.filter((r) => r.period === month).reduce((a, r) => a + r.amount, 0))}</span>}>
          <ChannelTable rows={[...whAttr, ...logAttr].filter((r) => r.period === month && (r.warehouse === "All" || whs.includes(r.warehouse as Wh)))} />
          <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">
            Logistics is being split by channel in a new Cost Master tab. Until it lands, logistics vendor cost is allocated to channels by shipment share (cp_1 / eShipz; Q-Com = HLD couriers) and marked “allocated”; once the tab is imported its rows replace the allocation automatically — no change to this view.
          </p>
        </Section>
      </div>
    </div>
  );
}

function ChannelTable({ rows }: { rows: AttributionRow[] }) {
  if (!rows.length) return <EmptyState compact title="No cost attributed for this month yet" />;
  const by = (ch: string, fam: AttributionRow["family"]) => rows.filter((r) => r.channel === ch && r.family === fam);
  // units repeat per process row of a channel; take the largest, not the sum. ponytail: assumes one unit basis per channel × family
  // …within a warehouse; South + North are then added
  const units = (rs: AttributionRow[]) => {
    const per = new Map<string, number>();
    for (const r of rs) per.set(r.warehouse, Math.max(per.get(r.warehouse) ?? 0, r.units ?? 0));
    return [...per.values()].reduce((a, n) => a + n, 0) || null;
  };
  // logistics rows are per vendor (disjoint AWBs) → sum
  const sumUnits = (rs: AttributionRow[]) => rs.reduce((a, r) => a + (r.units ?? 0), 0) || null;
  const channels = [...CHANNELS.filter((c) => rows.some((r) => r.channel === c)), ...[...new Set(rows.map((r) => r.channel))].filter((c) => !(CHANNELS as readonly string[]).includes(c))];
  const data = channels.map((ch) => {
    const w = by(ch, "warehouse"), l = by(ch, "logistics");
    const wAmt = w.reduce((a, r) => a + r.amount, 0), lAmt = l.reduce((a, r) => a + r.amount, 0);
    const wU = units(w), lU = sumUnits(l);
    const basis = l.some((r) => r.basis === "pending") ? "pending" : l.some((r) => r.basis === "allocated") ? "allocated" : l.length ? "direct" : null;
    return { ch, w, wAmt, wU, lAmt, lU, basis, keys: [...new Set(l.map((r) => r.key))].join(" · "), procs: w.filter((r) => r.process).map((r) => ({ label: r.process, value: r.amount })) };
  });
  // Shared (storage & handling) is carried by every item processed, not by the inventory-capacity line
  const items = data.filter((d) => d.ch !== "Shared").reduce((a, d) => a + (d.wU ?? 0), 0) || null;
  for (const d of data) if (d.ch === "Shared") d.wU = items;
  const totW = data.reduce((a, d) => a + d.wAmt, 0), totL = data.reduce((a, d) => a + d.lAmt, 0);
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[1040px]">
        <thead><tr><th>Channel</th><th>Warehouse ₹ (by process)</th><th className="text-right">Units</th><th className="text-right">WH CPI</th><th className="text-right">Logistics ₹</th><th className="text-right">Shipments</th><th className="text-right">₹ / shipment</th><th className="text-right" title="(warehouse ₹ + logistics ₹) ÷ items">Total ₹ / item</th></tr></thead>
        <tbody>
          {data.map((d) => {
            const wc = d.wU ? d.wAmt / d.wU : null, lc = d.lU ? d.lAmt / d.lU : null;
            return (
              <tr key={d.ch}>
                <td className="font-medium">{d.ch === "Shared" ? <span title="Rent, utilities, security, housekeeping and overhead departments (Ops, Logistics, Admin)">Shared · storage & handling</span> : d.ch}</td>
                <td>{d.wAmt ? (d.procs.length > 1 ? <SplitBar parts={d.procs} fmt={(v) => inr(v)} /> : <span className="tabular">{inr(d.wAmt)}</span>) : <span className="text-ink-4">—</span>}</td>
                <td className="text-right tabular text-ink-3">{n0(d.wU)}</td>
                <td className="text-right tabular">{cpi(wc)}</td>
                <td className="text-right tabular">
                  {d.basis === "pending" ? <span className="text-[12px] text-ink-4">awaiting split tab</span> : <>{inr(d.lAmt || null)}{d.basis === "allocated" && <span title={d.keys} className="ml-1 cursor-help text-[11px] text-ink-4 underline decoration-dotted">allocated</span>}</>}
                </td>
                <td className="text-right tabular text-ink-3">{n0(d.lU)}</td>
                <td className="text-right tabular">{d.basis === "pending" ? "—" : cpi(lc)}</td>
                <td className="text-right font-semibold tabular">{d.wU ? cpi((d.wAmt + (d.basis === "pending" ? 0 : d.lAmt)) / d.wU) : d.basis === "pending" ? "—" : cpi(lc)}</td>
              </tr>
            );
          })}
          <tr className="bg-subtle/70 font-semibold"><td>Total</td><td className="tabular">{inr(totW)}</td><td /><td /><td className="text-right tabular">{inr(totL || null)}</td><td /><td /><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function Dcpi({ a, p }: { a: number | null; p: number | null }) {
  if (a == null || p == null) return <td className="text-right text-ink-4">—</td>;
  const d = a - p;
  return <td className={cn("text-right tabular", Math.abs(d) < 0.005 ? "text-ink-3" : d > 0 ? "text-bad" : "text-ok")}>{d > 0 ? "+" : d < 0 ? "−" : ""}₹{Math.abs(d).toFixed(2)}</td>;
}

function WhHead({ wh }: { wh: Wh }) {
  return <div className="border-b border-line bg-subtle px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">{wh === "South" ? "South · YLK 1 & 2" : "North · Tauru"}</div>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={cn("text-[20px] font-semibold leading-tight tabular", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}

