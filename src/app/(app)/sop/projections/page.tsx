import Link from "next/link";
import { Avatar, Badge, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { AccuracyText, DemoBadge, SourceBadge, Variance } from "@/components/sop/bits";
import { CreateActionButton, NoteButton } from "@/components/sop/actions";
import { ProjectionChart, type ChartPoint } from "@/components/sop/ProjectionChart";
import { ValuesForm } from "@/components/sop/ProjectionForm";
import { DataSourcePanel } from "@/components/sop/DataSourcePanel";
import { requireUser, canEdit, canManage } from "@/server/auth";
import { getStreamMonthForm } from "@/server/sop/form";
import { listPeople } from "@/server/core/people";
import { PROVIDERS, providerFor, QUERY_TEMPLATE, snowflakeStatus } from "@/server/sop/actuals";
import { getLines, getNotes, getRules, getStreamMonthly, getStreams, getValues, headlineSeries, streamAccuracy } from "@/server/sop/queries";
import { accuracyOf, currentPeriod, headlineMetric, metricLabel, type ActualSource } from "@/server/sop/model";
import { addMonths, ago, fmtMonth, today } from "@/lib/dates";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP projections" };

const KIND_LABEL: Record<string, string> = { commentary: "Commentary", variance_reason: "Variance reason", corrective_action: "Corrective action" };

export default async function SopProjections({ searchParams }: { searchParams: Promise<{ stream?: string; month?: string; metric?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const td = today();
  const cur = currentPeriod(td);
  const fyStart = Number(cur.slice(5, 7)) >= 4 ? `${cur.slice(0, 4)}-04-01` : `${Number(cur.slice(0, 4)) - 1}-04-01`;
  const months: string[] = [];
  for (let p = fyStart; p <= addMonths(cur, 2); p = addMonths(p, 1)) months.push(p);
  const lastClosed = addMonths(cur, -1);

  const [streams, monthly, rules] = await Promise.all([getStreams(), getStreamMonthly(fyStart, addMonths(cur, 2)), getRules()]);
  const stream = streams.find((s) => s.id === sp.stream || s.code === sp.stream) ?? streams[0];
  if (!stream) return <EmptyState title="No S&OP streams configured" />;
  const th = rules.accuracyThreshold;

  const [lines, values, people, notes, sf] = await Promise.all([
    getLines(stream.id), getValues(stream.id, fyStart, addMonths(cur, 2)), listPeople(), getNotes(months, stream.id), snowflakeStatus(),
  ]);
  const metrics = [...new Set(lines.map((l) => l.metric).filter(Boolean) as string[])];
  const metric = sp.metric && metrics.includes(sp.metric) ? sp.metric : headlineMetric(stream, metrics);
  const { byPeriod } = headlineSeries({ ...stream, headline_metric: metric }, monthly);
  const chart: ChartPoint[] = months.map((p) => {
    const r = byPeriod.get(p);
    return { label: fmtMonth(p, false), projection: r?.eff ?? null, baseline: r?.proj ?? null, actual: r?.n_act ? r.act : null, demo: !!r?.demo };
  });
  const anyDemo = values.some((v) => v.actual_source === "demo" && v.actual != null);

  // per line × month aggregates (weeks and warehouses summed)
  type Agg = { proj: number | null; eff: number | null; act: number | null; demo: boolean; revised: boolean; pairs: { projection: number | null; actual: number | null }[] };
  const agg = new Map<string, Agg>();
  for (const v of values) {
    const k = `${v.line_id}|${v.period}`;
    const a = agg.get(k) ?? { proj: null, eff: null, act: null, demo: false, revised: false, pairs: [] };
    if (v.projection != null) a.proj = (a.proj ?? 0) + v.projection;
    const e = v.revised_projection ?? v.projection;
    if (e != null) a.eff = (a.eff ?? 0) + e;
    if (v.actual != null) a.act = (a.act ?? 0) + v.actual;
    a.demo ||= v.actual_source === "demo" && v.actual != null;
    a.revised ||= v.revised_projection != null;
    a.pairs.push({ projection: v.projection, actual: v.actual });
    agg.set(k, a);
  }
  const lineAcc = (lineId: string) => accuracyOf(months.filter((p) => p < cur).flatMap((p) => agg.get(`${lineId}|${p}`)?.pairs ?? []));
  const last = streamAccuracy(monthly, stream.id, lastClosed);
  const fytd = accuracyOf(values.filter((v) => v.period < cur).map((v) => ({ projection: v.projection, actual: v.actual })));
  const visibleMonths = months.filter((p) => lines.some((l) => agg.has(`${l.id}|${p}`)) || p >= cur);

  // actual entry
  const entryMonths = months.filter((p) => p <= cur).reverse();
  const entryMonth = sp.month && entryMonths.includes(sp.month) ? sp.month : stream.granularity === "week" ? cur : lastClosed;
  const form = await getStreamMonthForm(stream, entryMonth);
  const provider = providerFor(stream);
  const descriptions = Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, p.describe({ ...stream, actual_source: k as ActualSource })])) as Record<ActualSource, string>;
  const href = (q: Record<string, string | undefined>) => `/sop/projections?${new URLSearchParams(Object.entries({ stream: stream.id, metric: sp.metric, month: sp.month, ...q }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="space-y-5">
      {/* stream picker */}
      <div className="flex flex-wrap gap-1.5">
        {streams.map((s) => {
          const a = streamAccuracy(monthly, s.id, lastClosed);
          return (
            <Link key={s.id} href={`/sop/projections?stream=${s.id}`}
              className={cn("flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] transition", s.id === stream.id ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink")}>
              {s.name}
              {a.accuracy != null && <span className={cn("tabular text-[11.5px]", s.id === stream.id ? "text-canvas/70" : "text-ink-4")}>{pct(a.accuracy)}</span>}
            </Link>
          );
        })}
      </div>

      {/* stream header + chart */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-[22px] leading-tight text-ink">{stream.name}</h2>
              <SourceBadge source={stream.actual_source} />
              {anyDemo && <DemoBadge long />}
            </div>
            <p className="mt-1 text-[12.5px] text-ink-3">{stream.description}</p>
            <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-3">
              <span className="flex items-center gap-1.5"><Avatar name={stream.poc_name ?? stream.poc_label} color={stream.poc_color} size={18} />{stream.poc_name ?? stream.poc_label}</span>
              <span>{stream.granularity === "week" ? "Weekly" : "Monthly"}{stream.dimensions.length ? ` · ${stream.dimensions.join(" / ")}` : ""}</span>
              <span>Due {stream.due_day}th of prior month</span>
            </div>
          </div>
          <div className="flex gap-8">
            <Stat label={`Accuracy · ${fmtMonth(lastClosed, false)}`} value={<AccuracyText a={last.accuracy} threshold={th} />} delta={last.bias != null ? `${pct(last.bias, 0, true)} bias` : undefined} hint={last.bias != null ? (last.bias > 0 ? "under-projected" : "over-projected") : "no actuals"} />
            <Stat label="FYTD accuracy" value={<AccuracyText a={fytd.accuracy} threshold={th} />} hint={fytd.rows ? `${fytd.rows} data points` : "no actuals"} />
          </div>
        </div>
        <div className="px-5 py-4">
          {metrics.length > 1 && (
            <div className="mb-3 flex gap-1">
              {metrics.map((m) => <Link key={m} href={href({ metric: m })} className={cn("rounded-md px-2 py-1 text-[12px]", m === metric ? "bg-subtle font-medium text-ink" : "text-ink-3 hover:text-ink")}>{metricLabel(m)}</Link>)}
            </div>
          )}
          {chart.some((c) => c.projection != null || c.actual != null)
            ? <ProjectionChart data={chart} metric={`${metricLabel(metric)} · all lines${stream.dimensions.length ? " · both warehouses" : ""}`} />
            : <EmptyState compact title="No projections yet" body="Projections appear here once the POC submits them." />}
        </div>
      </Card>

      {/* lines × months */}
      <Card>
        <CardHeader title="Projection vs actual by line" subtitle={`Projection (revised where changed in-month) · actual · variance vs locked projection${stream.granularity === "week" ? " · weeks summed" : ""}`}
          action={<CreateActionButton people={people.map((p) => ({ id: p.id, name: p.name, hint: p.team_name }))} defaults={{ title: `Review ${stream.name} projection accuracy`, ownerId: stream.poc_id, streamId: stream.id }} />} />
        {lines.length ? (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[200px] bg-surface">Line</th>
                  {visibleMonths.map((p) => <th key={p} className={cn("min-w-[92px] text-right", p === cur && "text-ink")}>{fmtMonth(p, false)}{p === cur && <span className="ml-1 text-[10px] text-info">now</span>}</th>)}
                  <th className="text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const la = lineAcc(l.id);
                  return (
                    <tr key={l.id}>
                      <td className="sticky left-0 z-10 bg-surface"><span className="text-ink">{l.name}</span> <span className="text-[11px] text-ink-4">{metricLabel(l.metric)}</span></td>
                      {visibleMonths.map((p) => {
                        const a = agg.get(`${l.id}|${p}`);
                        const v = a?.act != null && a.proj ? (a.act - a.proj) / a.proj : null;
                        return (
                          <td key={p} className="py-1.5 text-right align-top leading-tight">
                            <div className="tabular text-ink">{num(a?.eff)}{a?.revised && <span className="ml-0.5 text-[10px] text-info" title={`Revised from ${num(a.proj)}`}>r</span>}</div>
                            {a?.act != null && <div className={cn("tabular text-[11.5px]", a.demo ? "text-warn" : "text-ink-3")}>{num(a.act)} · <Variance v={v} threshold={th} className="text-[11.5px]" /></div>}
                          </td>
                        );
                      })}
                      <td className="text-right"><AccuracyText a={la.accuracy} threshold={th} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState compact title="No lines yet" body="Add lines in the Data source panel below." />}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        {/* manual actual entry */}
        <Card>
          <CardHeader title="Enter actuals" subtitle={provider.manualEntry ? "Manual entry until Snowflake is connected" : "Actuals for this stream come from Snowflake"}
            action={
              <div className="flex flex-wrap justify-end gap-1">
                {entryMonths.slice(0, 6).map((p) => <Link key={p} href={href({ month: p })} className={cn("rounded-md px-2 py-1 text-[12px]", p === entryMonth ? "bg-subtle font-medium text-ink" : "text-ink-3 hover:text-ink")}>{fmtMonth(p, false)}</Link>)}
              </div>
            } />
          <div className="p-4">
            {stream.actual_source === "demo" && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">Demo actuals — will come from Snowflake. Typing a value here replaces the demo value with a manual actual.</p>}
            {form.lines.length ? (
              <ValuesForm key={`${stream.id}:${entryMonth}:actual`} mode="actual" streamId={stream.id} period={entryMonth} periodLabel={fmtMonth(entryMonth)}
                lines={form.lines} labels={form.labels} dims={form.dims} cells={form.cells}
                disabled={!provider.manualEntry || !canEdit(u)} disabledReason={!provider.manualEntry ? "Source is Snowflake — switch to manual to type actuals" : "Read-only"} />
            ) : <EmptyState compact title="No lines configured" />}
          </div>
        </Card>

        <div className="space-y-5">
          {/* commentary */}
          <Card>
            <CardHeader title="Commentary" subtitle="Context, variance reasons, corrective actions"
              action={<NoteButton streamId={stream.id} period={lastClosed} streamName={stream.name} periodLabel={fmtMonth(lastClosed)} />} />
            <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto scroll-thin">
              {notes.slice(0, 12).map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[11.5px] text-ink-3"><Badge tone={n.kind === "corrective_action" ? "info" : "neutral"}>{KIND_LABEL[n.kind] ?? n.kind}</Badge>{fmtMonth(n.period)} · {n.author_name} · {ago(n.created_at)}</div>
                  <p className="mt-1 text-[13px] text-ink-2">{n.body}</p>
                </li>
              ))}
              {!notes.length && <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">No commentary yet.</li>}
            </ul>
          </Card>

          {/* data source */}
          <Card>
            <CardHeader title="Data source" subtitle="Where this stream’s actuals come from" />
            <div className="p-4">
              <DataSourcePanel stream={stream} metrics={metrics} people={people.map((p) => ({ id: p.id, name: p.name }))} descriptions={descriptions}
                snowflakeConnected={sf.connected} template={QUERY_TEMPLATE} canManage={canManage(u)} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
