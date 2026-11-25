import Link from "next/link";
import { notFound } from "next/navigation";
import { FunctionsHeader } from "@/components/functions/FunctionsHeader";
import { FunctionChart, type FnChartPoint } from "@/components/aop/functions/FunctionChart";
import { n0, Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { FN } from "@/server/functions/sources";
import { fnWindow, functionView } from "@/server/functions/view";
import { categoryView, type CategoryView } from "@/server/functions/category";
import type { Cause, FnKey, FnMode, FnSite, GapPart } from "@/server/functions/types";
import type { Pointers } from "@/server/functions/slaMath";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { fnHref, fnOfSlug, parseMode, parseSite } from "@/lib/functions";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

type SP = { site?: string; mode?: string; scenario?: string; cycle?: string };
export async function generateMetadata({ params }: { params: Promise<{ fn: string }> }) {
  const fn = fnOfSlug((await params).fn);
  return { title: fn ? `Functions · ${FN[fn].label}` : "Functions" };
}
const RECEIVED: Record<FnKey, string> = { inwards: "Received", b2c_shopify: "Orders", b2c_marketplace: "Orders", b2b_retail: "Store orders", b2b_marketplace: "Orders", b2c_returns: "Returns received (packets)", b2b_returns: "Received" };
const OVERLAY: Partial<Record<FnKey, string>> = { b2c_shopify: "Within SLA", b2c_marketplace: "Within SLA", b2b_retail: "Ordered in rulebook window" };
const CAUSE: Record<Cause, string> = { plan_peak: "Plan's cover above the average day", volume: "Volume vs projection", held_up: "Work held up by issues", adhoc: "Ad-hoc work (outside BAU)", below_ipp: "Output per head against the norm",
  absenteeism: "Absenteeism above 10 %", cross_zone: "Cross-zone freight (North / South stores)", dearer_wh: "East / West shipped from the dearer warehouse", courier_rate: "Courier rates", other: "Other" };

/** Functions › one function: volume against ideal and actual manpower cost (chart first), the cost gap by cause on demand, what explains it,
 *  what is assumed or missing, and the category split. Filters (site, view, cycle, Rulebook scenario) live in the query string. */
export default async function FunctionPage({ params, searchParams }: { params: Promise<{ fn: string }>; searchParams: Promise<SP> }) {
  await requireUser();
  const [{ fn: slug }, sp] = await Promise.all([params, searchParams]);
  const fn = fnOfSlug(slug);
  if (!fn) notFound();
  const site: FnSite = parseSite(sp.site), mode: FnMode = parseMode(sp.mode);
  const rulebook = fn === "b2b_retail" && sp.scenario === "1";
  const q = { site, mode, cycle: sp.cycle, scenario: rulebook ? "1" : undefined };
  // By category needs only the window's months, so it starts with functionView instead of after it
  const [view, cats] = await Promise.all([functionView(fn, site, mode), categoryView(fn, site, fnWindow(mode).months)]);
  const href = (o: { scenario?: string }) => fnHref(fn, { ...q, ...o });

  const label = (key: string) => (mode === "day" ? fmtDate(key) : fmtMonth(key));
  const moved = rulebook && view.scenario ? new Map(view.scenario.points.map((p) => [p.key, p.received])) : null;
  const need = rulebook && view.scenario ? new Map(view.scenario.needed.map((x) => [x.key, x])) : null;
  const data: FnChartPoint[] = view.points.map((p) => ({ label: label(p.key), projected: p.projected, received: moved ? moved.get(p.key) ?? null : p.received,
    processed: p.processed, issues: p.issues, idealHeads: p.idealHeads, actualHeads: p.actualHeads, costPerUnit: p.costPerUnit, idealCostPerUnit: p.idealCostPerUnit, overlay: p.overlay,
    ...(need ? { neededAsIs: need.get(p.key)?.asIsHeads ?? null, neededRulebook: need.get(p.key)?.heads ?? null, asPlaced: p.received } : {}) }));

  return (
    <div className="animate-fade-in">
      <FunctionsHeader active={fn} q={q} title={FN[fn].label}
        subtitle={mode === "day" ? "Last 30 days to yesterday: planned, received and processed volume against the heads on the floor and what they cost."
          : "Financial year to date, month on month: volume against the heads on roll and what they cost."} />

      <div className="card mb-3 px-4 py-3">
        <FunctionChart data={data} heads={mode === "day" ? "Heads on the floor" : "Heads on roll"}
          received={moved ? "Store orders on rulebook days" : RECEIVED[fn]} overlay={OVERLAY[fn] ?? null} />
        {fn === "b2b_retail" && view.scenario && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[12.5px]">
            <div className="seg" role="group" aria-label="Rulebook scenario">
              <Link href={href({ scenario: undefined })} scroll={false} data-on={!rulebook} className="seg-item">As is</Link>
              <Link href={href({ scenario: "1" })} scroll={false} data-on={rulebook} className="seg-item">Rulebook followed</Link>
            </div>
            {rulebook && <Scenario s={view.scenario} />}
          </div>
        )}
        {view.summary.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-ink-2">{view.summary.map((s) => <p key={s}>{s}</p>)}</div>
        )}
        <CostPointers fn={fn} p={view.pointers} prepack={view.prepack} />
      </div>

      <div className="space-y-3">
        <Section title="Where the extra cost comes from" sub="Actual cost minus the cost at ideal heads, by cause; a minus is a saving. Open for the breakdown."
          summary={<GapNet parts={view.manpowerGap} />}>
          <GapTable title="Manpower" parts={view.manpowerGap} />
          {view.logisticsGap && <GapTable title="Freight" parts={view.logisticsGap} />}
        </Section>
        {(view.explain.notes.length > 0 || view.explain.adhoc.length > 0 || view.explain.sharedTeam) && <Explain e={view.explain} />}
        <Section open title="What is assumed or missing">
          <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-[12.5px] text-ink-3">{view.grey.map((g) => <li key={g}>{g}</li>)}</ul>
        </Section>
        {cats && <Categories c={cats} fn={fn} />}
      </div>
    </div>
  );
}

