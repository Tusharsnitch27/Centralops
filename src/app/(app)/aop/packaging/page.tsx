import Link from "next/link";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { PackagingRates, PkgMonthActions } from "@/components/aop/PackagingRates";
import { canManage, requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { loadRates, packagingHistory, packagingMonth, packagingMonths } from "@/server/packaging/engine";
import { AOP_LINES } from "@/server/packaging/model";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Packaging" };

const inr = (v: number | null | undefined) => (v == null ? "—" : `₹${Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(2)}L` : new Intl.NumberFormat("en-IN").format(Math.round(v))}`);
const num = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const pct = (a: number, b: number | null) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const tone = (a: number, b: number | null) => (!b ? "text-ink-3" : a / b > 1.05 ? "text-bad" : a / b < 0.9 ? "text-ok" : "text-ink");

/** AOP · Packaging: packaging cost per AOP line — live month vs plan (day by day), month on month with year, and the rate card. */
export default async function PackagingPage({ searchParams }: { searchParams: Promise<{ cycle?: string; m?: string; v?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cycles, cycle, months] = await Promise.all([listCycles(), resolveCycle(sp.cycle), packagingMonths()]);
  const view = sp.v === "history" || sp.v === "rates" ? sp.v : "month";
  const period = sp.m && months.some((m) => m.period === sp.m) ? sp.m : (months.find((m) => m.status === "open") ?? months[0])?.period;
  const [d, history, rates] = await Promise.all([period && view === "month" ? packagingMonth(period) : null, view === "history" ? packagingHistory() : null, view === "rates" ? loadRates() : null]);
  const qs = (o: Record<string, string | undefined>) => `/aop/packaging?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, v: view, m: period, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="animate-fade-in">
      <AopHeader active="packaging" cycleId={cycle?.id ?? null} cycles={cycles} title="Packaging"
        subtitle="Packages dispatched × rate in force that day, by AOP line — live this month, frozen into the AOP at month end." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg">
          {([["month", "Month view"], ["history", "Month on month"], ["rates", "Rates"]] as const).map(([k, l]) => <Link key={k} href={qs({ v: k })} data-on={view === k} className="seg-item">{l}</Link>)}
        </div>
        {view === "month" && (
          <div className="ml-auto flex flex-wrap gap-1">
            {months.slice(0, 12).map((m) => (
              <Link key={m.period} href={qs({ m: m.period })} className={cn("rounded-md px-2 py-1 text-[12px]", m.period === period ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>
                {mon(m.period)}{m.status === "open" && <span className={cn("ml-1", m.period === period ? "text-white/70" : "text-info")}>· live</span>}
              </Link>
            ))}
          </div>
        )}
      </div>

      {view === "month" && (!d ? <div className="card"><EmptyState title="No packaging data yet" body="History loads from the packaging workbook; Sep 2026 onwards arrives with the Snowflake refresh (Settings › Integrations › Packaging used)." action={<ButtonLink href="/settings?tab=integrations">Integrations</ButtonLink>} /></div> : (
        <div className="space-y-4">
          {/* headline */}
          {(() => {
            const t = d.lines.reduce((a, l) => ({ plan: a.plan + (l.plan ?? 0), ptd: a.ptd + (l.planToDate ?? 0), act: a.act + l.actual, proj: a.proj + l.projected, qty: a.qty + l.qty }), { plan: 0, ptd: 0, act: 0, proj: 0, qty: 0 });
            const live = d.status === "open";
            return (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Tile label={`AOP plan · ${mon(d.period)}`} value={inr(t.plan || null)} />
                <Tile label={live ? `Actual · 1–${d.lastDay}` : "Actual"} value={inr(t.act)} sub={`${num(t.qty)} packages${live ? ` · plan to date ${inr(t.ptd)}` : ""}`} />
                <Tile label={live ? "vs plan to date" : "vs plan"} value={pct(t.act, live ? t.ptd : t.plan)} tone={tone(t.act, live ? t.ptd : t.plan)} />
                <Tile label={live ? "Month-end projection" : "Cost per package"} value={live ? inr(t.proj) : t.qty ? `₹${(t.act / t.qty).toFixed(2)}` : "—"} sub={live ? `${pct(t.proj, t.plan)} of plan at this run-rate` : undefined} tone={live ? tone(t.proj, t.plan) : undefined} />
                <Tile label="Status" value={d.status === "closed" ? "Closed" : "Live"} sub={d.status === "closed" ? `${d.source === "file" ? "from the packaging workbook" : "from Snowflake"}${d.aopWrittenAt ? " · in AOP actuals" : ""}` : "refreshed daily · frozen at month end"} />
              </div>
            );
          })()}
          {/* per AOP line */}
          <div className="card overflow-x-auto">
            <table className="table-base min-w-[760px]">
              <thead><tr><th>AOP line</th><th className="text-right">Plan</th>{d.status === "open" && <th className="text-right">Plan to date</th>}<th className="text-right">Actual</th><th className="text-right">Packages</th><th className="text-right">₹ / package</th><th className="text-right">{d.status === "open" ? "vs plan to date" : "vs plan"}</th>{d.status === "open" && <th className="text-right">Projection</th>}</tr></thead>
              <tbody>{d.lines.map((l) => (
                <tr key={l.line}>
                  <td className="font-medium">{l.line}</td>
                  <td className="text-right tabular text-ink-3">{inr(l.plan)}</td>
                  {d.status === "open" && <td className="text-right tabular text-ink-3">{inr(l.planToDate)}</td>}
                  <td className="text-right font-semibold tabular">{inr(l.actual)}</td>
                  <td className="text-right tabular">{num(l.qty)}</td>
                  <td className="text-right tabular text-ink-3">{l.qty ? `₹${(l.actual / l.qty).toFixed(2)}` : "—"}</td>
                  <td className={cn("text-right font-semibold tabular", tone(l.actual, d.status === "open" ? l.planToDate : l.plan))}>{pct(l.actual, d.status === "open" ? l.planToDate : l.plan)}</td>
                  {d.status === "open" && <td className={cn("text-right tabular", tone(l.projected, l.plan))}>{inr(l.projected)}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {/* daily progress */}
          {d.status === "open" && d.daily.length > 0 && (() => {
            const plan = d.lines.reduce((a, l) => a + (l.plan ?? 0), 0);
            let cum = 0;
            const max = Math.max(...d.daily.map((x) => x.amount), 1);
            return (
              <div className="card overflow-x-auto">
                <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5"><span className="text-[13px] font-semibold">Day by day</span><span className="text-[11.5px] text-ink-4">cumulative vs the month’s plan spread evenly</span></div>
                <table className="table-base min-w-[760px]">
                  <thead><tr><th>Day</th><th className="text-right">Packages</th><th>Cost</th>{AOP_LINES.map((l) => <th key={l} className="text-right">{l}</th>)}<th className="text-right">Cumulative</th><th className="text-right">Plan to date</th></tr></thead>
                  <tbody>{d.daily.map((x) => { cum += x.amount; const ptd = (plan * Number(x.day.slice(8))) / d.days; return (
                    <tr key={x.day}>
                      <td className="whitespace-nowrap tabular">{Number(x.day.slice(8))} <span className="text-[11px] text-ink-4">{new Date(`${x.day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span></td>
                      <td className="text-right tabular">{num(x.packages)}</td>
                      <td><span className="flex items-center gap-2"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-ink/70" style={{ width: `${(x.amount / max) * 100}%` }} /></span><span className="tabular text-[12px]">{inr(x.amount)}</span></span></td>
                      {AOP_LINES.map((l) => <td key={l} className="text-right tabular text-ink-3">{x.byLine[l] ? inr(x.byLine[l]) : "—"}</td>)}
                      <td className={cn("text-right font-semibold tabular", plan ? (cum > ptd * 1.05 ? "text-bad" : "text-ink") : "")}>{inr(cum)}</td>
                      <td className="text-right tabular text-ink-3">{plan ? inr(ptd) : "—"}</td>
                    </tr>
                  ); })}</tbody>
                </table>
              </div>
            );
          })()}
          {/* by package type */}
          <div className="card overflow-x-auto">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5"><span className="text-[13px] font-semibold">By package type</span>
              {d.types.some((t) => t.unpriced) && <span className="text-[12px] text-bad">{d.types.filter((t) => t.unpriced).length} type(s) have no rate — add them under Rates</span>}</div>
            <table className="table-base min-w-[640px]">
              <thead><tr><th>Package</th><th>AOP lines</th><th className="text-right">Packages</th><th className="text-right">Rate</th><th className="text-right">Cost</th><th className="text-right">Share</th></tr></thead>
              <tbody>{(() => { const total = d.types.reduce((a, t) => a + t.amount, 0) || 1; return d.types.map((t) => (
                <tr key={t.package_type}>
                  <td className="font-medium">{t.package_type}</td>
                  <td className="text-[12px] text-ink-3">{t.lines.join(", ")}</td>
                  <td className="text-right tabular">{num(t.qty)}</td>
                  <td className={cn("text-right tabular", t.rate == null && t.unpriced > 0 && "font-semibold text-bad")}>{t.rate == null ? (t.unpriced > 0 ? "no rate" : "—") : `₹${Math.round(t.rate * 100) / 100}`}</td>
                  <td className="text-right font-semibold tabular">{inr(t.amount)}</td>
                  <td className="text-right tabular text-ink-3">{Math.round((t.amount / total) * 100)}%</td>
                </tr>)); })()}</tbody>
            </table>
          </div>
          {canManage(u) && d.status === "open" && <PkgMonthActions period={d.period} canClose={u.role === "admin" && d.period < `${new Date().toISOString().slice(0, 7)}-01`} />}
        </div>
      ))}

      {view === "history" && history && (
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[900px]">
            <thead><tr><th>Month</th>{AOP_LINES.map((l) => <th key={l} className="text-right">{l}</th>)}<th className="text-right">Total</th><th className="text-right">AOP plan</th><th className="text-right">vs plan</th><th>Source</th></tr></thead>
            <tbody>{[...history].reverse().map((h) => {
              const tot = AOP_LINES.reduce((a, l) => a + h.by[l].actual, 0);
              const plan = AOP_LINES.some((l) => h.by[l].plan != null) ? AOP_LINES.reduce((a, l) => a + (h.by[l].plan ?? 0), 0) : null;
              return (
                <tr key={h.period}>
                  <td className="font-medium"><Link href={qs({ v: "month", m: h.period })} className="hover:underline">{mon(h.period)}</Link></td>
                  {AOP_LINES.map((l) => <td key={l} className="text-right tabular" title={h.by[l].plan != null ? `Plan ${inr(h.by[l].plan)}` : undefined}>{h.by[l].actual ? inr(h.by[l].actual) : "—"}</td>)}
                  <td className="text-right font-semibold tabular">{inr(tot)}</td>
                  <td className="text-right tabular text-ink-3">{inr(plan)}</td>
                  <td className={cn("text-right font-semibold tabular", tone(tot, plan))}>{pct(tot, plan)}</td>
                  <td className="text-[12px] text-ink-3">{h.source === "live" ? <span className="text-info">Live (month to date)</span> : h.source === "file" ? "Workbook" : "Snowflake · closed"}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Nov 2025 – Aug 2026 from the packaging workbook (April not in it); Sep 2026 onwards from Snowflake, frozen at month end. Plan shows where an AOP cycle covers the month.</p>
        </div>
      )}

      {view === "rates" && rates && <PackagingRates rates={rates} canEdit={canManage(u)} />}
    </div>
  );
}

function Tile({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={cn("text-[20px] font-semibold leading-tight tabular", t)}>{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
