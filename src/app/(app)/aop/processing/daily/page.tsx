import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { Section } from "@/components/aop/processing/bits";
import { FollowUp, PoolEditor, RefreshFeed } from "@/components/aop/warehouse/PoolEditor";
import { canManage, requireUser } from "@/server/auth";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { canPlanSite, dailyView, deployDays } from "@/server/wcm/daily";
import { proposeSplit, type OpsSite } from "@/server/wcm/ops";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Daily planner" };
type SP = { site?: string; day?: string; cycle?: string };

const n0 = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const n2 = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v));
const pc = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

/**
 * AOP › Processing › Daily planner: attendance day-equivalents per home function → the lead confirms where they went (stages,
 * transfers, reason-coded idle) → stage output vs capacity → bottlenecks next to transferable time → follow-up task.
 */
export default async function DailyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const [cycles, cycle, days] = await Promise.all([listCycles(), resolveCycle(sp.cycle), deployDays()]);
  const header = <AopHeader active="processing" cycleId={cycle?.id ?? null} cycles={cycles} title="Daily planner"
    subtitle="Present labour → confirmed deployment → stage output vs capacity. Site × day × home function × shift (Day / Night from attendance); day-equivalents (half day = 0.5)."
    actions={<Link href="/aop/processing" className="text-[12.5px] text-ink-3 hover:text-ink">← Monthly processing</Link>} />;
  if (!days.length) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No attendance yet" body="Daily manpower arrives from the attendance app each morning (from 29 Oct 2026)." /></div></div>;
  const site: OpsSite = sp.site === "North" ? "North" : "South";
  const day = sp.day && days.includes(sp.day) ? sp.day : days[0]!;
  const href = (o: Partial<SP>) => `/aop/processing/daily?${new URLSearchParams(Object.entries({ site, day, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const [v, canEdit] = await Promise.all([dailyView(day, site), canPlanSite(u, site)]);

  const options = v.stages.map((s) => ({ target: s.target, label: `${s.stream} · ${s.stage}`, homeFn: s.homeFn }));
  const short = v.stages.filter((s) => s.required != null && s.required - s.de > 0.25).sort((a, b) => (b.required! - b.de) - (a.required! - a.de));
  const spare = v.pools.map((p) => {
    const conf = p.lines.reduce((a, l) => a + l.de, 0), noDemand = p.lines.filter((l) => l.target === "idle:No demand").reduce((a, l) => a + l.de, 0);
    return { fn: p.shift === "All" ? p.homeFn : `${p.homeFn} · ${p.shift}`, unassigned: Math.max(p.available - conf, 0), noDemand };
  }).filter((x) => x.unassigned > 0.25 || x.noDemand > 0.25);

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg"><span className="seg-label">Site</span>{(["South", "North"] as const).map((s) => <Link key={s} href={href({ site: s })} data-on={site === s} className="seg-item">{s}</Link>)}</div>
        <div className="ml-auto flex flex-wrap gap-1">{days.slice(0, 14).map((d) => (
          <Link key={d} href={href({ day: d })} className={cn("rounded-md px-2 py-1 text-[12px] tabular", d === day ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{d.slice(5)}</Link>))}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Present (attendance)" value={`${n2(v.totals.available)} DE`} sub={`${site} · ${day}`} />
        <Tile label="Confirmed on stages" value={`${n2(v.totals.assigned)} DE`} />
        <Tile label="Confirmed idle" value={`${n2(v.totals.idle)} DE`} tone={v.totals.idle ? "text-warn" : undefined} sub="reason-coded" />
        <Tile label="Unassigned" value={`${n2(v.totals.unassigned)} DE`} tone={v.totals.unassigned > 0.25 ? "text-warn" : "text-ok"} sub={canEdit ? "confirm below" : "read-only for you"} />
      </div>

      <div className="space-y-3">
        <Section open title="Deployment by home function" sub="Auto from attendance roles each morning (role → its stage; several channels → by workload; Unclassified grades → remaining workload gap; DEO / security / housekeeping left unassigned). A lead's save overrides the pool and is kept.">
          <div className="grid gap-3 xl:grid-cols-2">{v.pools.map((p) => {
            // workload is per day: each shift pool proposes its share of the day's need, by present DE (Day + Night never double-cover it)
            const fnTotal = v.pools.filter((x) => x.homeFn === p.homeFn).reduce((a, x) => a + x.available, 0);
            const share = fnTotal ? p.available / fnTotal : 0;
            const own = v.stages.filter((s) => s.homeFn === p.homeFn).map((s) => ({ target: s.target, required: s.required == null ? null : s.required * share }));
            return <PoolEditor key={`${p.homeFn}|${p.shift}`} day={day} site={site} homeFn={p.homeFn} shift={p.shift} available={p.available} revision={p.revision} lines={p.lines} options={options}
              proposal={proposeSplit(p.available, own)} canEdit={canEdit} source={p.source} roles={p.roles}
              updated={p.updatedAt ? `${p.updatedAt.slice(0, 16)} by ${p.updatedBy ?? (p.source === "auto" ? "attendance auto-split" : "—")}` : null} />;
          })}</div>
        </Section>

        <Section open title="Stage output vs capacity" sub="capacity = confirmed DE × IPP · utilisation = output ÷ capacity · unused capacity is not idle time · no feed = unavailable, never 0"
          summary={<span className="text-white/80">IPPs provisional — units / shift not yet confirmed with Ops</span>}>
          <div className="overflow-x-auto"><table className="table-base min-w-[980px]">
            <thead><tr><th>Stream · stage</th><th className="text-right">IPP</th><th>Unit</th><th className="text-right">Output</th><th className="text-right">DE</th><th className="text-right">Capacity</th>
              <th className="text-right">Utilisation</th><th className="text-right">Unused</th><th className="text-right">Above norm</th><th className="text-right">Required DE</th><th>Note</th></tr></thead>
            <tbody>{v.stages.map((s) => (
              <tr key={s.target}>
                <td className="font-medium">{s.stream} · {s.stage}<div className="text-[11px] text-ink-4">{s.homeFn ?? "any function"}</div></td>
                <td className="text-right tabular">{n0(s.ipp)}{!s.verified && s.ipp != null && <Badge tone="amber" className="ml-1">prov.</Badge>}</td>
                <td className="text-[12px] text-ink-3">{s.unit}</td>
                <td className="text-right tabular">{s.output == null ? <span className="text-ink-4">no feed</span> : n0(s.output)}</td>
                <td className="text-right tabular">{n2(s.de)}</td><td className="text-right tabular">{n0(s.capacity)}</td>
                <td className={cn("text-right tabular", s.utilisation != null && (s.utilisation < 0.8 ? "text-warn" : s.utilisation > 1.2 ? "text-info" : "text-ok"))}>{pc(s.utilisation)}</td>
                <td className="text-right tabular">{n0(s.unused)}</td><td className="text-right tabular">{n0(s.overNorm)}</td><td className="text-right tabular">{n2(s.required)}</td>
                <td className="text-[11.5px] text-ink-4">{s.why ?? ""}{s.stage === "Picker" && s.output != null ? (s.why ? " · " : "") + "pick scans partly captured upstream" : ""}</td>
              </tr>))}</tbody>
          </table></div>
          <p className="mt-2 text-[12px] text-ink-4">A split taken straight from “Propose from workload”, and the auto split's Unclassified share, read ≈100 % by construction (labour derived from output). Utilisation is meaningful for role-tagged people and for pools a lead has confirmed. South titles are mostly HR grades (Unclassified), so South auto pools are largely workload-derived.</p>
          {v.unmatched.length > 0 && <p className="mt-2 text-[12px] text-ink-4">Workload with no IPP stage (shown, not scored): {v.unmatched.map((o) => `${o.stream} ${o.event} ${n0(o.qty)}`).join(" · ")}</p>}
          <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-4">Stage output last read {v.fetched?.slice(0, 16) ?? "never"}{canManage(u) && <RefreshFeed />}</div>
        </Section>

        <Section open title="Bottlenecks and transferable time" sub="Shortfall = required DE − confirmed DE on that stage; transferable = unassigned or 'No demand' idle in a pool">
          <div className="grid gap-4 md:grid-cols-2">
            <table className="table-base"><thead><tr><th>Short stage</th><th className="text-right">Required</th><th className="text-right">Confirmed</th><th className="text-right">Short by</th></tr></thead>
              <tbody>{short.length ? short.map((s) => <tr key={s.target}><td>{s.stream} · {s.stage}</td><td className="text-right tabular">{n2(s.required)}</td><td className="text-right tabular">{n2(s.de)}</td>
                <td className="text-right tabular text-bad">{n2(s.required! - s.de)}</td></tr>) : <tr><td colSpan={4} className="text-ok">No stage short of labour on the measured stages.</td></tr>}</tbody></table>
            <table className="table-base"><thead><tr><th>Pool with spare time</th><th className="text-right">Unassigned</th><th className="text-right">Idle · no demand</th></tr></thead>
              <tbody>{spare.length ? spare.map((x) => <tr key={x.fn}><td>{x.fn}</td><td className="text-right tabular">{n2(x.unassigned)}</td><td className="text-right tabular">{n2(x.noDemand)}</td></tr>)
                : <tr><td colSpan={3} className="text-ink-3">No spare time confirmed.</td></tr>}</tbody></table>
          </div>
          {canEdit && <div className="mt-3"><FollowUp site={site} day={day} suggestion={short[0] ? `Cover ${short[0].stream} · ${short[0].stage} shortfall (${n2(short[0].required! - short[0].de)} DE)` : ""} /></div>}
          <p className="mt-2 text-[12px] text-ink-4">Required DE uses the day's measured output ÷ IPP; stages without a feed can't show a shortfall. Workload is per day: a shift pool's proposal splits that shift's present DE by the whole day's stage mix.</p>
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
