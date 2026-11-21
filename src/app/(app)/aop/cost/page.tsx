import Link from "next/link";
import { Badge } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { Section } from "@/components/aop/processing/bits";
import { MpRateForm } from "@/components/aop/MpRateForm";
import { canManage, requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { dayCost, monthHistory, type DaySite } from "@/server/wcm/dayCost";
import { inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Cost per day" };
type SP = { cycle?: string; site?: string; days?: string };
const r0 = (v: number | null | undefined) => (v == null ? "—" : inrFull(v));
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);
const n0 = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const BASIS_TONE = { measured: "green", "run-rate": "amber", booked: "green", missing: "red" } as const;
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 36e5 - offset * 864e5).toISOString().slice(0, 10);
const ATTENDANCE_FROM = "2026-10-29";

/**
 * AOP › Cost per day: the D-1 cost of doing business per site, line by line with how each line was priced, rolled up to B2C and
 * B2B CPS; then the monthly history from booked figures (true-up) with the JAS'26 baseline.
 */
export default async function CostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const site: DaySite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const span = [7, 14, 31].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const to = istDay(1), fromWanted = istDay(span);
  const from = fromWanted < ATTENDANCE_FROM ? ATTENDANCE_FROM : fromWanted;
  const [cycles, cycle, rows, hist, rates] = await Promise.all([listCycles(), resolveCycle(sp.cycle), dayCost(from, to, site), monthHistory(),
    q<{ site: string; effective_from: string; monthly_salary: number; days_basis: number; ot_hourly: number | null; note: string | null }>(
      `select site, effective_from::text, monthly_salary::float8, days_basis, ot_hourly::float8, note from wcm_mp_rate order by site, effective_from desc`)]);
  const header = <AopHeader active="cost" cycleId={cycle?.id ?? null} cycles={cycles} title="Cost per day"
    subtitle="Yesterday's cost of doing business, line by line, with how each line is priced — measured, run-rate or missing — rolled up to B2C and B2B cost per shipment. Booked figures replace estimates once a month closes." />;
  const href = (o: Partial<SP>) => `/aop/cost?${new URLSearchParams(Object.entries({ cycle: sp.cycle, site, days: String(span), ...o }).filter(([, v]) => v) as [string, string][])}`;
  const d1 = rows.at(-1);
  const jas = hist.filter((h) => ["2026-07-01", "2026-08-01", "2026-09-01"].includes(h.month));
  const jasComplete = jas.filter((h) => h.complete);
  // baseline = Σ cost ÷ Σ volume over the complete JAS months (never an average of monthly ratios)
  const baseB2c = jasComplete.length ? jasComplete.reduce((a, h) => a + (h.b2c ?? 0), 0) / jasComplete.reduce((a, h) => a + (h.b2cOrders ?? 0), 0) : null;
  const baseB2b = jasComplete.length ? jasComplete.reduce((a, h) => a + (h.b2b ?? 0), 0) / jasComplete.reduce((a, h) => a + (h.b2bItems ?? 0), 0) : null;
  const jasNote = jasComplete.length ? `JAS'26 baseline (${jasComplete.map((h) => h.month.slice(5, 7)).join(", ")} complete)` : "JAS'26 baseline: no complete month yet";
  const defaultRate = rates.some((r) => /default/i.test(r.note ?? ""));

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Site</span>{(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="seg"><span className="seg-label">Days</span>{[7, 14, 31].map((d) => <Link key={d} href={href({ days: String(d) })} data-on={span === d} className="seg-item">{d}</Link>)}</div>
        {defaultRate && <span className="text-[12px] text-warn">Manpower is priced at the default ₹21,983 / 26 days — enter the salary master below.</span>}
      </div>

      {d1 && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {([["D-1 cost", r0(d1.total), `${d1.day} · ${site}${d1.missing.length ? ` · ${d1.missing.length} line(s) missing` : ""}`],
            ["B2C cost", r0(d1.b2c), `incl. ${d1.shareB2c == null ? "—" : Math.round(d1.shareB2c * 100) + "%"} of shared`],
            ["CPS · B2C", r2(d1.cpsB2c), `${n0(d1.shipments.b2c)} shipments · baseline ${r2(baseB2c)}`],
            ["CPU · B2B", r2(d1.cpuB2b), `${n0(d1.items.b2b)} units · baseline ${r2(baseB2b)}`],
            ["Baseline", jasComplete.length ? "set" : "—", jasNote]] as const).map(([l, v, s]) => (
            <div key={l} className="card px-3 py-2.5"><div className="text-[11px] text-ink-4">{l}</div><div className="text-[20px] font-semibold leading-tight tabular">{v}</div><div className="text-[11px] text-ink-4">{s}</div></div>))}
        </div>)}

      <div className="space-y-3">
        {d1 && <Section open title={`D-1 · ${d1.day} · line by line`} sub="Each line says how it is priced. Missing lines are listed, never counted as ₹0. Shared cost is split B2C / B2B by dispatched items.">
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Line</th><th>Side</th><th className="text-right">₹</th><th>Basis</th><th>How</th></tr></thead>
            <tbody>{d1.lines.map((l) => <tr key={l.key}><td className="font-medium">{l.label}</td><td className="text-[12px]">{l.side}</td><td className="text-right tabular">{r0(l.amount)}</td>
              <td><Badge tone={BASIS_TONE[l.basis]}>{l.basis}</Badge></td><td className="text-[12px] text-ink-3">{l.note}</td></tr>)}
              <tr className="font-semibold"><td>Total (known lines)</td><td /><td className="text-right tabular">{r0(d1.total)}</td><td colSpan={2} className="text-[12px] font-normal text-ink-4">
                B2C {r0(d1.b2c)} · B2B {r0(d1.b2b)} · shared {r0(d1.shared)} split {d1.shareB2c == null ? "—" : `${Math.round(d1.shareB2c * 100)} / ${100 - Math.round(d1.shareB2c * 100)}`} by items</td></tr></tbody>
          </table>
        </Section>}

        <Section open title="Day by day" sub={`${site} · from ${from} (attendance starts ${ATTENDANCE_FROM}) · CPS = cost ÷ dispatched shipments (distinct packages)`}>
          <div className="overflow-x-auto"><table className="table-base min-w-[980px]">
            <thead><tr><th>Day</th><th className="text-right">Cost</th><th className="text-right">B2C ₹</th><th className="text-right">B2B ₹</th><th className="text-right">B2C shipments</th><th className="text-right">B2B units</th>
              <th className="text-right">CPS B2C</th><th className="text-right">CPU B2B</th><th>Missing</th></tr></thead>
            <tbody>{[...rows].reverse().map((r) => <tr key={r.day}>
              <td className="tabular">{r.day.slice(5)}</td><td className="text-right tabular">{r0(r.total)}</td><td className="text-right tabular">{r0(r.b2c)}</td><td className="text-right tabular">{r0(r.b2b)}</td>
              <td className="text-right tabular">{n0(r.shipments.b2c)}</td><td className="text-right tabular">{n0(r.items.b2b)}</td>
              <td className={cn("text-right tabular", baseB2c != null && r.cpsB2c != null && r.cpsB2c > baseB2c * 1.1 && "text-bad")}>{r2(r.cpsB2c)}</td>
              <td className={cn("text-right tabular", baseB2b != null && r.cpuB2b != null && r.cpuB2b > baseB2b * 1.1 && "text-bad")}>{r2(r.cpuB2b)}</td>
              <td className="text-[11.5px] text-warn">{r.missing.join(", ")}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-2 text-[11.5px] text-ink-4">Site views carry manpower, OT and warehousing only: packaging and logistics have no site split and show under Both. B2C = cost per shipment (dispatched packages); B2B = cost per unit dispatched — the same measures as the monthly view. Red = more than 10% above the JAS'26 baseline.</p>
        </Section>

        <Section open title="Month by month · booked (true-up)" sub="Cost Master actuals (warehousing + manpower + OT + packaging, shared by items) + logistics working files (billed, before credit notes) · volume from S&OP outwards (Unicommerce) · all-India">
          <div className="overflow-x-auto"><table className="table-base min-w-[900px]">
            <thead><tr><th>Month</th><th className="text-right">Warehouse (booked)</th><th className="text-right">B2C logistics</th><th className="text-right">B2B logistics</th><th className="text-right">Total</th>
              <th className="text-right">B2C orders</th><th className="text-right">B2B units</th><th className="text-right">CPS B2C</th><th className="text-right">CPU B2B</th><th>Coverage</th></tr></thead>
            <tbody>{hist.map((h) => <tr key={h.month} className={cn(["2026-07-01", "2026-08-01", "2026-09-01"].includes(h.month) && "bg-subtle/60")}>
              <td className="font-medium">{h.month.slice(0, 7)}</td><td className="text-right tabular">{r0(h.warehouse)}</td><td className="text-right tabular">{r0(h.b2cLogistics)}</td><td className="text-right tabular">{r0(h.b2bLogistics)}</td>
              <td className="text-right tabular">{r0(h.total)}</td><td className="text-right tabular">{n0(h.b2cOrders)}</td><td className="text-right tabular">{n0(h.b2bItems)}</td>
              <td className="text-right tabular">{h.complete ? r2(h.cpsB2c) : <span className="text-ink-4">{r2(h.cpsB2c)}{h.cpsB2c != null && " *"}</span>}</td>
              <td className="text-right tabular">{h.complete ? r2(h.cpuB2b) : <span className="text-ink-4">{r2(h.cpuB2b)}{h.cpuB2b != null && " *"}</span>}</td>
              <td className="text-[11.5px]">{h.complete ? <span className="text-ok">complete</span> : <span className="text-warn">{[h.missing ? `${h.missing} booked line(s) missing` : "", !h.b2cLogistics || !h.b2bLogistics ? "logistics file missing" : "", !h.volOk ? "no S&OP daily volume (workbook month)" : ""].filter(Boolean).join(" · ")}</span>}</td></tr>)}</tbody>
          </table></div>
          <p className="mt-2 text-[11.5px] text-ink-4">* Incomplete month: shown for reference only, not used in the baseline. JAS'26 baseline = Σ cost ÷ Σ volume over the complete JAS months (shaded).</p>
        </Section>

        <Section title="Salary master (manpower pricing)" sub="₹ per present day-equivalent = monthly ₹ per head ÷ days basis, per site, from a date. OT ₹ / hour prices approved OT hours.">
          <table className="table-base mb-3"><thead><tr><th>Site</th><th>From</th><th className="text-right">Monthly ₹ / head</th><th className="text-right">Days</th><th className="text-right">₹ / DE</th><th className="text-right">OT ₹ / h</th><th>Source</th></tr></thead>
            <tbody>{rates.map((r) => <tr key={r.site + r.effective_from}><td>{r.site}</td><td className="tabular">{r.effective_from}</td><td className="text-right tabular">{r0(r.monthly_salary)}</td><td className="text-right tabular">{r.days_basis}</td>
              <td className="text-right tabular">{r2(r.monthly_salary / r.days_basis)}</td><td className="text-right tabular">{r.ot_hourly == null ? "—" : r2(r.ot_hourly)}</td><td className="text-[12px] text-ink-3">{r.note}</td></tr>)}</tbody></table>
          {canManage(u) && <MpRateForm />}
        </Section>
      </div>
    </div>
  );
}
