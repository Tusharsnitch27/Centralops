import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FunctionsHeader } from "@/components/functions/FunctionsHeader";
import { OverviewTrend, type TrendPoint } from "@/components/functions/OverviewTrend";
import { n0, n1, Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { FN_LABEL, functionsOverview, ROWS, type Agg, type Key, type OverviewData } from "@/server/functions/overview";
import { OVERVIEW_FN, SUPPORT_TXN } from "@/server/functions/overviewMath";
import type { FnKey } from "@/server/functions/types";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { fnHref, parseMode, parseSite } from "@/lib/functions";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Functions · Overview" };
type SP = { site?: string; mode?: string; cycle?: string };

/** Functions › Overview: actuals only — heads present, transactions completed, booked payroll — per function, with drill-downs. */
export default async function FunctionsOverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const site = parseSite(sp.site), mode = parseMode(sp.mode), q = { site, mode, cycle: sp.cycle };
  // payroll is monthly: the cost tiles always read the month view (light: three queries), the rest follows the chosen view
  const [view, months] = await Promise.all([functionsOverview(site, mode), mode === "month" ? null : functionsOverview(site, "month")]);
  const m = months ?? view;
  const costMonth = [...m.periods].reverse().find((p) => p.cells.total.perTxn != null || p.cells.total.cost != null);
  const booked = m.periods.filter((p) => p.cells.total.cost != null);
  const totalCost = booked.length ? booked.reduce((a, p) => a + p.cells.total.cost!, 0) : null;
  const label = (k: string) => (mode === "day" ? fmtDate(k) : fmtMonth(`${k}-01`));
  const partial = (a: Agg) => a.days < a.of;
  const trend: TrendPoint[] = view.periods.map((p) => ({ label: label(p.key) + (mode === "month" && p.key === view.mtd ? " MTD" : ""), txn: p.cells.total.txn, heads: p.cells.total.heads,
    partial: partial(p.cells.total) || (mode === "month" && p.key === view.mtd), perTxn: p.cells.total.perTxn }));
  const w = view.window;

  return (
    <div className="animate-fade-in">
      <FunctionsHeader active="overview" q={q} title="Functions"
        subtitle={`Actuals only: heads present, transactions completed and booked payroll, ${mode === "day" ? `last 30 days to ${fmtDate(view.to)}` : `financial year to ${fmtDate(view.to)}`}.`} />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Heads worked" value={n0(w.total.heads)} foot={`a day on average · ${n0(w.total.headDays)} head-days`}
          hint="Attendance: people present per day, every department counted once, averaged over the days with attendance." />
        <Tile label="Items handled" value={n0(w.total.txn)} foot={partial(w.total) ? `${w.total.days} of ${w.total.of} days fully covered` : "items put away, dispatched and moved"}
          tone={partial(w.total) ? "warn" : undefined} hint="Items handled across every warehouse activity: pieces put away (inward, returns), items dispatched, pieces moved in inventory audits. An item is counted at each activity it passes through (put away, later dispatched)." />
        <Tile label="Payroll per head" value={costMonth?.cells.total.salary == null ? "—" : inr(costMonth.cells.total.salary)} foot={costMonth ? `${fmtMonth(`${costMonth.key}-01`)} · a month, booked` : "no booked month"}
          hint="Booked manpower (Cost Master) ÷ heads on roll; heads on roll = head-days present ÷ 23 working days. OT is excluded." />
        <Tile label="Cost per item handled" value={costMonth?.cells.total.perTxn == null ? "—" : `₹${costMonth.cells.total.perTxn.toFixed(2)}`} foot={costMonth ? `${fmtMonth(`${costMonth.key}-01`)} · manpower + OT` : "no booked month"}
          hint="Booked manpower + OT ÷ items handled, same site and month; a dash when any day's feed is missing." />
        <Tile label="Manpower cost" value={inr(totalCost)} foot={booked.length ? `${booked.map((p) => fmtMonth(`${p.key}-01`).split(" ")[0]).join(", ")} booked` : "nothing booked"}
          hint="Booked payroll (Monthly Manpower Cost + Monthly OT, Cost Master → AOP). Months without a booked figure are left out, not estimated." />
      </div>

      <div className="card mb-3 px-4 py-3">
        <OverviewTrend data={trend} />
      </div>

      <div className="space-y-3">
        <FunctionTable d={view} q={q} />
        {mode === "month" && <MonthTable d={view} />}
        <Section title="How these are counted" sub="Metric definitions and the source gaps that keep some figures blank.">
          <Definitions d={view} />
        </Section>
      </div>
    </div>
  );
}

