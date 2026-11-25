import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FunctionsHeader } from "@/components/functions/FunctionsHeader";
import { OverviewTrend, type TrendPoint } from "@/components/functions/OverviewTrend";
import { n0, n1, Section } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { FN_LABEL, functionsOverview, ROWS, type Agg, type Basis, type Key, type OverviewData } from "@/server/functions/overview";
import { OVERVIEW_FN, SUPPORT_TXN } from "@/server/functions/overviewMath";
import type { FnKey } from "@/server/functions/types";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { fnHref, parseMode, parseSite } from "@/lib/functions";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Functions · Overview" };
type SP = { site?: string; mode?: string; cycle?: string };

const rs = (x: number | null) => (x == null ? "—" : `₹${x.toFixed(2)}`);
/** Booked payroll is shown plain; the salary calculation (head-days × salary master ÷ 23) carries a mark, explained under the table. */
const Mark = ({ b }: { b: Basis | null }) => (b === "calculated" || b === "mixed" ? <span className="ml-0.5 text-warn" title={b === "calculated" ? "salary calculation (no booked payroll)" : "part booked payroll, part salary calculation"}>*</span> : null);

/** Functions › Overview: heads present, items handled and manpower cost — per function, with drill-downs. */
export default async function FunctionsOverviewPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const site = parseSite(sp.site), mode = parseMode(sp.mode), q = { site, mode, cycle: sp.cycle };
  const view = await functionsOverview(site, mode);
  const label = (k: string) => (mode === "day" ? fmtDate(k) : fmtMonth(`${k}-01`));
  const partial = (a: Agg) => a.days < a.of;
  const trend: TrendPoint[] = view.periods.map((p) => ({ label: label(p.key) + (mode === "month" && p.key === view.mtd ? " MTD" : ""), txn: p.cells.total.txn, heads: p.cells.total.heads,
    partial: partial(p.cells.total) || (mode === "month" && p.key === view.mtd), perTxn: p.cells.total.perTxn }));
  const w = view.window, span = mode === "day" ? "last 30 days" : "financial year to date";
  const basisFoot = (b: Basis | null) => (b === "booked" ? "booked payroll" : b === "calculated" ? "salary calculation*" : b === "mixed" ? "booked + salary calculation*" : "no cost");

  return (
    <div className="animate-fade-in">
      <FunctionsHeader active="overview" q={q} title="Functions"
        subtitle={`Heads present, items handled and what they cost, ${mode === "day" ? `last 30 days to ${fmtDate(view.to)}` : `financial year to ${fmtDate(view.to)}`}.`} />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Heads worked" value={n0(w.total.heads)} foot={`a day on average · ${n0(w.total.headDays)} head-days`}
          hint="Attendance: people present per day, every department counted once, averaged over the days with attendance." />
        <Tile label="Items handled" value={n0(w.total.txn)} foot={partial(w.total) ? `${w.total.days} of ${w.total.of} days covered` : "put away, dispatched and moved"}
          tone={partial(w.total) ? "warn" : undefined} hint="Items handled across every warehouse activity: pieces put away (inward, returns), items dispatched, pieces moved in inventory audits. An item is counted at each activity it passes through (put away, later dispatched)." />
        <Tile label="Payroll per head" value={w.total.salary == null ? "—" : inr(w.total.salary)} foot={`a month · ${basisFoot(w.total.basis)}`}
          hint="Manpower cost (excl. OT) ÷ heads on roll; heads on roll = head-days present ÷ 23 working days. Booked payroll where the Cost Master has it, else the salary master." />
        <Tile label="Cost per item handled" value={rs(w.total.perTxn)} foot={`${span} · ${basisFoot(w.total.basis)}`}
          hint="Manpower cost ÷ items handled over the same covered days (attendance and the items feed both in)." />
        <Tile label="Manpower cost" value={inr(w.total.cost)} foot={`${w.total.days} covered days · ${basisFoot(w.total.basis)}`}
          hint="Booked payroll (Monthly Manpower Cost + OT) for Aug–Oct where booked; other months the salary calculation (head-days × salary master ÷ 23, no OT). Covered days only." />
      </div>

      <div className="card mb-3 px-4 py-3">
        <OverviewTrend data={trend} />
      </div>

      <div className="space-y-3">
        <FunctionTable d={view} q={q} />
        {mode === "month" && <MonthTable d={view} />}
        <Section title="How these are counted" sub="Metric definitions, the cost basis and the source gaps.">
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

const Cov = ({ a }: { a: Agg }) => <span className={cn("tabular", a.days < a.of ? "text-warn" : "text-ink-3")}>{a.days < a.of ? `${a.days} / ${a.of} days` : "full"}</span>;

/** One row per function, then support and the warehouse total; each function opens its page with the filters carried across. */
function FunctionTable({ d, q }: { d: OverviewData; q: Parameters<typeof fnHref>[1] }) {
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
        <td className="text-right tabular">{inr(a.cost)}<Mark b={a.basis} /></td>
        <td className="text-right tabular">{rs(a.perTxn)}</td>
        <td className="text-right"><Cov a={a} /></td>
        <td className="text-right tabular" title={fn ? undefined : "SLA is per function"}>{a.sla == null ? "—" : `${a.sla.toFixed(1)} %`}</td>
      </tr>
    );
  };
  return (
    <Section open title="By function" sub="Heads present, items handled and their cost over the covered days; packages / putaway lines alongside. Open a function for its volume, ideal and cost.">
      <div className="overflow-x-auto">
        <table className="table-base min-w-[940px]">
          <thead><tr><th>Function · counts</th><th className="text-right">Heads a day</th><th className="text-right">Head-days</th><th className="text-right">Items handled</th>
            <th className="text-right" title="Packages dispatched / putaway lines">Packages / lines</th><th className="text-right">Items / head-day</th><th className="text-right">Cost</th><th className="text-right">₹ per item</th><th className="text-right">Coverage</th>
            <th className="text-right" title="On time against the function's SLA: inward ≤ 24 h, B2C by the TAT deadline, B2B Retail by the handover deadline, returns ≤ 2 days received → processed; B2B Marketplace has no TAT">SLA</th></tr></thead>
          <tbody>{ROWS.map(row)}</tbody>
        </table>
      </div>
      <div className="space-y-0.5 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        {d.pools.map((p) => (
          <p key={p.dept}><span className="font-medium text-ink-2">{p.dept}</span> {n1(p.heads)} heads a day, shared: {p.parts.map((x) => `${FN_LABEL(x.fn)} ${n1(x.heads)}`).join(" + ")}
            {p.dept === "B2B Forward" ? " — split by each month's workload (items dispatched ÷ units per head)." : " — split by AOP › Processing's channel weights."}</p>
        ))}
        <p><span className="text-warn">*</span> salary calculation (head-days × salary master ÷ 23, no OT) where payroll is not booked. A function's cost is its head-days at the site's monthly rate per head-day, so the rows add up to the total.</p>
      </div>
    </Section>
  );
}

