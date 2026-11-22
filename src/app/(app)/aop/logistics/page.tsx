import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { Section } from "@/components/aop/processing/bits";
import { canManage, requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { LogisticsUpload } from "@/components/aop/LogisticsUpload";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { b2bBy, b2bCategories, b2cRows, lgMonths, minCharge, retailCorrelation, storeTop, zoneLanes, type B2bAgg, type LgSite } from "@/server/aop/lgAnalysis";
import { inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Logistics" };
type SP = { cycle?: string; site?: string; cat?: string; month?: string };
const n0 = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);
const pc = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
const div = (a: number, b: number | null | undefined) => (b ? a / b : null);
const mon = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
const SITE_ZONE: Record<string, string> = { South: "SOUTH", North: "NORTH" };

/**
 * AOP › Logistics: the Apr–Oct 2026 working files (billed, before credit notes) — B2C courier CPS / RTO, B2B LR economics
 * (1-box, minimum charge, type, partner, zone lanes) and freight against retail dispatch volume from the journey spine.
 */
export default async function LogisticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cycles, cycle, all, cats, src] = await Promise.all([listCycles(), resolveCycle(sp.cycle), lgMonths(), b2bCategories(),
    q<{ k: string; s: string | null }>(`select 'b2c' as k, max(source) as s from lg_b2c_month union all select 'b2b', max(source) from lg_b2b_lr union all select 'rvp', max(source) from lg_rvp_month`)]);
  const upload = canManage(u) ? <LogisticsUpload loaded={{ b2c: src.find((x) => x.k === "b2c")?.s ?? null, b2b: src.find((x) => x.k === "b2b")?.s ?? null, rvp: src.find((x) => x.k === "rvp")?.s ?? null }} /> : null;
  const header = <AopHeader active="logistics" cycleId={cycle?.id ?? null} cycles={cycles} title="Logistics"
    subtitle="Courier and B2B freight from the working files (Apr–Oct 2026, billed before credit notes), against dispatch volume. Every ratio is Σ₹ ÷ Σunits." />;
  if (!all.length) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No logistics working files loaded" body="An admin or PM loads the B2C partner file, the B2B LR file and the B2B RVP & MP file here." /></div>{upload}</div>;
  const site: LgSite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const cat = sp.cat && cats.includes(sp.cat) ? sp.cat : null;
  const months = sp.month && all.includes(sp.month) ? [sp.month] : all;
  const href = (o: Partial<SP>) => `/aop/logistics?${new URLSearchParams(Object.entries({ cycle: sp.cycle, site, cat: cat ?? undefined, month: sp.month, ...o }).filter(([, v]) => v) as [string, string][])}`;

  const rvp = await q<{ month: string; partner: string; flow: string; lrs: number | null; boxes: number | null; qty: number | null; amount: number | null; adhoc: number | null; kg: number | null }>(
    `select month::text as month, partner, flow, lrs::float8 as lrs, boxes::float8 as boxes, qty::float8 as qty, amount::float8 as amount, adhoc::float8 as adhoc, kg::float8 as kg
     from lg_rvp_month where month = any($1::date[]) order by flow, partner, month`, [all]);
  const rvpPartners = [...new Set(rvp.map((r) => `${r.flow}|${r.partner}`))];
  const [b2c, byMonth, byCat, byType, byPartner, floor, lanes, corr, stores] = await Promise.all([
    b2cRows(months), b2bBy("month", months, site, cat), b2bBy("category", months, site, null), b2bBy("type", months, site, cat),
    b2bBy("partner", months, site, cat), minCharge(months, site, cat), zoneLanes(months, site, cat), retailCorrelation(months, site), storeTop(months, site),
  ]);
  const tot = byMonth.reduce((a, r) => ({ lrs: a.lrs + r.lrs, qty: a.qty + r.qty, freight: a.freight + r.freight, oneBoxLrs: a.oneBoxLrs + r.oneBoxLrs, oneBoxFreight: a.oneBoxFreight + r.oneBoxFreight }),
    { lrs: 0, qty: 0, freight: 0, oneBoxLrs: 0, oneBoxFreight: 0 });
  const couriers = [...new Set(b2c.map((r) => r.courier))];
  const c = (courier: string, type: string, m?: string) => b2c.filter((r) => r.courier === courier && r.type === type && (!m || r.month === m))
    .reduce((a, r) => ({ awbs: a.awbs + (r.awbs ?? 0), cost: a.cost + (r.cost ?? 0), qty: a.qty + (r.qty ?? 0) }), { awbs: 0, cost: 0, qty: 0 });
  const b2cTot = b2c.reduce((a, r) => ({ awbs: a.awbs + (r.awbs ?? 0), cost: a.cost + (r.cost ?? 0) }), { awbs: 0, cost: 0 });
  const fwdAll = couriers.reduce((a, k) => a + c(k, "FWD").awbs, 0);
  const zoneTot = lanes.reduce((a, l) => a + l.freight, 0);

  const aggRow = (r: B2bAgg, label: string) => (
    <tr key={r.key}>
      <td className="font-medium">{label}</td><td className="text-right tabular">{n0(r.lrs)}</td><td className="text-right tabular">{n0(r.boxes)}</td><td className="text-right tabular">{n0(r.qty)}</td>
      <td className="text-right tabular">{inrFull(r.freight)}</td><td className="text-right tabular">{r2(div(r.freight, r.qty))}</td><td className="text-right tabular">{r2(div(r.freight, r.lrs))}</td>
      <td className="text-right tabular">{r.kg ? (r.kg / r.boxes).toFixed(1) : "—"}</td><td className="text-right tabular">{pc(div(r.oneBoxLrs, r.lrs))}</td>
      <td className="text-right tabular">{pc(div(r.oneBoxFreight, r.freight))}</td><td className="text-right tabular">{r2(div(r.oneBoxFreight, r.oneBoxQty))} / {r2(div(r.freight - r.oneBoxFreight, r.qty - r.oneBoxQty))}</td>
    </tr>);
  const aggHead = (first: string) => (
    <thead><tr><th>{first}</th><th className="text-right">LRs</th><th className="text-right">Boxes</th><th className="text-right">Qty</th><th className="text-right">Freight</th>
      <th className="text-right">₹ / unit</th><th className="text-right">₹ / LR</th><th className="text-right">kg / box</th><th className="text-right">1-box LRs</th><th className="text-right">1-box ₹ share</th><th className="text-right">₹ / unit 1-box / multi</th></tr></thead>);

  return (
    <div className="animate-fade-in">
      {header}
      {upload}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">B2B site</span>{(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="flex flex-wrap gap-1"><Link href={href({ month: undefined })} className={cn("rounded-md px-2 py-1 text-[12px]", !sp.month ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line")}>Apr–Oct</Link>
          {all.map((m) => <Link key={m} href={href({ month: m })} className={cn("rounded-md px-2 py-1 text-[12px]", sp.month === m ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line")}>{mon(m)}</Link>)}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {([["B2C billed", inrFull(b2cTot.cost), `${n0(b2cTot.awbs)} AWBs · ${r2(div(b2cTot.cost, b2cTot.awbs))} / AWB`],
          ["B2B freight", inrFull(tot.freight), `${n0(tot.lrs)} LRs · ${r2(div(tot.freight, tot.qty))} / unit`],
          ["1-box LRs", pc(div(tot.oneBoxLrs, tot.lrs)), `${pc(div(tot.oneBoxFreight, tot.freight))} of B2B freight`],
          ["Credit notes", "not applied", "CN data pending — all figures as billed"]] as const).map(([l, v, s]) => (
          <div key={l} className="card px-3 py-2.5"><div className="text-[11px] text-ink-4">{l}</div><div className="text-[20px] font-semibold leading-tight tabular">{v}</div><div className="text-[11px] text-ink-4">{s}</div></div>))}
      </div>

      <div className="space-y-3">
        <Section open title="B2C · courier cost and RTO" sub="CPS = ₹ ÷ AWBs, CPI = ₹ ÷ items · RTO % = RTO AWBs ÷ forward AWBs · share = courier's forward AWBs ÷ all forward AWBs (both sites; the file has no site split)">
          <div className="overflow-x-auto"><table className="table-base min-w-[1000px]">
            <thead><tr><th>Courier</th><th className="text-right">FWD AWBs</th><th className="text-right">Share</th><th className="text-right">FWD CPS</th><th className="text-right">FWD CPI</th><th className="text-right">RTO %</th><th className="text-right">RTO CPS</th><th className="text-right">DTO AWBs</th><th className="text-right">DTO CPS</th><th className="text-right">Billed ₹</th></tr></thead>
            <tbody>{couriers.map((k) => { const f = c(k, "FWD"), r = c(k, "RTO"), d = c(k, "DTO"); const rto = div(r.awbs, f.awbs);
              return <tr key={k}><td className="font-medium">{k}</td><td className="text-right tabular">{n0(f.awbs)}</td><td className="text-right tabular">{pc(div(f.awbs, fwdAll))}</td><td className="text-right tabular">{r2(div(f.cost, f.awbs))}</td><td className="text-right tabular">{r2(div(f.cost, f.qty))}</td>
                <td className={cn("text-right tabular", rto != null && rto > 0.08 && "text-bad")}>{pc(rto)}</td><td className="text-right tabular">{r2(div(r.cost, r.awbs))}</td><td className="text-right tabular">{n0(d.awbs || null)}</td><td className="text-right tabular">{r2(div(d.cost, d.awbs))}</td>
                <td className="text-right tabular">{inrFull(f.cost + r.cost + d.cost)}</td></tr>; })}</tbody></table></div>
          <div className="mt-3 overflow-x-auto"><table className="table-base min-w-[760px]">
            <thead><tr><th>Forward CPS by month</th>{months.map((m) => <th key={m} className="text-right">{mon(m)}</th>)}</tr></thead>
            <tbody>{couriers.map((k) => <tr key={k}><td className="font-medium">{k}</td>{months.map((m) => { const f = c(k, "FWD", m); return <td key={m} className="text-right tabular">{r2(div(f.cost, f.awbs))}</td>; })}</tr>)}</tbody></table></div>
          <p className="mt-2 text-[11.5px] text-ink-4">Not in this file yet: SDD / NDD rate cards (Blitz, Prozo vs Shadowfax), RTO by single- vs multi-item and COD vs prepaid, and weight-reconciliation deltas. They need the courier rate cards and order-level AWB data from the reco tool.</p>
        </Section>

        <Section open title="B2B · by month" sub={`${cat ?? "all dispatch categories"} · ${site} · ₹ / unit = freight ÷ quantity dispatched; kg / box = charged weight ÷ boxes`}>
          <div className="mb-2 flex flex-wrap gap-1"><Link href={href({ cat: undefined })} className={cn("rounded-md px-2 py-1 text-[12px]", !cat ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line")}>All categories</Link>
            {cats.map((x) => <Link key={x} href={href({ cat: x })} className={cn("rounded-md px-2 py-1 text-[12px]", cat === x ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line")}>{x}</Link>)}</div>
          <div className="overflow-x-auto"><table className="table-base min-w-[1100px]">{aggHead("Month")}<tbody>{byMonth.map((r) => aggRow(r, mon(r.key)))}</tbody></table></div>
        </Section>

        <Section title="B2B · by dispatch category and by type" sub="Per-item cost for NSO, Fresh, RPL, ad-hoc and the rest, per site filter">
          <div className="overflow-x-auto"><table className="table-base min-w-[1100px]">{aggHead("Dispatch category")}<tbody>{byCat.map((r) => aggRow(r, r.key))}</tbody></table></div>
          <div className="mt-3 overflow-x-auto"><table className="table-base min-w-[1100px]">{aggHead("Type")}<tbody>{byType.map((r) => aggRow(r, r.key))}</tbody></table></div>
        </Section>

        <Section title="B2B · partners and minimum charge" sub="At the floor = 1-box LRs charged at that partner's most common 1-box weight (the likely minimum slab — inferred from the data; confirm against each rate card)">
          <div className="overflow-x-auto"><table className="table-base min-w-[1000px]">
            <thead><tr><th>Partner</th><th className="text-right">LRs</th><th className="text-right">Freight</th><th className="text-right">₹ / kg</th><th className="text-right">₹ / unit</th><th className="text-right">1-box LRs</th><th className="text-right">Floor kg</th><th className="text-right">LRs at floor</th><th className="text-right">₹ at floor</th></tr></thead>
            <tbody>{byPartner.map((p) => { const f = floor.find((x) => x.partner === p.key);
              return <tr key={p.key}><td className="font-medium">{p.key}</td><td className="text-right tabular">{n0(p.lrs)}</td><td className="text-right tabular">{inrFull(p.freight)}</td><td className="text-right tabular">{r2(div(p.freight, p.kg))}</td><td className="text-right tabular">{r2(div(p.freight, p.qty))}</td>
                <td className="text-right tabular">{n0(p.oneBoxLrs)} <span className="text-ink-4">({pc(div(p.oneBoxLrs, p.lrs))})</span></td><td className="text-right tabular">{f?.floor_kg ?? "—"}</td>
                <td className="text-right tabular">{n0(f?.at_floor)}</td><td className="text-right tabular">{inrFull(f?.at_floor_freight)}</td></tr>; })}</tbody></table></div>
          <p className="mt-2 text-[11.5px] text-ink-4">Volumetric vs actual weight can&apos;t be separated: the file has charged weight only. Schedule, demurrage and marketplace ad-hoc charges aren&apos;t itemised in it either — they need the invoice lines (reco tool).</p>
        </Section>

        <Section open title="B2B · store returns (RVP) and marketplace shipments" sub="The B2B & MP RVP costing file's Summary · ₹ pre-GST = logistic bill + ad-hoc bill · ₹ / unit = ₹ ÷ quantity · both sites (the summary has no site split)">
          {rvp.length ? <div className="overflow-x-auto"><table className="table-base min-w-[900px]">
            <thead><tr><th>Flow · partner</th>{all.map((m) => <th key={m} className="text-right">{mon(m)}</th>)}<th className="text-right">Total ₹</th><th className="text-right">LRs</th><th className="text-right">Qty</th><th className="text-right">₹ / unit</th><th className="text-right">Ad-hoc share</th></tr></thead>
            <tbody>{rvpPartners.map((k) => { const [flow, partner] = k.split("|"); const rs = rvp.filter((r) => r.flow === flow && r.partner === partner);
              const t = rs.reduce((a, r) => ({ amt: a.amt + (r.amount ?? 0), lrs: a.lrs + (r.lrs ?? 0), qty: a.qty + (r.qty ?? 0), adhoc: a.adhoc + (r.adhoc ?? 0) }), { amt: 0, lrs: 0, qty: 0, adhoc: 0 });
              return <tr key={k}><td className="font-medium">{partner}<div className="text-[11px] text-ink-4">{flow}</div></td>
                {all.map((m) => { const r = rs.find((x) => x.month === m); return <td key={m} className="text-right tabular">{r?.amount == null ? <span className="text-ink-4">—</span> : inrFull(r.amount)}</td>; })}
                <td className="text-right tabular font-medium">{inrFull(t.amt)}</td><td className="text-right tabular">{n0(t.lrs)}</td><td className="text-right tabular">{n0(t.qty)}</td>
                <td className="text-right tabular">{r2(div(t.amt, t.qty))}</td><td className="text-right tabular">{pc(div(t.adhoc, t.amt))}</td></tr>; })}</tbody></table></div>
            : <p className="text-[13px] text-ink-3">Load the B2B RVP &amp; MP file above to see store-return and marketplace freight.</p>}
          <p className="mt-2 text-[11.5px] text-ink-4">A dash = the partner billed nothing that month in the file. Which AOP Logistics lines these book to (e.g. Movemate RVP vs “Movemate – Stock Transfer”) is with Iqbal.</p>
        </Section>

        <Section open title="B2B · zone lanes (dispatching site → store zone)" sub="Store zone from the retail journey spine (distribution_rulebook's ZONE column is #REF! upstream). Cross-zone = store outside the dispatching site's zone.">
          <div className="overflow-x-auto"><table className="table-base min-w-[860px]">
            <thead><tr><th>Site → store zone</th><th className="text-right">LRs</th><th className="text-right">Boxes</th><th className="text-right">Qty</th><th className="text-right">Freight</th><th className="text-right">Share of ₹</th><th className="text-right">₹ / unit</th><th className="text-right">₹ / box</th></tr></thead>
            <tbody>{lanes.map((l) => { const cross = l.zone !== "zone unknown" && l.zone !== SITE_ZONE[l.site];
              return <tr key={l.site + l.zone}><td className="font-medium">{l.site} → {l.zone}{cross && <span className="ml-1 text-[11px] text-warn">cross-zone</span>}</td><td className="text-right tabular">{n0(l.lrs)}</td><td className="text-right tabular">{n0(l.boxes)}</td><td className="text-right tabular">{n0(l.qty)}</td>
                <td className="text-right tabular">{inrFull(l.freight)}</td><td className="text-right tabular">{pc(div(l.freight, zoneTot))}</td><td className="text-right tabular">{r2(div(l.freight, l.qty))}</td><td className="text-right tabular">{r2(div(l.freight, l.boxes))}</td></tr>; })}</tbody></table></div>
        </Section>

        <Section open title="Retail stores · freight against dispatch volume" sub="Freight: retail categories in the LR file (Retail B2B, Dedicated Lane, NSO, BLR own vehicle) · volume: retail_journey_spine (store orders, AWBs, boxes, units) for the same month and site">
          <div className="overflow-x-auto"><table className="table-base min-w-[1000px]">
            <thead><tr><th>Month · site</th><th className="text-right">Freight</th><th className="text-right">LR qty</th><th className="text-right">Spine units</th><th className="text-right">LR qty ÷ spine</th><th className="text-right">LR boxes</th><th className="text-right">Spine boxes</th><th className="text-right">₹ / spine unit</th><th className="text-right">₹ / spine box</th></tr></thead>
            <tbody>{corr.map((r) => <tr key={r.month + r.site}><td className="font-medium">{mon(r.month)} · {r.site}</td><td className="text-right tabular">{inrFull(r.freight)}</td><td className="text-right tabular">{n0(r.lr_qty)}</td><td className="text-right tabular">{n0(r.spine_qty)}</td>
              <td className="text-right tabular">{pc(div(r.lr_qty, r.spine_qty))}</td><td className="text-right tabular">{n0(r.lr_boxes)}</td><td className="text-right tabular">{n0(r.spine_boxes)}</td><td className="text-right tabular">{r2(div(r.freight, r.spine_qty))}</td><td className="text-right tabular">{r2(div(r.freight, r.spine_boxes))}</td></tr>)}</tbody></table></div>
          <div className="mt-3 overflow-x-auto"><table className="table-base min-w-[860px]">
            <thead><tr><th>Top stores by freight</th><th>Zone</th><th className="text-right">Freight</th><th className="text-right">LRs</th><th className="text-right">1-box LRs</th><th className="text-right">LR qty</th><th className="text-right">Spine units</th><th className="text-right">₹ / unit</th></tr></thead>
            <tbody>{stores.map((s) => <tr key={s.store + s.site}><td className="font-medium">{s.store}<div className="text-[11px] text-ink-4">{s.site}</div></td><td className="text-[12px]">{s.zone ?? <span className="text-ink-4">not in spine</span>}</td><td className="text-right tabular">{inrFull(s.freight)}</td>
              <td className="text-right tabular">{n0(s.lrs)}</td><td className="text-right tabular">{n0(s.one_box)}</td><td className="text-right tabular">{n0(s.lr_qty)}</td><td className="text-right tabular">{n0(s.spine_qty)}</td><td className="text-right tabular">{r2(div(s.freight, s.lr_qty))}</td></tr>)}</tbody></table></div>
          <p className="mt-2 text-[11.5px] text-ink-4">B2B returns and marketplace shipments aren&apos;t in this LR file (it covers retail, dedicated lanes, NSO, Q-com, non-trading and ad-hoc); they are in the RVP &amp; MP section above.</p>
        </Section>
      </div>
    </div>
  );
}