function Tile({ label, value, foot, hint, tone }: { label: string; value: string; foot: string; hint: string; tone?: "warn" }) {
  return (
    <div className="card flex min-w-0 flex-col gap-2.5 p-4" title={hint}>
      <div className="truncate text-[12px] font-medium text-ink-3">{label}</div>
      <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] tabular text-ink">{value}</div>
      <div className={cn("truncate text-[11.5px]", tone === "warn" ? "font-medium text-warn" : "text-ink-4")}>{foot}</div>
    </div>
  );
}

/** One row per function, then support and the warehouse total; each function opens its page with the filters carried across. */
function FunctionTable({ d, q }: { d: OverviewData; q: Parameters<typeof fnHref>[1] }) {
  const cov = (a: Agg) => <span className={cn("tabular", a.days < a.of ? "text-warn" : "text-ink-3")}>{a.days < a.of ? `${a.days} / ${a.of} days` : "full"}</span>;
  const row = (k: Key) => {
    const a = d.window[k], fn = k === "support" || k === "total" ? null : (k as FnKey);
    const perHeadDay = a.txn != null && a.headDays ? a.txn / a.headDays : null;
    return (
      <tr key={k} className={cn(k === "total" && "font-medium", k === "support" && "text-ink-3")}>
        <td>
          {fn ? <Link href={fnHref(fn, q)} className="group inline-flex items-center gap-1 font-medium text-ink hover:text-accent-ink">{FN_LABEL(k)}<ChevronRight size={13} className="text-ink-4 group-hover:text-accent-ink" /></Link> : FN_LABEL(k)}
          {fn && <span className="block text-[11px] text-ink-4">{OVERVIEW_FN[fn].txn.unit}</span>}
          {k === "support" && <span className="block text-[11px] text-ink-4">{SUPPORT_TXN.unit}</span>}
          {k === "total" && <span className="block text-[11px] font-normal text-ink-4">items handled, every activity</span>}
        </td>
        <td className="text-right tabular">{n1(a.heads)}</td>
        <td className="text-right tabular">{n0(a.headDays)}</td>
        <td className="text-right tabular">{n0(a.txn)}</td>
        <td className="text-right tabular" title={fn ? OVERVIEW_FN[fn].units.unit : undefined}>{k === "support" || k === "total" ? "—" : n0(a.units)}</td>
        <td className="text-right tabular">{n1(perHeadDay)}</td>
        <td className="text-right tabular" title={fn ? "Payroll is booked per site and month, not per function: no actual. The function page estimates it from attendance × salary." : undefined}>
          {k === "total" ? (a.perTxn == null ? "—" : `₹${a.perTxn.toFixed(2)}`) : "—"}
        </td>
        <td className="text-right">{cov(a)}</td>
      </tr>
    );
  };
  return (
    <Section open title="By function" sub="Average daily heads present, head-days and items handled (transactions), with packages / putaway lines alongside. Open a function for its volume, ideal and cost.">
      <div className="overflow-x-auto">
        <table className="table-base min-w-[860px]">
          <thead><tr><th>Function · counts</th><th className="text-right">Heads a day</th><th className="text-right">Head-days</th><th className="text-right">Items handled</th>
            <th className="text-right">Packages / putaway lines</th><th className="text-right">Items per head-day</th><th className="text-right">₹ per item</th><th className="text-right">Coverage</th></tr></thead>
          <tbody>{ROWS.map(row)}</tbody>
        </table>
      </div>
      <div className="space-y-0.5 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        {d.pools.map((p) => (
          <p key={p.dept}><span className="font-medium text-ink-2">{p.dept}</span> {n1(p.heads)} heads a day, shared: {p.parts.map((x) => `${FN_LABEL(x.fn)} ${n1(x.heads)}`).join(" + ")} — split by the channel weights AOP › Processing uses, so the parts add back to the team.</p>
        ))}
      </div>
    </Section>
  );
}