/** As is vs rulebook followed: the most heads the store orders needed in any period, and ₹ summed over periods with both figures. */
function Scenario({ s }: { s: NonNullable<Awaited<ReturnType<typeof functionView>>["scenario"]> }) {
  // heads: the as-placed peak period and the rulebook-days heads of that same period; ₹ summed over periods with both
  const peak = s.needed.filter((x) => x.asIsHeads != null).reduce<(typeof s.needed)[number] | null>((a, x) => (a && a.asIsHeads! >= x.asIsHeads! ? a : x), null);
  const both = s.needed.filter((x) => x.asIsCost != null && x.cost != null);
  const asIs = both.length ? both.reduce((a, x) => a + x.asIsCost!, 0) : null, rb = both.length ? both.reduce((a, x) => a + x.cost!, 0) : null;
  const lm = (x: number) => `${inr(Math.abs(x))} ${x >= 0 ? "less" : "more"}`;
  return (
    <span className="tabular text-ink-2">
      Heads needed for store orders — as placed: {n0(peak?.asIsHeads ?? null)} heads{peak ? ` in ${fmtMonth(peak.key)}` : ""}, {inr(asIs)} → on rulebook days: {n0(peak?.heads ?? null)} heads, {inr(rb)}
      <span className="block">
        Staffing sized to the store-order peak: {s.deltaManpower == null ? "—" : `${lm(s.deltaManpower)}${s.manpowerPerUnit == null ? "" : ` (₹${Math.abs(s.manpowerPerUnit).toFixed(2)} per unit)`}`}
        {" · "}Cross-zone freight: {s.deltaFreight != null ? lm(s.deltaFreight) : s.freightMissing ? `not available for ${s.freightMissing}` : "—"}
      </span>
    </span>
  );
}

