import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { monLabel, Section } from "@/components/aop/processing/bits";
import { MapDrawer, RuleDecision } from "@/components/aop/warehouse/MapDrawer";
import { requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { channelView, currentSnapshot, legacyDualRead, listRules, packagingBridge, wcmMonth, wcmMonths, wcmRights } from "@/server/wcm/queries";
import { BASES, BASIS_LABEL, FAMILY_LABEL, SITES, type Basis, type Family, type Site, type Totals } from "@/server/wcm/math";
import { inrFull } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Warehouse cost master" };
type SP = { month?: string; site?: string; basis?: string; cycle?: string };

const rs = (paise: number | null | undefined) => (paise == null ? "—" : inrFull(paise / 100));
/** A total with missing lines is never shown as a plain figure: all missing ⇒ "missing", some ⇒ "₹x known". */
const rsT = (t: Pick<Totals, "source" | "missing" | "lines">) => (t.lines && t.missing === t.lines ? "missing" : t.missing ? `${rs(t.source)} known` : rs(t.source));
const STATUS_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { approved: "green", draft: "amber", rejected: "red", reversed: "red", superseded: "neutral" };

/**
 * AOP › Warehouse: booked warehouse cost from the Cost Master's source cells, cut into channel-assigned, approved-shared and
 * unallocated slices by approved rules only. Every figure here is a sum of source lines; nothing is estimated.
 */
export default async function WarehousePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cycles, cycle, snap] = await Promise.all([listCycles(), resolveCycle(sp.cycle), currentSnapshot()]);
  const header = <AopHeader active="warehouse" cycleId={cycle?.id ?? null} cycles={cycles} title="Warehouse cost master"
    subtitle="Booked warehouse spend by site, function and channel — every rupee once, traced to its source cell; unmapped money stays Unallocated."
    actions={<Link href="/aop/warehouse/3pl" className="text-[12.5px] text-ink-3 hover:text-ink">3PL comparison →</Link>} />;
  if (!snap) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No Cost Master snapshot loaded" body="The 20 Nov 2026 Cost Master snapshot loads at the next boot." /></div></div>;

  const months = await wcmMonths(snap.id);
  const month = sp.month && months.includes(sp.month) ? sp.month : months.filter((m) => m < new Date().toISOString().slice(0, 7) + "-01").at(-1) ?? months.at(-1)!;
  const site: Site = (SITES as readonly string[]).includes(sp.site ?? "") ? (sp.site as Site) : "Both";
  const basis: Basis = (BASES as readonly string[]).includes(sp.basis ?? "") ? (sp.basis as Basis) : "actual";
  const href = (o: Partial<SP>) => `/aop/warehouse?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, site, basis, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const [m, rules, rights] = await Promise.all([wcmMonth(snap.id, month, site, basis), listRules(), wcmRights(u)]);

  const [ch, pkg, dual] = await Promise.all([channelView(m), packagingBridge(month), legacyDualRead(m)]);
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Site</span>{SITES.map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="seg"><span className="seg-label">Basis</span>{BASES.map((b) => <Link key={b} href={href({ basis: b })} data-on={basis === b} className="seg-item">{BASIS_LABEL[b]}</Link>)}</div>
        <div className="ml-auto flex flex-wrap gap-1">{months.map((p) => (
          <Link key={p} href={href({ month: p })} className={cn("rounded-md px-2 py-1 text-[12px]", p === month ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{monLabel(p)}</Link>))}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label={`Warehouse spend · ${BASIS_LABEL[basis]}`} value={rsT(m.total)} sub={`${monLabel(month)} · ${site}${m.total.missing ? ` · ${m.total.missing} lines missing` : ""}`} />
        <Tile label="Before packaging" value={rsT(before)} sub="warehousing + manpower + OT" />
        <Tile label="Channel-assigned" value={rs(m.total.assigned)} sub={`shared ${rs(m.total.shared)}`} />
        <Tile label="Unallocated" value={rs(m.total.unallocated)} tone={m.total.unallocated ? "text-warn" : "text-ok"} sub={`${m.queue.length} lines to map${drafts ? ` · ${drafts} drafts await approval` : ""}`} />
        <Tile label="Missing inputs" value={String(m.total.missing)} tone={m.total.missing ? "text-bad" : "text-ok"} sub={m.total.missing ? "expected lines with no booked amount" : "every expected line booked"} />
      </div>

      <div className="space-y-3">
        <Section open title="Booked controls" sub={`Source = channel-assigned + approved shared + unallocated, per line, to the paise · snapshot ${snap.id} (${snap.file_name})`}>
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
            <div className="rounded-lg border border-line p-3">
              <div className="mb-1 font-medium">Dual-read · legacy Processing vs booked labour</div>
              <table className="table-base"><tbody>
                <tr><td>Legacy “actual manpower cost” (heads × ₹21,983 model)</td><td className="text-right tabular">{dual.legacyActual == null ? "—" : inrFull(dual.legacyActual)}</td></tr>
                <tr><td>Legacy planned manpower cost</td><td className="text-right tabular">{inrFull(dual.legacyPlanned)}</td></tr>
                <tr><td>Booked manpower + OT (Cost Master)</td><td className="text-right tabular">{dual.bookedMissing ? <span className="text-bad">missing ({dual.bookedMissing} lines)</span> : inrFull(dual.booked)}</td></tr>
                <tr><td className="text-ink-4">Booked − legacy actual</td><td className="text-right tabular text-ink-4">{dual.bookedMissing || dual.legacyActual == null ? "not comparable" : inrFull(dual.booked - dual.legacyActual)}</td></tr>
              </tbody></table>
              <p className="mt-1 text-ink-4">The legacy figure is a staffing model, not booked cost: it multiplies planned or attendance heads by one flat salary and carries old sheet rows forward (including rent entered as “Capacity”). Booked lines here are the cost; the model only explains it.</p>
            </div>
          </div>
        </Section>

        <Section open title="Unallocated queue" sub="Known amounts with an open mapping — map, split or set a recurring rule; it posts once approved"
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

        <Section title="By function and by channel" sub="Two views of the same slices — each totals to the warehouse total">
          <div className="grid gap-4 md:grid-cols-2">
            <table className="table-base"><thead><tr><th>Function</th><th className="text-right">₹</th></tr></thead>
              <tbody>{m.byFunction.map((f) => <tr key={f.fn}><td>{f.fn}</td><td className="text-right tabular">{rs(f.paise)}</td></tr>)}
                <tr className="font-semibold"><td>Total</td><td className="text-right tabular">{rs(m.byFunction.reduce((a, f) => a + f.paise, 0))}</td></tr></tbody></table>
            <table className="table-base"><thead><tr><th>Channel (assigned)</th><th className="text-right">₹</th></tr></thead>
              <tbody>{m.byChannel.map((c) => <tr key={c.channel}><td>{c.channel}</td><td className="text-right tabular">{rs(c.paise)}</td></tr>)}
                <tr><td>Shared (approved, pooled)</td><td className="text-right tabular">{rs(m.shared)}</td></tr>
                <tr><td className="text-warn">Unallocated</td><td className="text-right tabular text-warn">{rs(m.unallocated)}</td></tr>
                <tr className="font-semibold"><td>Total</td><td className="text-right tabular">{rs(m.byChannel.reduce((a, c) => a + c.paise, 0) + m.shared + m.unallocated)}</td></tr></tbody></table>
          </div>
          <div className="mt-3 overflow-x-auto"><table className="table-base min-w-[880px]">
            <thead><tr><th>Channel</th><th className="text-right">Forward</th><th className="text-right">Returns</th><th className="text-right">Other functions</th><th className="text-right">Packaging</th>
              <th className="text-right">Assigned total</th><th className="text-right">Dispatched items</th><th className="text-right">₹ / dispatched item*</th><th className="text-right">Returns put away</th></tr></thead>
            <tbody>{ch.rows.map((r) => (
              <tr key={r.channel}><td className="font-medium">{r.channel}</td><td className="text-right tabular">{rs(r.forward)}</td><td className="text-right tabular">{rs(r.returns)}</td>
                <td className="text-right tabular">{rs(r.other)}</td><td className="text-right tabular">{rs(r.packaging)}</td><td className="text-right tabular font-medium">{rs(r.total)}</td>
                <td className="text-right tabular">{r.dispatched == null ? "—" : new Intl.NumberFormat("en-IN").format(r.dispatched)}</td>
                <td className="text-right tabular">{r.rate.value == null ? <span className="text-[11.5px] text-ink-4">{r.rate.reason}</span> : r.total === 0 ? <span className="text-[11.5px] text-ink-4">nothing assigned yet</span> : `₹${r.rate.value.toFixed(2)}`}</td>
                <td className="text-right tabular">{r.returnsIn == null ? "—" : new Intl.NumberFormat("en-IN").format(r.returnsIn)}</td></tr>))}
              <tr><td>Shared (approved, pooled — not in any rate)</td><td colSpan={4} /><td className="text-right tabular">{rs(m.shared)}</td><td colSpan={3} /></tr>
              <tr><td className="text-warn">Unallocated (not in any rate)</td><td colSpan={4} /><td className="text-right tabular text-warn">{rs(m.unallocated)}</td><td colSpan={3} /></tr>
              <tr className="font-semibold"><td>Warehouse total</td><td colSpan={4} /><td className="text-right tabular">{rs(ch.rows.reduce((a, r) => a + r.total, 0) + m.shared + m.unallocated)}</td><td colSpan={3} /></tr>
            </tbody></table></div>
          <p className="mt-2 text-[12px] text-ink-4">* Channel-assigned cost ÷ dispatched items (one count per item, same site and month) — a partial burden, not a fully loaded cost; unavailable when the dispatch feed (from 21 Sep 2026) doesn't cover the whole month.{ch.b2cReturns != null && ` B2C returns put away: ${new Intl.NumberFormat("en-IN").format(ch.b2cReturns)} items, channel open (Shopify vs marketplace not in the source).`}</p>
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
      </div>
    </div>
  );
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
