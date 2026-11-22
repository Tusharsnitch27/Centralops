import Link from "next/link";
import { Badge } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { ChannelTable } from "@/components/aop/ChannelTable";
import { Economics } from "@/components/aop/Economics";
import { processingMonths } from "@/components/aop/processing/months";
import { warehouseAttribution } from "@/server/aop/processing";
import { logisticsAttribution } from "@/server/aop/logistics";
import { monLabel } from "@/components/aop/processing/bits";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { dayCost, monthHistory, type DaySite } from "@/server/wcm/dayCost";
import { inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Unit costs" };
type SP = { cycle?: string; site?: string; days?: string; month?: string };
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
  await requireUser();
  const site: DaySite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const span = [7, 14, 31].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const to = istDay(1), fromWanted = istDay(span);
  const from = fromWanted < ATTENDANCE_FROM ? ATTENDANCE_FROM : fromWanted;
  const [cycles, cycle, rows, hist, pmonths] = await Promise.all([listCycles(), resolveCycle(sp.cycle), dayCost(from, to, site), monthHistory(), processingMonths()]);
  const curMonth = `${istDay(0).slice(0, 7)}-01`;
  const econMonths = pmonths.filter((x) => x < curMonth).slice(0, 6).reverse(); // closed months only: a running month carries MTD-scaled plan
  const chMonth = sp.month && econMonths.includes(sp.month) ? sp.month : econMonths.at(-1);
  const [whAttr, logAttr] = econMonths.length ? await Promise.all([warehouseAttribution(econMonths), logisticsAttribution(econMonths)]) : [[], []];
  const attr = [...whAttr, ...logAttr].filter((r) => (r.warehouse === "All" ? site === "Both" : site === "Both" || r.warehouse === site));
  const header = <AopHeader active="cost" cycleId={cycle?.id ?? null} cycles={cycles} title="Unit costs" subtitle="B2C cost per shipment and B2B cost per unit" />;
  const href = (o: Partial<SP>) => `/aop/cost?${new URLSearchParams(Object.entries({ cycle: sp.cycle, site, days: String(span), ...o }).filter(([, v]) => v) as [string, string][])}`;
  // latest day whose feeds are in: dispatches loaded and (Both) courier AWBs for most Shopify shipments (marketplaces ship on their
  // own logistics) — a part-loaded day misreads CPS
  const fed = (r: (typeof rows)[number]) => r.shipments.b2c > 0 && (site !== "Both" || (r.lines.find((l) => l.key === "lg:b2c")?.units ?? 0) >= 0.6 * r.shipments.shopify);
  const d1 = [...rows].reverse().find(fed) ?? rows.at(-1);
  const jas = hist.filter((h) => ["2026-07-01", "2026-08-01", "2026-09-01"].includes(h.month));
  const jasComplete = jas.filter((h) => h.complete);
  // baseline = Σ cost ÷ Σ volume over the complete JAS months (never an average of monthly ratios)
  const baseB2c = jasComplete.length ? jasComplete.reduce((a, h) => a + (h.b2c ?? 0), 0) / jasComplete.reduce((a, h) => a + (h.b2cOrders ?? 0), 0) : null;
  const baseB2b = jasComplete.length ? jasComplete.reduce((a, h) => a + (h.b2b ?? 0), 0) / jasComplete.reduce((a, h) => a + (h.b2bItems ?? 0), 0) : null;
  const jasNote = jasComplete.length ? `JAS'26 baseline (${jasComplete.map((h) => h.month.slice(5, 7)).join(", ")} complete)` : "JAS'26 baseline: no complete month yet";

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Site</span>{(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="seg"><span className="seg-label">Days</span>{[7, 14, 31].map((d) => <Link key={d} href={href({ days: String(d) })} data-on={span === d} className="seg-item">{d}</Link>)}</div>
      </div>

      {d1 && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {([["CPS · B2C", r2(d1.cpsB2c), `${d1.day} · ${n0(d1.shipments.b2c)} shipments · ${jasNote} ${r2(baseB2c)}`],
            ["CPU · B2B", r2(d1.cpuB2b), `${d1.day} · ${n0(d1.items.b2b)} units · baseline ${r2(baseB2b)}`],
            ["Cost", r0(d1.total), `${d1.day} · ${site}${d1.missing.length ? ` · ${d1.missing.length} line(s) missing` : ""}`],
            ["B2C share", r0(d1.b2c), `incl. ${d1.shareB2c == null ? "—" : Math.round(d1.shareB2c * 100) + "%"} of shared`]] as const).map(([l, v, s]) => (
            <div key={l} className="card px-3 py-2.5"><div className="text-[11px] text-ink-4">{l}</div><div className="text-[20px] font-semibold leading-tight tabular">{v}</div><div className="text-[11px] text-ink-4">{s}</div></div>))}
        </div>)}

      <div className="space-y-3">
        {d1 && <Section title={`${d1.day} · line by line`}>
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Line</th><th>Side</th><th className="text-right">₹</th><th>Basis</th><th>How</th></tr></thead>
            <tbody>{d1.lines.map((l) => <tr key={l.key}><td className="font-medium">{l.label}</td><td className="text-[12px]">{l.side}</td><td className="text-right tabular">{r0(l.amount)}</td>
              <td><Badge tone={BASIS_TONE[l.basis]}>{l.basis}</Badge></td><td className="text-[12px] text-ink-3">{l.note}</td></tr>)}
              <tr className="font-semibold"><td>Total (known lines)</td><td /><td className="text-right tabular">{r0(d1.total)}</td><td colSpan={2} className="text-[12px] font-normal text-ink-4">
                B2C {r0(d1.b2c)} · B2B {r0(d1.b2b)} · shared {r0(d1.shared)} split {d1.shareB2c == null ? "—" : `${Math.round(d1.shareB2c * 100)} / ${100 - Math.round(d1.shareB2c * 100)}`} by items</td></tr></tbody>
          </table>
        </Section>}

        <Section open title="Day by day" sub={`${site} · from ${from}`}>
          <div className="overflow-x-auto"><table className="table-base min-w-[980px]">
            <thead><tr><th>Day</th><th className="text-right">Cost</th><th className="text-right">B2C ₹</th><th className="text-right">B2B ₹</th><th className="text-right">B2C shipments</th><th className="text-right">B2B units</th>
              <th className="text-right">CPS B2C</th><th className="text-right">CPU B2B</th><th>Missing</th></tr></thead>
            <tbody>{[...rows].reverse().map((r) => <tr key={r.day}>
              <td className="tabular">{r.day.slice(5)}</td><td className="text-right tabular">{r0(r.total)}</td><td className="text-right tabular">{r0(r.b2c)}</td><td className="text-right tabular">{r0(r.b2b)}</td>
              <td className="text-right tabular">{n0(r.shipments.b2c)}</td><td className="text-right tabular">{n0(r.items.b2b)}</td>
              <td className={cn("text-right tabular", !fed(r) ? "text-ink-4" : baseB2c != null && r.cpsB2c != null && r.cpsB2c > baseB2c * 1.1 && "text-bad")} title={fed(r) ? undefined : "feed not complete for this day"}>{r2(r.cpsB2c)}{!fed(r) && " *"}</td>
              <td className={cn("text-right tabular", baseB2b != null && r.cpuB2b != null && r.cpuB2b > baseB2b * 1.1 && "text-bad")}>{r2(r.cpuB2b)}</td>
              <td className="text-[11.5px] text-warn">{r.missing.join(", ")}</td></tr>)}</tbody>
          </table></div>
        </Section>

        <Section open title="Month by month · booked" sub="All-India">
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
        </Section>

        {chMonth && <Section open title={`Cost per item by channel · ${monLabel(chMonth)}`} sub={site}>
          <div className="flex flex-wrap gap-1 px-4 pt-3">{econMonths.map((p) => <Link key={p} href={href({ month: p })} className={cn("rounded-md px-2 py-1 text-[12px]", p === chMonth ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line")}>{monLabel(p)}</Link>)}</div>
          <ChannelTable rows={attr.filter((r) => r.period === chMonth)} />
        </Section>}

        <Section title="Warehouse and logistics ₹ per item by month" sub={site}>
          <Economics months={econMonths} rows={attr} />
        </Section>
      </div>
    </div>
  );
}