/** Events, ad-hoc work outside BAU and the shared-team pattern: what the gap's "output per head" part is made of, where it is known. */
function Explain({ e }: { e: Awaited<ReturnType<typeof functionView>>["explain"] }) {
  return (
    <Section open title="What explains the gap" sub="Events and ad-hoc work outside BAU from the justification workbook; ad-hoc ₹ is taken out of output per head above.">
      {(e.notes.length > 0 || e.sharedTeam) && (
        <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-[12.5px] text-ink-2">
          {e.notes.map((x) => <li key={x.site + x.month + x.note}><span className="text-ink-4">{x.site} · {fmtMonth(x.month)} — </span>{x.note}</li>)}
          {e.sharedTeam && <li>{e.sharedTeam}</li>}
        </ul>
      )}
      {e.adhoc.length > 0 && (
        <table className="table-base">
          <thead><tr><th>Ad-hoc work</th><th>Site · month</th><th className="text-right">Man-days</th><th className="text-right">₹</th><th className="text-right">Of the unexplained gap</th></tr></thead>
          <tbody>{e.adhoc.map((a, i) => (
            <tr key={i}>
              <td>{a.task}{a.dates && <span className="ml-2 text-[11px] text-ink-4">{a.dates}</span>}{a.note && <span className="block text-[11px] text-ink-4">{a.note}</span>}</td>
              <td className="tabular">{a.site} · {fmtMonth(a.month)}</td>
              <td className="text-right tabular">{n0(a.manDays)}</td>
              <td className="text-right tabular">{inr(a.rupees)}</td>
              <td className="text-right tabular">{a.covers == null ? "—" : `${a.covers.toFixed(0)} %`}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Section>
  );
}

/** The manpower gap's net (actual − ideal), shown on the collapsed section bar. */
function GapNet({ parts }: { parts: GapPart[] }) {
  const known = parts.filter((p) => p.rupees != null);
  if (!known.length) return null;
  const net = Math.round(known.reduce((a, p) => a + p.rupees!, 0));
  return <span className="tabular text-white/85">Manpower {net >= 0 ? "over" : "under"} ideal by {inr(Math.abs(net))}</span>;
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

/** By category, month on month: share of units (top apparel categories, then the non-apparel long tail), long-tail share of shipments, inward hours. */
function Categories({ c, fn }: { c: CategoryView; fn: FnKey }) {
  const pc = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)} %`);
  const head = (first: string) => <thead><tr><th>{first}</th>{c.months.map((m) => <th key={m} className="text-right">{fmtMonth(m)}</th>)}</tr></thead>;
  const ltStart = c.units.findIndex((u) => u.longTail);
  return (
    <Section open title="By category" sub={`Share of ${fn === "inwards" || fn.endsWith("returns") ? "units put away" : "units dispatched"} by category; non-apparel (long tail) listed apart.`}>
      <table className="table-base">
        {head("Category · % of units")}
        <tbody>
          {c.units.map((u, i) => (
            <tr key={u.category} className={cn(i === ltStart && "border-t-2 border-line")}>
              <td>{i === ltStart && <span className="mr-2 text-[11px] uppercase text-ink-4">Long tail</span>}{u.category}</td>
              {u.values.map((v, j) => <td key={j} className="text-right tabular" title={n0(v)}>{pc(c.total[j] ? (100 * (v ?? 0)) / c.total[j]! : null)}</td>)}
            </tr>
          ))}
          <tr className="font-medium"><td>Units</td>{c.total.map((t, j) => <td key={j} className="text-right tabular">{n0(t)}</td>)}</tr>
        </tbody>
      </table>
      {c.shipments && (
        <table className="table-base">
          {head("Shipments holding · % of shipments")}
          <tbody>{c.shipments.map((r, i) => (
            <tr key={r.category} className={cn(i === 0 && "font-medium")}><td>{r.category}</td>{r.values.map((v, j) => <td key={j} className="text-right tabular">{pc(v)}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
      {c.courier && (
        <table className="table-base">
          <thead><tr><th>Courier ₹ per forward shipment · by what the package holds</th>{c.courier.months.map((m) => <th key={m} className="text-right">{fmtMonth(m)}</th>)}</tr></thead>
          <tbody>
            {c.courier.rows.map((r) => (
              <tr key={r.grp}><td>{r.grp}{r.grp === "Winterwear" && <span className="ml-2 text-[11px] text-ink-4">apparel, for comparison</span>}</td>
                {r.perShip.map((v, j) => <td key={j} className="text-right tabular" title={`${n0(r.ships[j])} shipments · ${r.kg[j] == null ? "—" : r.kg[j]!.toFixed(2)} kg charged`}>
                  {v == null ? "—" : `₹${v.toFixed(0)}`}<span className="ml-1.5 text-[11px] text-ink-4">{r.kg[j] == null ? "" : `${r.kg[j]!.toFixed(1)} kg`}</span></td>)}</tr>
            ))}
            <tr className="font-medium"><td>Long tail over apparel, same courier</td>{c.courier.premium.map((v, j) => <td key={j} className="text-right tabular" title={`${n0(c.courier!.premiumShips[j])} long-tail shipments`}>{inr(v)}</td>)}</tr>
          </tbody>
        </table>
      )}
      {c.courier && <p className="px-4 pb-3 pt-1 text-[11.5px] text-ink-4">From the couriers' own per-AWB bills (pre-tax, RTO included), each AWB matched to its package; both sites. Shadowfax's main forward bill has no AWBs, so it is not split.{c.courier.unpriced ? ` ${n0(c.courier.unpriced)} long-tail shipments went with couriers that carried no apparel-only parcels and are not priced.` : ""}</p>}
      {c.issues && (
        <table className="table-base">
          {head("Factory issues (issue tracker, to Oct) · qty per 100 units put away")}
          <tbody>{c.issues.map((r, i) => (
            <tr key={r.category} className={cn(i === 0 && "font-medium")}><td>{r.category}</td>{r.values.map((v, j) => <td key={j} className="text-right tabular">{v == null ? "—" : v.toFixed(1)}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
      {c.hours && (
        <table className="table-base">
          {head("Gate entry → last putaway · median hours")}
          <tbody>{c.hours.map((r) => (
            <tr key={r.category}><td>{r.category}</td>{r.values.map((v, j) => <td key={j} className="text-right tabular">{v ?? "—"}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
    </Section>
  );
}

const TAT_LABEL = (d: number) => (d === 0 ? "same day" : d === 1 ? "24 h" : `${d * 24} h`);
const SLA_RULE: Record<FnKey, string> = { inwards: "gate entry → putaway within 24 h", b2c_shopify: "dispatched by the TAT deadline", b2c_marketplace: "dispatched by the TAT deadline",
  b2b_retail: "handed over by the handover deadline", b2b_marketplace: "no TAT; capacity 5,000 items a day", b2c_returns: "received → processed within 2 days", b2b_returns: "received → processed within 2 days" };

/** Where cost can come down (Malhar M, 25 Nov 2026): SLA → actual → a team at the projected average day → what it misses when volume runs above → heads by TAT. */
function CostPointers({ fn, p, prepack }: { fn: FnKey; p: Pointers; prepack: string[] }) {
  const rs = (x: number | null) => (x == null ? "—" : `₹${x.toFixed(2)}`);
  return (
    <div className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-4">Where cost can come down</div>
      <ul className="list-disc space-y-1 pl-5">
        <li><span className="font-medium">SLA</span> ({SLA_RULE[fn]}): {p.sla.pct == null ? (fn === "b2b_marketplace" ? "not measured" : "no data for this period") : `${p.sla.pct.toFixed(1)} % on time, ${n0(p.sla.missed)} of ${n0(p.sla.judged)} units missed it`}.</li>
        <li><span className="font-medium">Actual cost</span> on the days attendance is in: {n0(p.actual.heads)} heads a day, {inr(p.actual.rupees)}, {rs(p.actual.perUnit)} per unit.</li>
        {p.team && (
          <li><span className="font-medium">{fn === "b2b_marketplace" ? "A team sized to 5,000 items a day" : "A team at the projected average day"}</span>: {n0(p.team.heads)} heads a day would cost {inr(p.team.rupees)} ({rs(p.team.perUnit)} per unit)
            {p.team.saving != null && <>, <span className={p.team.saving > 0 ? "font-medium text-ok" : "text-warn"}>{inr(Math.abs(p.team.saving))} {p.team.saving > 0 ? "less" : "more"}</span> than actual</>} — enough for BAU days.</li>
        )}
        {p.above && (
          <li><span className="font-medium">When volume runs above it</span>: on {n0(p.above.exceedDays)} days volume was above that team's capacity; holding the team, about {n0(p.above.breachUnits)} units ({p.above.pct == null ? "—" : `${p.above.pct.toFixed(1)} %`}) {fn === "b2b_marketplace" ? "would not be cleared the same day" : "would miss the SLA"}. Cost stays the same — the excess turns into breaches, not extra heads.</li>
        )}
        {prepack.map((x) => <li key={x}><span className="font-medium">Pre-packs</span> — {x}</li>)}
      </ul>
      {p.byTat.length > 0 && (
        <div className="mt-2.5 overflow-x-auto">
          <table className="table-base max-w-[520px]">
            <thead><tr><th>If the SLA were</th><th className="text-right">Heads a day to hold it</th><th className="text-right">₹ over this period</th></tr></thead>
            <tbody>{p.byTat.map((t) => (
              <tr key={t.tatDays} className={t.current ? "font-medium" : undefined}>
                <td>{TAT_LABEL(t.tatDays)}{t.current && <span className="ml-1.5 text-[11px] text-ink-4">current</span>}</td>
                <td className="text-right tabular">{t.heads == null ? "—" : t.heads.toFixed(1)}</td>
                <td className="text-right tabular">{inr(t.rupees)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-1 text-[11.5px] text-ink-4">Heads to clear every unit within the SLA over this period's busiest run of days. A longer SLA spreads the peaks, so fewer heads hold it.</p>
        </div>
      )}
    </div>
  );
}