/** Month on month, warehouse total: the month-to-date month and partial coverage marked; ratios from summed figures over covered days. */
function MonthTable({ d }: { d: OverviewData }) {
  return (
    <Section open title="Month on month" sub="Warehouse total over each month's covered days. Booked payroll Aug–Oct; other months the salary calculation (*).">
      <div className="overflow-x-auto">
        <table className="table-base min-w-[760px]">
          <thead><tr><th>Month</th><th className="text-right">Heads a day</th><th className="text-right">Head-days</th><th className="text-right">Items handled</th><th className="text-right">Manpower cost</th>
            <th className="text-right">Payroll per head</th><th className="text-right">₹ per item</th><th className="text-right">Coverage</th></tr></thead>
          <tbody>{d.periods.map((p) => {
            const t = p.cells.total;
            return (
              <tr key={p.key}>
                <td>{fmtMonth(`${p.key}-01`)}{p.key === d.mtd && <span className="ml-2 rounded bg-warn-soft px-1.5 text-[11px] font-medium text-warn">MTD</span>}</td>
                <td className="text-right tabular">{n1(t.heads)}</td>
                <td className="text-right tabular">{n0(t.headDays)}</td>
                <td className="text-right tabular">{n0(t.txn)}</td>
                <td className="text-right tabular">{inr(t.cost)}<Mark b={t.basis} /></td>
                <td className="text-right tabular">{t.salary == null ? "—" : inr(t.salary)}</td>
                <td className="text-right tabular">{rs(t.perTxn)}</td>
                <td className="text-right"><Cov a={t} /></td>
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
        <dt className="font-medium">Heads a day</dt><dd className="text-ink-3">People present per day from attendance (day × site × department), every department once; a month is the average over its days with attendance. B2C Forward is split between Shopify and Marketplace by AOP › Processing's channel weights; B2B Forward between Retail and Marketplace by each month's workload.</dd>
        <dt className="font-medium">Items handled</dt><dd className="text-ink-3">The transaction: pieces put away (putaway completed quantity — inward and both returns; the inward team, unloaders included, over the pieces they bring in, never per box), items dispatched (forward), pieces moved in inventory audits (support). The total adds every activity, so an item is counted again at each step it passes through.</dd>
        <dt className="font-medium">Packages / putaway lines</dt><dd className="text-ink-3">The secondary count: UC shipping packages dispatched (a store or marketplace consignment is one) and putaway lines (one SKU into one bin).</dd>
        <dt className="font-medium">Manpower cost</dt><dd className="text-ink-3">Booked payroll (Monthly Manpower Cost + Monthly OT, Cost Master → AOP) where booked; else the salary calculation (head-days present × salary master ÷ 23, no OT), marked *. Spread over the month's head-days: a row's cost is its head-days at that rate, over its covered days.</dd>
        <dt className="font-medium">₹ per item</dt><dd className="text-ink-3">Manpower cost ÷ items handled over the same covered days (attendance and the items feed both in); days without either are left out of both.</dd>
        <dt className="font-medium">Payroll per head</dt><dd className="text-ink-3">Manpower cost excluding OT ÷ heads on roll (head-days present ÷ 23 working days), a month.</dd>
      </dl>
      <ul className="list-disc space-y-1 pl-5 text-ink-3">{d.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
    </div>
  );
}
