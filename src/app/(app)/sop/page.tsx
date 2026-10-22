import { requireSopOverview } from "@/server/sop/access";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { ProblemsList } from "@/components/sop/LeaderBits";
import { UtilChip } from "@/components/sop/MonthlyReview";
import { requireUser } from "@/server/auth";
import { resolvePeriod } from "@/server/sop/period";
import { forwardLook, leaderBrief } from "@/server/sop/brief";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Summary" };

const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const L = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(2)}L` : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const MON = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: "bad" | "warn" | "ok" }) {
  return (
    <div className="card p-4">
      <div className="text-[11.5px] font-medium text-ink-3">{label}</div>
      <div className={cn("mt-1 text-[24px] font-semibold tabular leading-none", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-ink-4">{sub}</div>}
    </div>
  );
}
const accTone = (a: number | null | undefined) => (a == null ? undefined : a >= 0.9 ? "ok" : a >= 0.75 ? "warn" : "bad");

export default async function SopSummary({ searchParams }: { searchParams: Promise<{ grain?: string; p?: string }> }) {
  await requireSopOverview();
  const per = await resolvePeriod(await searchParams);
  if (!per.sel) return <EmptyState title="No S&OP data yet" />;
  const [b, fwd] = await Promise.all([leaderBrief(per.sel.months, per.label), forwardLook(2)]);
  const { d, outward, inward } = b;
  const outDaily = b.daily.views.filter((v) => v.flow === "Outwards" && v.metric !== "orders").reduce((a, v) => ({ off: a.off + v.total.up + v.total.down, n: a.n + v.total.judged }), { off: 0, n: 0 });
  const wh = (w: "South" | "North") => d.wh[w].filter((p) => p.util != null && per.sel.months.includes(p.period)).at(-1) ?? d.wh[w].filter((p) => p.util != null).at(-1);
  const s = wh("South"), n = wh("North");
  return (
    <div>
      <PeriodPicker base="/sop" grain={per.grain} options={per.options} selected={per.sel.key} partial={per.partial} />

      {b.headline && (
        <div className="card mb-4 border-l-4 border-l-bad px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">{per.label}{d.mtd && !d.multi ? ` · 1–${d.through}` : ""} · headline</div>
          <p className="mt-1 text-[15px] font-semibold text-ink">{b.headline}</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Outward accuracy" value={pc(outward?.acc)} tone={accTone(outward?.acc)} sub={outward ? <>plan {L(outward.tp)} · actual {L(outward.ta)}</> : null} />
        <Kpi label="Inward accuracy" value={pc(inward?.acc)} tone={accTone(inward?.acc)} sub={inward ? <>plan {L(inward.tp)} · actual {L(inward.ta)}</> : null} />
        <Kpi label="Outward days off plan (>20%, items)" value={outDaily.n ? `${outDaily.off} / ${outDaily.n}` : "—"} tone={outDaily.n ? (outDaily.off / outDaily.n >= 0.4 ? "bad" : outDaily.off / outDaily.n >= 0.2 ? "warn" : "ok") : undefined}
          sub={outDaily.n ? "flow-days across B2C, B2B-MP, Retail" : "needs daily actuals (Snowflake)"} />
        <Kpi label="Warehouse utilisation" value={`${pc(s?.util)} · ${pc(n?.util)}`} tone={(s?.util ?? 0) >= 0.95 || (n?.util ?? 0) >= 0.95 ? "bad" : (s?.util ?? 0) >= 0.85 || (n?.util ?? 0) >= 0.85 ? "warn" : "ok"}
          sub={<>South · North{s ? ` · ${MON(s.period)}` : ""}{(() => { const used = (s?.inventory ?? 0) + (n?.inventory ?? 0); const ns = (s?.bad ?? 0) + (s?.other ?? 0) + (n?.bad ?? 0) + (n?.other ?? 0);
            return used && ns ? <> · <span className={ns / used >= 0.08 ? "text-bad" : "text-warn"}>{pc(ns / used)} not sellable</span></> : " · pre-packs held separately"; })()}</>} />
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between px-1"><h2 className="label-caps">Problems &amp; gaps</h2><Link href="/sop/monthly" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Monthly review <ArrowRight size={12} /></Link></div>
        <ProblemsList items={b.problems} />
      </section>

      <section className="mb-6">
        <h2 className="label-caps mb-2 px-1">Month on month · actual vs plan, and capacity</h2>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Flow</th>{d.trend[0]?.periods.map((p) => <th key={p} className={cn("text-right", per.sel.months.includes(p) && "!text-ink")}>{MON(p)}</th>)}</tr></thead>
            <tbody>{d.trend.map((r) => (
              <tr key={r.def.key}><td className="font-medium">{r.def.title}</td>
                {r.cells.map((c, i) => <td key={i} className={cn("text-right", per.sel.months.includes(r.periods[i]) && "bg-subtle/60")} title={c ? `Plan ${L(c.plan)} · Actual ${L(c.actual)}` : undefined}>{c ? <UtilChip u={c.util} plan={c.plan} actual={c.actual} /> : <span className="text-ink-4">—</span>}</td>)}</tr>
            ))}
            <tr><td colSpan={(d.trend[0]?.periods.length ?? 0) + 1} className="!h-8 bg-subtle/60 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">Capacity · warehouse utilisation (good + bad + blocked / putaway / putback ÷ capacity, pre-packs apart)</td></tr>
            {(["South", "North", "Total"] as const).map((w) => (
              <tr key={w}><td className="font-medium">{w === "Total" ? "Total (28L)" : `${w} WH`}</td>
                {(d.trend[0]?.periods ?? []).map((p) => { const pt = d.wh[w].find((x) => x.period === p); const u = pt?.util ?? null; return (
                  <td key={p} className={cn("text-right", per.sel.months.includes(p) && "bg-subtle/60")} title={pt?.inventory != null ? `${L(pt.inventory)} of ${L(pt.capacity)}` : undefined}>
                    {u == null ? <span className="text-ink-4">—</span> : <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular", u >= 0.95 ? "bg-bad-soft text-bad" : u >= 0.85 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-ink")}>{pc(u)}</span>}
                  </td>
                ); })}</tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="label-caps mb-2 px-1">Forward look · projections</h2>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Flow</th>{fwd.months.map((p, i) => <th key={p} className="text-right">{MON(p)}{i === 0 ? " · now" : ""}</th>)}</tr></thead>
            <tbody>
              {fwd.table.map((r) => (
                <tr key={r.key}><td className="font-medium">{r.label}<span className="ml-1.5 text-[11px] text-ink-4">{r.dir === "in" ? "in" : "out"}</span></td>
                  {r.values.map((v, i) => <td key={i} className={cn("text-right tabular", v == null && "text-ink-4")}>{v == null ? "no projection" : L(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Projections from the stream inputs (owners update them monthly).</p>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="label-caps mb-2 px-1">Inventory outlook · if projections hold</h2>
        <div className="grid gap-3 xl:grid-cols-2">
          {fwd.outlook.map((o) => (
            <div key={o.wh} className="card overflow-x-auto">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5"><span className="text-[13.5px] font-semibold">{o.wh} WH</span><span className="text-[11.5px] text-ink-4">capacity {L(o.capacity)}</span></div>
              <table className="table-base min-w-[520px]">
                <thead><tr><th></th>{o.rows.map((r) => <th key={r.period} className="text-right">{MON(r.period)}{r.partial ? ` · ${fwd.through + 1}–end` : ""}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="text-ink-3">Opening</td>{o.rows.map((r) => <td key={r.period} className="text-right tabular">{L(r.opening)}</td>)}</tr>
                  <tr><td className="text-ink-3">+ Inward &amp; returns</td>{o.rows.map((r) => <td key={r.period} className="text-right tabular text-ok">{L(r.inward)}</td>)}</tr>
                  <tr><td className="text-ink-3">− All outward</td>{o.rows.map((r) => <td key={r.period} className="text-right tabular text-bad">{L(r.outward)}</td>)}</tr>
                  <tr className="bg-subtle/50 font-semibold"><td>Closing (est.)</td>{o.rows.map((r) => <td key={r.period} className="text-right tabular">{L(r.closing)}{r.missing.length > 0 && <span className="text-[10.5px] font-normal text-warn"> *</span>}</td>)}</tr>
                  <tr><td className="font-semibold">Utilisation</td>{o.rows.map((r) => <td key={r.period} className={cn("text-right font-semibold tabular", r.missingOut ? "text-ink-4" : (r.util ?? 0) >= 1 ? "text-bad" : (r.util ?? 0) >= 0.9 ? "text-warn" : "text-ok")}>{r.missingOut ? <span className="text-[11px] font-normal">needs projections</span> : pc(r.util)}</td>)}</tr>
                </tbody>
              </table>
              {o.rows.some((r) => r.missing.length) && (
                <p className="border-t border-line px-4 py-2 text-[11.5px] text-warn">* Not projected yet: {[...new Set(o.rows.flatMap((r) => r.missing))].map((m) => `${m} (${o.rows.filter((r) => r.missing.includes(m)).map((r) => MON(r.period).split(" ")[0]).join(", ")})`).join(" · ")}. Missing outward makes closing stock look higher than it will be.</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-ink-4">Starts from {fwd.startSource}. This month counts only the days still to come (day {fwd.through + 1} onward); later months roll forward. Flows without a South/North split use their latest planned split. Pre-pack stock is held separately and isn’t included.</p>
      </section>
    </div>
  );
}
