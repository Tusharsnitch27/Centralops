import { Fragment } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { cpi, impactTone, monLabel, Pickers, Section } from "@/components/aop/processing/bits";
import { LeverPanel } from "@/components/aop/processing/LeverPanel";
import { processingMonths } from "@/components/aop/processing/months";
import { requireUser } from "@/server/auth";
import { listCycles, loadModel, resolveCycle, type SectionNode } from "@/server/aop/model";
import { STATUS_META } from "@/server/aop/calc";
import { processingMonth, warehouseAttribution } from "@/server/aop/processing";
import { logisticsAttribution } from "@/server/aop/logistics";
import { slaModel } from "@/server/wcm/sla";
import type { AttributionRow, StreamBlock, Wh } from "@/server/aop/processingTypes";
import { inr, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Analysis" };

/** AOP › Analysis: budget / provision / actuals by function → category, variance drivers, unit economics and a lever what-if. */
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ month?: string; wh?: string; cycle?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, months] = await Promise.all([listCycles(), resolveCycle(sp.cycle), processingMonths()]);
  const header = <AopHeader active="analysis" cycleId={cycle?.id ?? null} cycles={cycles} title="Analysis & levers"
    subtitle="Where the money goes, why it moved, what it costs per item — and what a lever would change." />;
  if (!cycle) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No AOP cycle yet" /></div></div>;

  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  const wh = sp.wh === "South" || sp.wh === "North" ? sp.wh : "Both";
  const whs: Wh[] = wh === "Both" ? ["South", "North"] : [wh];
  const href = (o: { month?: string; wh?: string }) =>
    `/aop/analysis?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle.id : undefined, month, wh, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const econMonths = [...months].slice(0, 12).reverse();

  const [m, pm, whAttr, logAttr, sla] = await Promise.all([
    loadModel(cycle.id),
    month ? Promise.all(whs.map((w) => processingMonth(month, w))) : Promise.resolve([]),
    econMonths.length ? warehouseAttribution(econMonths) : Promise.resolve([] as AttributionRow[]),
    econMonths.length ? logisticsAttribution(econMonths) : Promise.resolve([] as AttributionRow[]),
    slaModel(),
  ]);
  const L = cycle.labels;
  // streams summed across the selected warehouses (lever + drivers work on the combined picture)
  const streams = mergeStreams(pm.map((x) => x.streams));

  return (
    <div className="animate-fade-in">
      {header}
      {month && <Pickers months={months} month={month} wh={wh} href={href} />}
      <div className="space-y-3">
        <Section open title={`${L.plan} · ${L.forecast} · ${L.actual} by function and category`} sub={`Year to date through ${m?.lastClosed ? monLabel(m.lastClosed) : "—"} · variance on months that reported`}
          summary={m && <span className="tabular text-white/80">YTD {inr(m.totals.ytdActual)} of {inr(m.totals.ytdPlanReported)}</span>}>
          {m ? (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[960px]">
                <thead><tr><th>Function / category</th><th>Owner</th><th className="text-right">FY {L.plan.toLowerCase()}</th><th className="text-right">YTD {L.plan.toLowerCase()}</th><th className="text-right">YTD {L.actual.toLowerCase()}</th><th className="text-right">Variance</th><th className="text-right">Projection</th><th className="text-right">vs FY</th><th>Status</th></tr></thead>
                <tbody>{m.functions.map((f) => (
                  <Fragment key={f.id}>
                    <FnRow n={f} depth={0} />
                    {f.children.map((c) => <FnRow key={c.id} n={c} depth={1} />)}
                  </Fragment>
                ))}
                  <tr className="bg-subtle/70 font-semibold"><td>Total</td><td /><td className="text-right tabular">{inr(m.totals.fyPlan)}</td><td className="text-right tabular">{inr(m.totals.ytdPlanReported)}</td><td className="text-right tabular">{inr(m.totals.ytdActual)}</td>
                    <td className={cn("text-right tabular", impactTone(m.totals.impact))}>{inr(m.totals.impact, { sign: true })}</td><td className="text-right tabular">{inr(m.totals.projection)}</td>
                    <td className={cn("text-right tabular", impactTone(m.totals.gapImpact))}>{inr(m.totals.gapImpact, { sign: true })}</td><td><Badge tone={STATUS_META[m.totals.status].tone} dot>{STATUS_META[m.totals.status].label}</Badge></td></tr>
                </tbody>
              </table>
              <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Variance and vs FY are favourability: + = under {L.plan.toLowerCase()} (cost lines).</p>
            </div>
          ) : <EmptyState compact title="No plan loaded" />}
        </Section>

        <Section title="Variance drivers · warehouse manpower" sub={month ? `${monLabel(month)} · volume = (output − projection) × planned CPI · rate = (actual CPI − planned CPI) × output` : "no processing month yet"}>
          {streams.length ? <Drivers streams={streams} /> : <EmptyState compact title="No processing data for this month" />}
        </Section>

        <Section title="Unit economics" sub="₹ per item by month · warehouse = all warehouse cost ÷ units processed · logistics = logistics cost ÷ shipments">
          <Economics months={econMonths} rows={[...whAttr, ...logAttr].filter((r) => (r.warehouse === "All" ? wh === "Both" : whs.includes(r.warehouse as Wh)))} />
          {wh !== "Both" && <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Logistics is all-India (no site split): shown under Both only, never divided by one site&apos;s items.</p>}
        </Section>

        <Section open title="Levers · what-if" sub="Move volume, productivity, adherence, salary or headcount and see manpower, cost and CPI change — and whether B2C / B2B SLA capacity holds. Not saved.">
          {streams.length ? <LeverPanel sites={pm.map((x) => x.streams)} sla={sla} label={`${month ? monLabel(month) : ""} · ${wh}`} /> : <EmptyState compact title="No processing data for this month" />}
        </Section>
      </div>
    </div>
  );
}

function FnRow({ n, depth }: { n: SectionNode; depth: number }) {
  const s = STATUS_META[n.m.status];
  return (
    <tr className={depth === 0 ? "bg-subtle/50 font-semibold" : undefined}>
      <td className={depth ? "pl-6 text-ink-2" : ""}>{n.name}</td>
      <td className="text-ink-3">{n.owner_name ?? n.owner_label ?? n.contributors.map((c) => c.name).join(", ") ?? "—"}</td>
      <td className="text-right tabular">{inr(n.m.fyPlan)}</td>
      <td className="text-right tabular text-ink-3">{inr(n.m.ytdPlanReported)}</td>
      <td className="text-right tabular">{inr(n.m.ytdActual)}</td>
      <td className={cn("text-right tabular", impactTone(n.m.impact))} title={n.m.impactPct == null ? undefined : pct(n.m.impactPct, 1, true)}>{inr(n.m.impact, { sign: true })}</td>
      <td className="text-right tabular">{inr(n.m.projection)}</td>
      <td className={cn("text-right tabular", impactTone(n.m.gapImpact))}>{inr(n.m.gapImpact, { sign: true })}</td>
      <td>{depth === 0 || n.m.status !== "on_track" ? <Badge tone={s.tone} dot>{s.label}</Badge> : null}</td>
    </tr>
  );
}

function Drivers({ streams }: { streams: StreamBlock[] }) {
  const rows = streams.map((s) => {
    const pExp = s.rows.reduce((a, r) => a + (r.plannedExp ?? 0), 0);
    const aExp = s.rows.some((r) => r.actualExp != null) ? s.rows.reduce((a, r) => a + (r.actualExp ?? 0), 0) : null;
    const out = s.finalOutput, proj = s.sopProj;
    const volume = out != null && proj != null && s.plannedCpi != null ? (out - proj) * s.plannedCpi : null;
    const rate = out != null && s.actualCpi != null && s.plannedCpi != null ? (s.actualCpi - s.plannedCpi) * out : null;
    const total = aExp == null ? null : aExp - pExp;
    return { s, pExp, aExp, volume, rate, total, residual: total == null ? null : total - (volume ?? 0) - (rate ?? 0) };
  });
  // total row covers only streams with an actual, so Δ = volume + rate + residual holds; the rest are listed, not summed
  const judged = rows.filter((r) => r.total != null), skipped = rows.length - judged.length;
  const sum = (k: "pExp" | "aExp" | "volume" | "rate" | "total" | "residual") => judged.reduce((a, r) => a + (r[k] ?? 0), 0);
  // cost drivers: + ₹ = more spend (adverse). Coloured as spend, so adverse = red.
  const tone = (v: number | null) => impactTone(v == null ? null : -v);
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[860px]">
        <thead><tr><th>Stream</th><th className="text-right">Planned exp</th><th className="text-right">Actual exp</th><th className="text-right">Δ spend</th><th className="text-right">Volume effect</th><th className="text-right">Rate (CPI) effect</th><th className="text-right">Residual</th><th className="text-right">Planned → actual CPI</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.s.stream}>
              <td className="font-medium">{r.s.stream}</td>
              <td className="text-right tabular text-ink-3">{inr(r.pExp)}</td><td className="text-right tabular">{inr(r.aExp)}</td>
              <td className={cn("text-right font-semibold tabular", tone(r.total))}>{inr(r.total, { sign: true })}</td>
              <td className={cn("text-right tabular", tone(r.volume))}>{inr(r.volume, { sign: true })}</td>
              <td className={cn("text-right tabular", tone(r.rate))}>{inr(r.rate, { sign: true })}</td>
              <td className="text-right tabular text-ink-3">{inr(r.residual, { sign: true })}</td>
              <td className="text-right tabular">{cpi(r.s.plannedCpi)} → {cpi(r.s.actualCpi)}</td>
            </tr>
          ))}
          <tr className="bg-subtle/70 font-semibold"><td>Total · {judged.length} streams with actuals{skipped ? <div className="text-[11px] font-normal text-ink-4">{skipped} without actuals not summed</div> : null}</td><td className="text-right tabular">{inr(sum("pExp"))}</td><td className="text-right tabular">{inr(sum("aExp"))}</td>
            <td className={cn("text-right tabular", tone(sum("total")))}>{inr(sum("total"), { sign: true })}</td><td className={cn("text-right tabular", tone(sum("volume")))}>{inr(sum("volume"), { sign: true })}</td>
            <td className={cn("text-right tabular", tone(sum("rate")))}>{inr(sum("rate"), { sign: true })}</td><td className="text-right tabular">{inr(sum("residual"), { sign: true })}</td><td /></tr>
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">+ ₹ = more spend than plan (red). Volume effect = cost of processing more/less than projected at planned CPI; rate effect = cost of running at a different CPI; residual = rounding of heads and mix.</p>
    </div>
  );
}

function Economics({ months, rows }: { months: string[]; rows: AttributionRow[] }) {
  if (!months.length || !rows.length) return <EmptyState compact title="No attributed cost yet" />;
  // units repeat per process row; per family take the largest unit basis per channel, then sum channels. ponytail: same assumption as Processing › ④
  const fam = (p: string, f: AttributionRow["family"]) => {
    const rs = rows.filter((r) => r.period === p && r.family === f);
    const amt = rs.reduce((a, r) => a + r.amount, 0);
    const byCh = new Map<string, number>();
    // warehouse: process rows share a volume → max per channel × warehouse; logistics: vendor rows are disjoint AWBs → sum
    for (const r of rs) if (r.channel !== "Shared") {
      const k = f === "logistics" ? `${r.channel}|${r.process}` : `${r.channel}|${r.warehouse}`;
      byCh.set(k, f === "logistics" ? (byCh.get(k) ?? 0) + (r.units ?? 0) : Math.max(byCh.get(k) ?? 0, r.units ?? 0));
    }
    const units = [...byCh.values()].reduce((a, v) => a + v, 0);
    const pendingAmt = rs.filter((r) => r.basis === "pending").reduce((a, r) => a + r.amount, 0), mapped = amt - pendingAmt;
    return { amt, mapped, units, cpi: units ? mapped / units : null, pending: pendingAmt > 0, pendingAmt };
  };
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[760px]">
        <thead><tr><th>Month</th><th className="text-right">Warehouse ₹</th><th className="text-right">Units</th><th className="text-right">WH ₹ / item</th><th className="text-right">Logistics ₹</th><th className="text-right">Shipments</th><th className="text-right">Logistics ₹ / shipment</th><th className="text-right">Total ₹ / item</th></tr></thead>
        <tbody>{months.map((p) => {
          const w = fam(p, "warehouse"), l = fam(p, "logistics");
          return (
            <tr key={p}>
              <td className="font-medium">{monLabel(p)}</td>
              <td className="text-right tabular">{inr(w.amt || null)}</td><td className="text-right tabular text-ink-3">{w.units ? new Intl.NumberFormat("en-IN").format(Math.round(w.units)) : "—"}</td><td className="text-right tabular">{cpi(w.cpi)}</td>
              <td className="text-right tabular">{inr(l.amt || null)}{l.pending && <span title={`${inr(l.pendingAmt)} not yet mapped to a channel — awaiting the split tab`} className="ml-1 cursor-help text-[11px] text-ink-4 underline decoration-dotted">part pending</span>}</td>
              <td className="text-right tabular text-ink-3">{l.units ? new Intl.NumberFormat("en-IN").format(Math.round(l.units)) : "—"}</td><td className="text-right tabular">{cpi(l.cpi)}</td>
              <td className="text-right font-semibold tabular">{w.units ? cpi((w.amt + l.mapped) / w.units) : "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Packaging ₹ / item lives under AOP › Packaging (not repeated here).</p>
    </div>
  );
}

/** Add the same stream across warehouses (South + North). Rows merge by process; CPIs re-derived from summed ₹ and volume. */
function mergeStreams(lists: StreamBlock[][]): StreamBlock[] {
  if (lists.length <= 1) return lists[0] ?? [];
  const out = new Map<string, StreamBlock>();
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
  for (const list of lists) for (const s of list) {
    const c = out.get(s.stream);
    if (!c) { out.set(s.stream, { ...s, rows: s.rows.map((r) => ({ ...r })) }); continue; }
    c.sopProj = add(c.sopProj, s.sopProj); c.finalOutput = add(c.finalOutput, s.finalOutput); c.plannedMp += s.plannedMp; c.actualMp = add(c.actualMp, s.actualMp);
    for (const r of s.rows) {
      const x = c.rows.find((y) => y.process === r.process);
      if (!x) { c.rows.push({ ...r }); continue; }
      x.sopProj = add(x.sopProj, r.sopProj); x.finalOutput = add(x.finalOutput, r.finalOutput); x.mpRequired = add(x.mpRequired, r.mpRequired);
      x.plannedMp = add(x.plannedMp, r.plannedMp); x.plannedExp = add(x.plannedExp, r.plannedExp); x.actualMp = add(x.actualMp, r.actualMp); x.actualExp = add(x.actualExp, r.actualExp);
      x.costImpact = add(x.costImpact, r.costImpact);
      // ponytail: per-head output / salary averaged across warehouses for the lever; weight by heads if the two diverge a lot
      x.outputPerHead = x.outputPerHead != null && r.outputPerHead != null ? (x.outputPerHead + r.outputPerHead) / 2 : x.outputPerHead ?? r.outputPerHead;
      x.avgSalary = x.avgSalary != null && r.avgSalary != null ? (x.avgSalary + r.avgSalary) / 2 : x.avgSalary ?? r.avgSalary;
    }
  }
  for (const c of out.values()) {
    for (const r of c.rows) {
      r.plannedCpi = r.plannedExp != null && r.sopProj ? r.plannedExp / r.sopProj : null;
      r.actualCpi = r.actualExp != null && r.finalOutput ? r.actualExp / r.finalOutput : null;
    }
    c.plannedCpi = c.rows.some((r) => r.plannedCpi != null) ? c.rows.reduce((a, r) => a + (r.plannedCpi ?? 0), 0) : null;
    c.actualCpi = c.rows.some((r) => r.actualCpi != null) ? c.rows.reduce((a, r) => a + (r.actualCpi ?? 0), 0) : null;
    c.volumeAdherence = c.sopProj && c.finalOutput != null ? c.finalOutput / c.sopProj : null;
  }
  return [...out.values()];
}

