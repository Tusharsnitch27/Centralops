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
  await requireUser();
  const per = await resolvePeriod(await searchParams);
  if (!per.sel) return <EmptyState title="No S&OP data yet" />;
  const [b, fwd] = await Promise.all([leaderBrief(per.sel.months, per.label), forwardLook(3)]);
  const { d, outward, inward } = b;
  const outDaily = b.daily.views.filter((v) => v.flow === "Outwards").reduce((a, v) => ({ off: a.off + v.total.up + v.total.down, n: a.n + v.total.judged }), { off: 0, n: 0 });
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
        <Kpi label="Outward days off plan (>15%)" value={outDaily.n ? `${outDaily.off} / ${outDaily.n}` : "—"} tone={outDaily.n ? (outDaily.off / outDaily.n >= 0.4 ? "bad" : outDaily.off / outDaily.n >= 0.2 ? "warn" : "ok") : undefined}
          sub={outDaily.n ? "flow-days across B2C, B2B-MP, Retail" : "needs daily actuals (Snowflake)"} />
        <Kpi label="Warehouse utilisation" value={`${pc(s?.util)} · ${pc(n?.util)}`} tone={(s?.util ?? 0) >= 0.95 || (n?.util ?? 0) >= 0.95 ? "bad" : (s?.util ?? 0) >= 0.85 || (n?.util ?? 0) >= 0.85 ? "warn" : "ok"}
          sub={<>South · North{s ? ` · ${MON(s.period)}` : ""} · pre-packs held separately</>} />
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-baseline justify-between px-1"><h2 className="label-caps">Problems &amp; gaps</h2><Link href="/sop/monthly" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Monthly review <ArrowRight size={12} /></Link></div>
        <ProblemsList items={b.problems} />
      </section>

      <section className="mb-6">
        <h2 className="label-caps mb-2 px-1">Month on month · actual vs plan</h2>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Flow</th>{d.trend[0]?.periods.map((p) => <th key={p} className={cn("text-right", per.sel.months.includes(p) && "!text-ink")}>{MON(p)}</th>)}</tr></thead>
            <tbody>{d.trend.map((r) => (
              <tr key={r.def.key}><td className="font-medium">{r.def.title}</td>
                {r.cells.map((c, i) => <td key={i} className={cn("text-right", per.sel.months.includes(r.periods[i]) && "bg-subtle/60")} title={c ? `Plan ${L(c.plan)} · Actual ${L(c.actual)}` : undefined}>{c ? <UtilChip u={c.util} plan={c.plan} actual={c.actual} /> : <span className="text-ink-4">—</span>}</td>)}</tr>
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
              <tr className="bg-subtle/50 font-semibold"><td>Stock if projections hold</td><td className="text-right text-[11.5px] font-normal text-ink-4">{fwd.from ? `from ${MON(fwd.from)} close` : ""}</td>
                {fwd.roll.map((r) => <td key={r.period} className={cn("text-right tabular", (r.util ?? 0) >= 1 ? "text-bad" : (r.util ?? 0) >= 0.9 ? "text-warn" : "")}>{r.stock == null ? "—" : <>{L(r.stock)} · {pc(r.util)}{!r.complete && <span className="text-[10.5px] font-normal text-ink-4"> *</span>}</>}</td>)}</tr>
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Projections from the stream inputs (owners update monthly). Stock = latest close + projected inward − projected outward, against total capacity (28L). * some flows have no projection yet for that month.</p>
        </div>
      </section>
    </div>
  );
}
