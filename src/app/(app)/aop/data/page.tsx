import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { monLabel, Section } from "@/components/aop/processing/bits";
import { MapDrawer, RuleDecision } from "@/components/aop/warehouse/MapDrawer";
import { LogisticsUpload } from "@/components/aop/LogisticsUpload";
import { MpRateForm } from "@/components/aop/MpRateForm";
import { AssignManpower } from "@/components/aop/processing/AssignManpower";
import { canManage, requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { costMasterDiffs } from "@/server/aop/costMasterSync";
import { mpAssignments, processingMonth } from "@/server/aop/processing";
import { processingMonths } from "@/components/aop/processing/months";
import { currentSnapshot, listRules, packagingBridge, wcmMonth, wcmMonths, wcmRights } from "@/server/wcm/queries";
import { BASES, BASIS_LABEL, FAMILY_LABEL, SITES, type Basis, type Family, type Site, type Totals } from "@/server/wcm/math";
import { inr, inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Data" };
type SP = { month?: string; site?: string; basis?: string; cycle?: string };

const rs = (paise: number | null | undefined) => (paise == null ? "—" : inrFull(paise / 100));
const rsT = (t: Pick<Totals, "source" | "missing" | "lines">) => (t.lines && t.missing === t.lines ? "missing" : t.missing ? `${rs(t.source)} known` : rs(t.source));
const STATUS_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { approved: "green", draft: "amber", rejected: "red", reversed: "red", superseded: "neutral" };
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);

/** AOP › Data: everything behind the numbers — entry, uploads, Cost Master controls and mapping, head assignment, salary master. */
export default async function DataPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cycles, cycle, snap, diffs, src, rates, pmonths] = await Promise.all([listCycles(), resolveCycle(sp.cycle), currentSnapshot(), costMasterDiffs(),
    q<{ k: string; s: string | null }>(`select 'b2c' as k, max(source) as s from lg_b2c_month union all select 'b2b', max(source) from lg_b2b_lr union all select 'rvp', max(source) from lg_rvp_month union all select 'b2ccat', max(source) from lg_b2c_cat`),
    q<{ site: string; effective_from: string; monthly_salary: number; days_basis: number; ot_hourly: number | null; note: string | null }>(
      `select site, effective_from::text, monthly_salary::float8, days_basis, ot_hourly::float8, note from wcm_mp_rate order by site, effective_from desc`),
    processingMonths()]);
  const manage = canManage(u);
  const qs = cycle && cycles.length > 1 ? `?cycle=${cycle.id}` : "";
  const header = <AopHeader active="data" cycleId={cycle?.id ?? null} cycles={cycles} title="Data" subtitle="Entry, uploads and the controls behind the numbers" />;

  const pmonth = pmonths[0];
  const assigns = pmonth ? (await Promise.all((["South", "North"] as const).map((w) => mpAssignments(pmonth, w)))).flat() : [];
  const open = assigns.filter((a) => a.unassigned > 0.05);
  const pms = open.length && pmonth ? await Promise.all((["South", "North"] as const).map((w) => processingMonth(pmonth, w))) : [];

  if (!snap) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No Cost Master snapshot loaded" /></div></div>;
  const months = await wcmMonths(snap.id);
  const month = sp.month && months.includes(sp.month) ? sp.month : months.filter((m) => m < new Date().toISOString().slice(0, 7) + "-01").at(-1) ?? months.at(-1)!;
  const site: Site = (SITES as readonly string[]).includes(sp.site ?? "") ? (sp.site as Site) : "Both";
  const basis: Basis = (BASES as readonly string[]).includes(sp.basis ?? "") ? (sp.basis as Basis) : "actual";
  const href = (o: Partial<SP>) => `/aop/data?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, site, basis, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const [m, rules, rights, pkg] = await Promise.all([wcmMonth(snap.id, month, site, basis), listRules(), wcmRights(u), packagingBridge(month)]);
  const fam = (f: Family) => m.byFamily[f];
  const before: Totals = (["warehousing", "manpower", "ot"] as Family[]).reduce((a, f) => ({
    source: a.source + fam(f).source, assigned: a.assigned + fam(f).assigned, shared: a.shared + fam(f).shared, unallocated: a.unallocated + fam(f).unallocated,
    missing: a.missing + fam(f).missing, lines: a.lines + fam(f).lines }), { source: 0, assigned: 0, shared: 0, unallocated: 0, missing: 0, lines: 0 });
  const row = (label: string, t: Totals, strong = false) => (
    <tr className={strong ? "font-semibold" : undefined}>
      <td>{label}</td><td className="text-right tabular">{rsT(t)}</td><td className="text-right tabular">{rs(t.assigned)}</td><td className="text-right tabular">{rs(t.shared)}</td>
      <td className={cn("text-right tabular", t.unallocated && "text-warn")}>{rs(t.unallocated)}</td>
      <td className={cn("text-right tabular", t.missing && "text-bad")}>{t.missing ? `${t.missing} missing` : "—"}</td>
      <td className="text-right">{t.source === t.assigned + t.shared + t.unallocated ? <span className="text-ok">ties</span> : <span className="text-bad">off</span>}</td>
    </tr>);
  const wb = (what: string) => m.workbook.find((w) => w.what === what);
  const drafts = rules.filter((r) => r.status === "draft").length;

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
        <Link href={`/aop/inputs${qs}`} className="rounded-md px-2.5 py-1.5 font-medium ring-1 ring-inset ring-line hover:bg-subtle">Enter figures →</Link>
        <Link href={`/aop/import${qs}`} className="rounded-md px-2.5 py-1.5 ring-1 ring-inset ring-line hover:bg-subtle">Import plan</Link>
        <Link href={`/aop/setup${qs}`} className="rounded-md px-2.5 py-1.5 ring-1 ring-inset ring-line hover:bg-subtle">Setup</Link>
      </div>

      <div className="space-y-3">
        {manage && <Section title="Logistics files">
          <div className="p-3"><LogisticsUpload loaded={{ b2c: src.find((x) => x.k === "b2c")?.s ?? null, b2b: src.find((x) => x.k === "b2b")?.s ?? null, rvp: src.find((x) => x.k === "rvp")?.s ?? null, b2ccat: src.find((x) => x.k === "b2ccat")?.s ?? null }} /></div>
        </Section>}

        <Section open={diffs.length > 0} title="Owner figures that differ from the Cost Master" summary={<span className="tabular text-white/80">{diffs.length}</span>}>
          {diffs.length ? <div className="overflow-x-auto"><table className="table-base min-w-[720px]">
            <thead><tr><th>Line</th><th>Month</th><th>Field</th><th className="text-right">Owner entered</th><th className="text-right">Cost Master</th><th className="text-right">Difference</th></tr></thead>
            <tbody>{diffs.map((d) => (
              <tr key={`${d.section}|${d.item}|${d.period}|${d.field}`}>
                <td><span className="font-medium">{d.item}</span> <span className="text-ink-4">· {d.section}</span></td><td className="tabular">{monLabel(d.period)}</td>
                <td>{d.field === "plan" ? cycle?.labels.plan : cycle?.labels.actual}</td>
                <td className="text-right tabular">{inr(d.owner)}</td><td className="text-right tabular">{inr(d.costMaster)}</td>
                <td className="text-right tabular">{d.owner == null ? "—" : inr(d.owner - d.costMaster, { sign: true })}</td>
              </tr>))}</tbody>
          </table></div> : <p className="p-4 text-[13px] text-ok">None.</p>}
        </Section>

        {open.length > 0 && pmonth && <Section open title={`Manpower to assign · ${monLabel(pmonth)}`} summary={<span className="text-white/80">{open.length} departments</span>}>
          <div className="space-y-2 p-3">{open.map((a) => (
            <AssignManpower key={`${a.warehouse}|${a.department}`} a={a}
              options={pms.find((x) => x.warehouse === a.warehouse)!.streams.filter((s) => s.dept === a.department).flatMap((s) => s.rows.map((r) => ({ stream: s.stream, process: r.process })))} />
          ))}</div>
        </Section>}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">Warehouse Cost Master</span>
          <div className="seg"><span className="seg-label">Site</span>{SITES.map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
          <div className="seg"><span className="seg-label">Basis</span>{BASES.map((b) => <Link key={b} href={href({ basis: b })} data-on={basis === b} className="seg-item">{BASIS_LABEL[b]}</Link>)}</div>
          <div className="ml-auto flex flex-wrap gap-1">{months.map((p) => (
            <Link key={p} href={href({ month: p })} className={cn("rounded-md px-2 py-1 text-[12px]", p === month ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{monLabel(p)}</Link>))}</div>
        </div>

        <Section title="Booked controls" sub={`Source = channel-assigned + approved shared + unallocated, per line, to the paise · snapshot ${snap.id} (${snap.file_name})`}>
          <div className="overflow-x-auto"><table className="table-base min-w-[760px]">
            <thead><tr><th>Cost family</th><th className="text-right">Source</th><th className="text-right">Channel-assigned</th><th className="text-right">Shared</th><th className="text-right">Unallocated</th><th className="text-right">Coverage</th><th className="text-right">Check</th></tr></thead>
            <tbody>
              {row(FAMILY_LABEL.warehousing, fam("warehousing"))}{row(FAMILY_LABEL.manpower, fam("manpower"))}{row(FAMILY_LABEL.ot, fam("ot"))}
              {row("Warehouse before packaging", before, true)}{row(`${FAMILY_LABEL.packaging} (no site split — Both only)`, fam("packaging"))}
              {row("Warehouse total", m.total, true)}
            </tbody>
          </table></div>
          {m.workbook.length > 0 && (
            <div className="mt-3 rounded-lg border border-line p-3 text-[12.5px]">
              <div className="mb-1 font-medium">Workbook control · Storage &amp; Handling tab as of {snap.taken}</div>
              <table className="table-base"><tbody>
                <tr><td>Recorded total before packaging</td><td className="text-right tabular">{inrFull(wb("total")?.amount)}</td><td className="text-ink-4">{wb("total")?.cell}</td>
                  <td className={cn("text-right", wb("total") && Math.round(wb("total")!.amount * 100) === before.source ? "text-ok" : "text-warn")}>{wb("total") ? (Math.round(wb("total")!.amount * 100) === before.source ? "ties to source" : `differs by ${rs(before.source - Math.round(wb("total")!.amount * 100))}`) : ""}</td></tr>
                {wb("storage") && wb("storage")!.amount + wb("handling")!.amount + wb("unallocated")!.amount - wb("total")!.amount !== 0 && <tr><td>Workbook storage + handling + awaiting allocation</td><td className="text-right tabular">{inrFull(wb("storage")!.amount + wb("handling")!.amount + wb("unallocated")!.amount)}</td><td className="text-ink-4">overlap {inrFull(wb("storage")!.amount + wb("handling")!.amount + wb("unallocated")!.amount - wb("total")!.amount)}</td>
                  <td className="text-right text-warn">counted twice in the workbook — here each line sits in one bucket</td></tr>}
              </tbody></table>
              <p className="mt-1 text-ink-4">The workbook's 25 % storage / 75 % handling split of whole manpower and OT lines and its fixed percentages are not used. Lines post only through approved rules below.</p>
            </div>)}
          <div className="mt-3 grid gap-3 md:grid-cols-2 text-[12.5px]">
            {site === "Both" ? <div className="rounded-lg border border-line p-3">
              <div className="mb-1 font-medium">Packaging bridge</div>
              <table className="table-base"><tbody>
                <tr><td>Booked packaging (invoice line — the control)</td><td className="text-right tabular">{rs(m.byFamily.packaging.source)}</td></tr>
                <tr><td>Usage estimate (packages × rate) — driver only</td><td className="text-right tabular">{pkg.estimate == null ? "—" : inrFull(pkg.estimate)}</td></tr>
                <tr><td className="text-ink-4">Difference</td><td className="text-right tabular text-ink-4">{pkg.estimate == null ? "month not closed in Packaging" : rs(m.byFamily.packaging.source - Math.round(pkg.estimate * 100))}</td></tr>
              </tbody></table>
            </div> : <div className="rounded-lg border border-line p-3 text-ink-4">Packaging bridge: packaging is booked for both sites together (no site split), so it shows under Both only.</div>}
          </div>
        </Section>

        <Section title="Unallocated queue" sub="Known amounts with an open mapping — map, split or set a recurring rule; it posts once approved"
          summary={<span className="tabular text-white/80">{m.queue.length} lines · {rs(m.total.unallocated)}</span>}>
          {m.queue.length ? <div className="overflow-x-auto"><table className="table-base min-w-[860px]">
            <thead><tr><th>Cost head</th><th>Family</th><th>Site</th><th className="text-right">Open ₹</th><th>Reason</th><th>Source cell</th><th>Owner</th><th className="text-right">Age</th><th /></tr></thead>
            <tbody>{m.queue.map((x) => (
              <tr key={x.line.id}>
                <td className="font-medium">{x.line.head}{x.fnKnown && <span className="ml-1 text-[11px] text-ink-4">({x.fnKnown})</span>}</td>
                <td className="text-ink-3">{FAMILY_LABEL[x.line.family]}</td><td>{x.line.site}</td>
                <td className="text-right tabular">{rs(x.open)}</td><td className="text-ink-3">{x.reasons.join("; ")}</td>
                <td className="text-[11.5px] text-ink-4">{x.line.cell}</td><td>{x.owner}</td><td className="text-right tabular">{x.ageDays}d</td>
                <td>{rights.draft && <MapDrawer family={x.line.family} head={x.line.head} site={x.line.site} period={month} />}</td>
              </tr>))}</tbody>
          </table></div> : <p className="text-[13px] text-ok">Nothing unallocated for this filter.</p>}
        </Section>

        <Section title="Coverage gaps" sub="Expected lines with no booked amount — a missing input, never a ₹0" summary={<span className="tabular text-white/80">{m.missing.length}</span>}>
          {m.missing.length ? <table className="table-base"><thead><tr><th>Cost head</th><th>Family</th><th>Site</th><th>Source</th></tr></thead>
            <tbody>{m.missing.map((l) => <tr key={l.id}><td>{l.head}</td><td>{FAMILY_LABEL[l.family]}</td><td>{l.site}</td><td className="text-[11.5px] text-ink-4">{l.cell}</td></tr>)}</tbody></table>
            : <p className="text-[13px] text-ok">Every expected line has a booked amount.</p>}
        </Section>

        <Section title="Mapping rules" sub="Effective-dated · drafts never change a total · approved rules can be reversed; history is kept"
          summary={<span className="tabular text-white/80">{rules.length} rules{drafts ? ` · ${drafts} drafts` : ""}</span>}>
          {rules.length ? <div className="overflow-x-auto"><table className="table-base min-w-[900px]">
            <thead><tr><th>Status</th><th>Cost head</th><th>Site</th><th>From → to</th><th>Slices</th><th>Reason · driver</th><th>Drafted · decided</th><th /></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id}>
                <td><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge></td>
                <td className="font-medium">{r.head}<div className="text-[11px] text-ink-4">{FAMILY_LABEL[r.family]}</div></td>
                <td>{r.site === "*" ? "Every site" : r.site}</td><td className="tabular">{r.from.slice(0, 7)} → {r.to?.slice(0, 7) ?? "open"}</td>
                <td className="text-[12px]">{r.slices.map((s, i) => <div key={i}>{(s.share * 100).toFixed(2)}% · {s.fn ?? "function open"} · {s.shared ? "Shared" : s.channel ?? "channel open"}</div>)}</td>
                <td className="text-[12px]">{r.reason}{r.driver && <div className="text-ink-4">{r.driver}</div>}{r.evidence && <div className="text-ink-4">{r.evidence}</div>}</td>
                <td className="text-[12px]">{r.createdBy} · {r.createdAt.slice(0, 10)}{r.decidedBy && <div className="text-ink-4">{r.decidedBy} · {r.decidedAt?.slice(0, 10)}{r.decisionNote ? ` — ${r.decisionNote}` : ""}</div>}</td>
                <td>{rights.approve && <RuleDecision id={r.id} status={r.status} />}</td>
              </tr>))}</tbody>
          </table></div> : <p className="text-[13px] text-ink-3">No mapping rules yet — everything booked sits in Unallocated until owners map it.</p>}
        </Section>

        <Section title="Source lines" sub="Every terminal cell behind the totals above, with its slices" summary={<span className="tabular text-white/80">{m.lines.length}</span>}>
          <div className="overflow-x-auto"><table className="table-base min-w-[860px]">
            <thead><tr><th>Cost head</th><th>Family</th><th>Site</th><th className="text-right">Amount</th><th>Slices</th><th>Cell</th></tr></thead>
            <tbody>{m.lines.map((l) => (
              <tr key={l.id}><td>{l.head}</td><td className="text-ink-3">{FAMILY_LABEL[l.family]}</td><td>{l.site}</td>
                <td className={cn("text-right tabular", l.amount == null && "text-bad")}>{l.amount == null ? "missing" : inrFull(l.amount)}</td>
                <td className="text-[12px]">{l.slices.map((s, i) => <div key={i}>{rs(s.paise)} · {s.kind}{s.fn ? ` · ${s.fn}` : ""}{s.channel ? ` · ${s.channel}` : ""}</div>)}</td>
                <td className="text-[11.5px] text-ink-4">{l.cell}</td></tr>))}</tbody>
          </table></div>
        </Section>
        <Section title="Salary master">
          <table className="table-base mb-3"><thead><tr><th>Site</th><th>From</th><th className="text-right">Monthly ₹ / head</th><th className="text-right">Days</th><th className="text-right">₹ / day</th><th className="text-right">OT ₹ / h</th><th>Note</th></tr></thead>
            <tbody>{rates.map((r) => <tr key={r.site + r.effective_from}><td>{r.site}</td><td className="tabular">{r.effective_from}</td><td className="text-right tabular">{inrFull(r.monthly_salary)}</td><td className="text-right tabular">{r.days_basis}</td>
              <td className="text-right tabular">{r2(r.monthly_salary / r.days_basis)}</td><td className="text-right tabular">{r.ot_hourly == null ? "—" : r2(r.ot_hourly)}</td><td className="text-[12px] text-ink-3">{r.note}</td></tr>)}</tbody></table>
          {manage && <div className="p-3"><MpRateForm /></div>}
        </Section>
      </div>
    </div>
  );
}