/** Month on month, warehouse total: the month-to-date month and partial coverage marked; ratios from summed figures. */
function MonthTable({ d }: { d: OverviewData }) {
  return (
    <Section open title="Month on month" sub="Warehouse total. Cost, payroll per head and ₹ per item only where payroll is booked and the month is fully covered.">
      <div className="overflow-x-auto">
        <table className="table-base min-w-[760px]">
          <thead><tr><th>Month</th><th className="text-right">Heads a day</th><th className="text-right">Head-days</th><th className="text-right">Items handled</th><th className="text-right">Manpower + OT</th>
            <th className="text-right">Payroll per head</th><th className="text-right">₹ per item</th><th className="text-right">Coverage</th></tr></thead>
          <tbody>{d.periods.map((p) => {
            const t = p.cells.total;
            return (
              <tr key={p.key}>
                <td>{fmtMonth(`${p.key}-01`)}{p.key === d.mtd && <span className="ml-2 rounded bg-warn-soft px-1.5 text-[11px] font-medium text-warn">MTD</span>}</td>
                <td className="text-right tabular">{n1(t.heads)}</td>
                <td className="text-right tabular">{n0(t.headDays)}</td>
                <td className="text-right tabular">{n0(t.txn)}</td>
                <td className="text-right tabular">{inr(t.cost)}</td>
                <td className="text-right tabular">{t.salary == null ? "—" : inr(t.salary)}</td>
                <td className="text-right tabular">{t.perTxn == null ? "—" : `₹${t.perTxn.toFixed(2)}`}</td>
                <td className={cn("text-right tabular", t.days < t.of ? "text-warn" : "text-ink-3")}>{t.days < t.of ? `${t.days} / ${t.of} days` : "full"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Section>
  );
}

function Definitions({ d }: { d: OverviewData }) {
  return (
    <div className="space-y-3 px-4 py-3 text-[12.5px] text-ink-2">
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[180px_1fr]">
        <dt className="font-medium">Heads a day</dt><dd className="text-ink-3">People present per day from attendance (day × site × department), every department once; a month is the average over its days with attendance. Teams that serve two functions (B2C Forward, B2B Forward) are split by AOP › Processing's channel weights.</dd>
        <dt className="font-medium">Transactions</dt><dd className="text-ink-3">Items handled: pieces put away (putaway completed quantity — inward and both returns; the inward team, unloaders included, over the pieces they bring in, never per box), items dispatched (forward), pieces moved in inventory audits (support). The total adds every activity, so an item is counted again at each step it passes through.</dd>
        <dt className="font-medium">Packages / putaway lines</dt><dd className="text-ink-3">The secondary count: UC shipping packages dispatched (a store or marketplace consignment is one) and putaway lines (one SKU into one bin).</dd>
        <dt className="font-medium">Manpower cost</dt><dd className="text-ink-3">Booked payroll only: Monthly Manpower Cost + Monthly OT per site and month (Cost Master → AOP). No estimate is shown here.</dd>
        <dt className="font-medium">₹ per item</dt><dd className="text-ink-3">Σ manpower + OT ÷ Σ items handled over the same site and month, only when every day is covered; a dash otherwise.</dd>
        <dt className="font-medium">Payroll per head</dt><dd className="text-ink-3">Booked manpower ÷ heads on roll (head-days present ÷ 23 working days), a month with full attendance.</dd>
      </dl>
      <ul className="list-disc space-y-1 pl-5 text-ink-3">{d.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
    </div>
  );
}
