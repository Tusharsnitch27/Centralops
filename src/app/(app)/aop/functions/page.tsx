import Link from "next/link";
import { AopHeader } from "@/components/aop/AopNav";
import { FunctionChart, type FnChartPoint } from "@/components/aop/functions/FunctionChart";
import { n0, Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { FN } from "@/server/functions/sources";
import { functionView } from "@/server/functions/view";
import type { Cause, FnKey, FnMode, FnSite, GapPart } from "@/server/functions/types";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Functions" };

type SP = { fn?: string; site?: string; mode?: string; scenario?: string; cycle?: string };
const FNS = Object.keys(FN) as FnKey[];
const RECEIVED: Record<FnKey, string> = { inwards: "Received", b2c_shopify: "Orders", b2c_marketplace: "Orders", b2b_retail: "Store orders", b2b_marketplace: "Orders", returns: "Returns received" };
const OVERLAY: Partial<Record<FnKey, string>> = { b2c_shopify: "Within SLA", b2c_marketplace: "Within SLA", b2b_retail: "Ordered in rulebook window" };
const CAUSE: Record<Cause, string> = { plan_peak: "Plan's cover for its busiest day", volume: "Volume vs projection", held_up: "Work held up by issues", below_ipp: "Output per head against the norm",
  absenteeism: "Absenteeism above 10 %", cross_zone: "Cross-zone freight", courier_rate: "Courier rates", other: "Other" };

/** AOP › Functions: per function, volume against ideal and actual manpower cost, the cost gap split into causes, and what is assumed or missing. */
export default async function FunctionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const fn: FnKey = FNS.includes(sp.fn as FnKey) ? (sp.fn as FnKey) : "b2b_retail";
  const site: FnSite = sp.site === "South" || sp.site === "North" ? sp.site : "Both";
  const mode: FnMode = sp.mode === "month" ? "month" : "day";
  const rulebook = fn === "b2b_retail" && sp.scenario === "1";
  const [cycles, cycle, view] = await Promise.all([listCycles(), resolveCycle(sp.cycle), functionView(fn, site, mode)]);
  const href = (o: Partial<SP>) => {
    const p = { cycle: cycles.length > 1 ? cycle?.id : undefined, fn, site, mode, scenario: rulebook ? "1" : undefined, ...o };
    if (p.fn !== "b2b_retail") p.scenario = undefined;
    return `/aop/functions?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`;
  };

  const label = (key: string) => (mode === "day" ? fmtDate(key) : fmtMonth(key));
  const moved = rulebook && view.scenario ? new Map(view.scenario.points.map((p) => [p.key, p.received])) : null;
  const data: FnChartPoint[] = view.points.map((p) => ({ label: label(p.key), projected: p.projected, received: moved ? moved.get(p.key) ?? null : p.received,
    processed: p.processed, issues: p.issues, idealHeads: p.idealHeads, actualHeads: p.actualHeads, costPerUnit: p.costPerUnit, idealCostPerUnit: p.idealCostPerUnit, overlay: p.overlay }));

  return (
    <div className="animate-fade-in">
      <AopHeader active="functions" cycleId={cycle?.id ?? null} cycles={cycles} title="Functions"
        subtitle="Planned, received and processed volume per function, against the manpower cost it should take and what it cost." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg">
          {FNS.map((k) => <Link key={k} href={href({ fn: k })} scroll={false} data-on={k === fn} className="seg-item">{FN[k].label}</Link>)}
        </div>
        <div className="seg">
          <span className="seg-label">Site</span>
          {(["Both", "South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} scroll={false} data-on={s === site} className="seg-item">{s}</Link>)}
        </div>
        <div className="seg">
          <Link href={href({ mode: "day" })} scroll={false} data-on={mode === "day"} className="seg-item">Last 30 days</Link>
          <Link href={href({ mode: "month" })} scroll={false} data-on={mode === "month"} className="seg-item">Month on month</Link>
        </div>
      </div>

      <div className="card mb-3 px-4 py-3">
        <FunctionChart data={data} heads={mode === "day" ? "Heads on the floor" : "Heads on roll"}
          received={moved ? "Store orders on rulebook days" : RECEIVED[fn]} overlay={OVERLAY[fn] ?? null} />
        {fn === "b2b_retail" && view.scenario && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[12.5px]">
            <div className="seg">
              <Link href={href({ scenario: undefined })} scroll={false} data-on={!rulebook} className="seg-item">As is</Link>
              <Link href={href({ scenario: "1" })} scroll={false} data-on={rulebook} className="seg-item">Rulebook followed</Link>
            </div>
            {rulebook && <Scenario s={view.scenario} mode={mode} />}
          </div>
        )}
        {view.summary.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-ink-2">{view.summary.map((s) => <p key={s}>{s}</p>)}</div>
        )}
      </div>

      <div className="space-y-3">
        <Section open title="Where the extra cost comes from" sub="Actual cost minus the cost at ideal heads, by cause; a minus is a saving.">
          <GapTable title="Manpower" parts={view.manpowerGap} />
          {view.logisticsGap && <GapTable title="Freight" parts={view.logisticsGap} />}
        </Section>
        <Section open title="What is assumed or missing">
          <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-[12.5px] text-ink-3">{view.grey.map((g) => <li key={g}>{g}</li>)}</ul>
        </Section>
      </div>
    </div>
  );
}

/** As is vs rulebook followed: the most heads the store orders needed in any period, and ₹ summed over periods with both figures. */
function Scenario({ s, mode }: { s: NonNullable<Awaited<ReturnType<typeof functionView>>["scenario"]>; mode: FnMode }) {
  const max = (xs: (number | null)[]) => (xs.some((x) => x != null) ? Math.max(...xs.filter((x): x is number => x != null)) : null);
  const both = s.needed.filter((x) => x.asIsCost != null && x.cost != null);
  const asIs = both.length ? both.reduce((a, x) => a + x.asIsCost!, 0) : null, rb = both.length ? both.reduce((a, x) => a + x.cost!, 0) : null;
  const d = s.deltaRupees;
  return (
    <span className="tabular text-ink-2">
      As is: {n0(max(s.needed.map((x) => x.asIsHeads)))} heads, {inr(asIs)} → Rulebook followed: {n0(max(s.needed.map((x) => x.heads)))} heads, {inr(rb)}
      {" · "}{d == null ? "saving —" : `${d >= 0 ? "saves" : "costs"} ${inr(Math.abs(d))}${s.deltaPerUnit == null ? "" : ` (₹${Math.abs(s.deltaPerUnit).toFixed(2)} per unit)`}${d >= 0 ? "" : " more"}`}
      <span className="block text-[11.5px] text-ink-4">Heads are the most needed on any one {mode === "day" ? "day" : "month"}; the saving includes cross-zone freight.</span>
    </span>
  );
}

function GapTable({ title, parts }: { title: string; parts: GapPart[] }) {
  const rows = [...parts.filter((p) => p.cause !== "other"), ...parts.filter((p) => p.cause === "other")];
  return (
    <table className="table-base">
      <thead><tr><th>{title}</th><th className="text-right">₹</th><th>Note</th></tr></thead>
      <tbody>{rows.map((p) => {
        const r = p.rupees == null ? null : Math.round(p.rupees) || 0; // whole rupees before sign and colour (no red "+₹0")
        return (
          <tr key={p.cause}>
            <td>{CAUSE[p.cause]}</td>
            <td className={cn("text-right tabular", r == null ? "text-ink-4" : r > 0 ? "text-bad" : r < 0 ? "text-ok" : "text-ink-3")}>{inr(r, { sign: true })}</td>
            <td className="text-ink-3">{p.note}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
