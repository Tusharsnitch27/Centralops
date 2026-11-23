"use client";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, MessageSquareText, ArrowUpRight } from "lucide-react";
import { Avatar } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { ago } from "@/lib/dates";
import { impactOf, monLabel, monShort, type Direction } from "@/server/aop/calc";
import type { LineNode, SummaryTree } from "@/server/aop/summaryData";
import { MonthlySpendChart } from "./SummaryCharts";
import { activeMonths, aggLines, averageInsights, customSpan, deviationsFor, momLike, fnLines, hasReason, prevSpan, priorWindow, spansFor, type Agg, type Deviation, type Grain, type Span } from "./summaryMath";
import { AverageInsights } from "./AverageInsights";

const KIND_LABEL = { commentary: "Remark", variance_reason: "Reason", corrective_action: "Action" } as const;

/** Month filter + function → line summary (Budget / Provision / Actuals / gaps / MoM) + key items to review. */
export function MonthSummary({ tree, reviewHref, unitCosts, more }: { tree: SummaryTree; reviewHref: string; unitCosts?: React.ReactNode; more?: React.ReactNode }) {
  const months = useMemo(() => activeMonths(tree), [tree]);
  const [grain, setGrain] = useState<Grain>("month");
  const closedActive = months.filter((p) => tree.lastClosed && p <= tree.lastClosed);
  const [from, setFrom] = useState(closedActive[0] ?? months[0]);
  const [to, setTo] = useState(closedActive[closedActive.length - 1] ?? months[months.length - 1]);
  const spans = useMemo(() => grain === "custom" ? [customSpan(tree, from, to)] : spansFor(tree, grain).filter((sp) => sp.periods.some((p) => months.includes(p))), [tree, grain, months, from, to]);
  const defaultKey = (g: Grain) => g === "month" ? (tree.lastClosed && months.includes(tree.lastClosed) ? tree.lastClosed : months[months.length - 1])
    : g === "quarter" ? spansFor(tree, "quarter").filter((x) => x.periods.some((p) => months.includes(p))).reverse().find((x) => x.periods.some((p) => tree.lastClosed && p <= tree.lastClosed))?.key ?? "Q1"
    : g === "custom" ? `C:${from <= to ? from : to}:${from <= to ? to : from}` : tree.lastClosed ? "YTD" : "FY";
  const [spanKey, setSpanKey] = useState<string>(defaultKey("month"));
  const span: Span = grain === "custom" ? spans[0] : spans.find((x) => x.key === spanKey) ?? spans[spans.length - 1];
  const prev = grain === "custom" ? priorWindow(tree, span) : prevSpan(spans, span);
  const avgIns = useMemo(() => averageInsights(tree, span), [tree, span]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const L = tree.labels;
  const dir: Direction = tree.functions[0]?.lines[0]?.direction ?? tree.functions[0]?.groups[0]?.lines[0]?.direction ?? "lower_better";
  const all = tree.functions.flatMap(fnLines);
  const total = aggLines(all, span.periods), totalPrev = prev ? aggLines(all, prev.periods) : null;
  const devs = useMemo(() => grain === "month" ? deviationsFor(tree, span.key) : spanDeviations(tree, span, prev), [tree, span, prev, grain]);
  const key = devs.filter((d) => d.severity !== "low" || d.kind === "missing").slice(0, 12);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const closed = span.closed || (tree.lastClosed != null && span.periods.some((p) => p <= tree.lastClosed!));
  const chg = grain === "quarter" ? "QoQ" : grain === "custom" ? "vs prior" : "MoM";
  const momTotal = grain !== "year" && prev ? momLike(all, span.periods, prev.periods) : null;
  const period = span.periods[span.periods.length - 1];

  const fnRows = tree.functions.map((f) => ({ f, a: aggLines(fnLines(f), span.periods), mm: grain !== "year" && prev ? momLike(fnLines(f), span.periods, prev.periods) : null }))
    .sort((x, y) => (y.a.hasActual ? y.a.actual : y.a.plan) - (x.a.hasActual ? x.a.actual : x.a.plan));
  const maxFn = Math.max(1, ...fnRows.map((r) => Math.max(r.a.plan, r.a.forecast, r.a.hasActual ? r.a.actual : 0)));
  const gap = total.actual - total.planReported, over = gap > 0;
  const missingFns = fnRows.filter((r) => r.a.missing > 0).map((r) => `${r.f.name} (${r.a.missing})`);
  const nLines = all.length;

  return (
    <div className="space-y-6">
      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {(["month", "quarter", "year", "custom"] as Grain[]).map((g) => (
            <button key={g} data-on={grain === g} onClick={() => { setGrain(g); setSpanKey(defaultKey(g)); }} className="seg-item capitalize">{g}</button>
          ))}
        </div>
        {grain === "custom" ? (
          <div className="seg">
            <span className="seg-label">From</span>
            <select aria-label="From month" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 rounded-[7px] bg-surface px-2 text-[12.5px] font-medium text-ink outline-none">
              {months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
            </select>
            <span className="seg-label">To</span>
            <select aria-label="To month" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 rounded-[7px] bg-surface px-2 text-[12.5px] font-medium text-ink outline-none">
              {months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
            </select>
          </div>
        ) : (
          <div className="seg max-w-full">
            {spans.map((x) => (
              <button key={x.key} data-on={x.key === span.key} onClick={() => setSpanKey(x.key)} title={x.label} className={cn("seg-item tabular", !x.closed && x.key !== span.key && "text-ink-4")}>
                {grain === "month" ? monShort(x.key) : x.short}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The answer, in one sentence */}
      <section className="card p-6 md:p-7" aria-label="Headline">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0">
            <div className="eyebrow">{span.label} · {closed ? "closed" : "in progress"}</div>
            <h2 className="mt-2 font-serif text-[32px] leading-[1.1] tracking-[-0.01em] text-ink md:text-[40px]">
              {total.hasActual ? <><span className="tabular">{inr(total.actual)}</span> spent{total.planReported > 0 && <> — <span className={cn("tabular", over ? "text-bad" : "text-ok")}>{inr(Math.abs(gap))} {over ? "over" : "under"}</span> {L.plan.toLowerCase()}</>}.</>
                : <>No {L.actual.toLowerCase()} yet for {span.label}.</>}
            </h2>
            <p className="mt-3 max-w-[640px] text-[13.5px] leading-relaxed text-ink-3">
              {L.plan} {inr(total.plan)}{total.hasActual && total.plan ? <> · {pct(total.actual / total.plan, 0)} used</> : null}{total.hasActual && total.plan && total.hasForecast && total.forecast ? <> · {pct(total.actual / total.forecast, 0)} of {L.forecast}</> : null}
              {" · "}{nLines - total.missing} of {nLines} lines reported{missingFns.length ? <> — still to report: <span className="text-ink-2">{missingFns.join(", ")}</span></> : null}.
            </p>
            {total.plan > 0 && total.hasActual && (
              <div className="mt-5 max-w-[640px]" aria-hidden>
                <div className="relative h-2 rounded-full bg-muted">
                  <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-bad" : "bg-accent")} style={{ width: `${Math.min(100, (total.actual / Math.max(total.plan, total.actual)) * 100)}%` }} />
                  <div className="absolute -top-1 h-4 w-px bg-ink" style={{ left: `${(total.plan / Math.max(total.plan, total.actual)) * 100}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-4"><span>{L.actual}</span><span>tick = {L.plan.toLowerCase()}</span></div>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-4 border-line lg:grid-cols-1 lg:border-l lg:pl-6">
            <Fact label={L.forecast} value={total.hasForecast ? inr(total.forecast) : "—"} hint={total.hasForecast && total.plan ? `${pct(total.forecast / total.plan, 0)} of ${L.plan.toLowerCase()}` : "not entered"} />
            <Fact label={grain === "year" ? "Run-rate / month" : chg}
              value={grain === "year" ? (total.hasActual ? inr(total.actual / Math.max(1, span.periods.filter((p) => tree.lastClosed && p <= tree.lastClosed).length)) : "—") : momTotal ? pct((momTotal.cur - momTotal.prev) / momTotal.prev, 0, true) : "—"}
              hint={grain === "year" ? "closed months" : prev && momTotal ? `vs ${prev.short}, same lines` : "no earlier period"} />
            <Fact label="To review" value={String(devs.length)} hint={devs.length ? "deviations, biggest below" : "nothing material"} />
          </dl>
        </div>
      </section>

      {/* Where it went */}
      <section aria-label="By function">
        <SectionHead title="Where the money went" hint={`${L.actual} against ${L.plan.toLowerCase()} by function · open one for its lines`} />
        <div className="card divide-y divide-line overflow-hidden">
          {fnRows.map(({ f, a, mm }) => {
            const isOpen = open.has(f.id), act = a.hasActual ? a.actual : 0;
            return (
              <div key={f.id}>
                <button type="button" onClick={() => toggle(f.id)} aria-expanded={isOpen}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-4 text-left transition hover:bg-subtle/60 md:grid-cols-[220px_minmax(0,1fr)_260px_120px_70px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronRight size={14} className={cn("shrink-0 text-ink-4 transition-transform", isOpen && "rotate-90")} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-ink">{f.name}</span>
                      <span className="flex items-center gap-1 text-[11.5px] text-ink-4"><Avatar name={f.owner} size={14} />{f.owner}{a.missing > 0 && <span className="ml-1 text-warn">· {a.missing} to report</span>}</span>
                    </span>
                  </span>
                  <span className="relative col-span-2 h-2 rounded-full bg-muted md:col-span-1" aria-hidden>
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", a.planReported && act > a.planReported ? "bg-bad/80" : "bg-accent")} style={{ width: `${(act / maxFn) * 100}%` }} />
                    {a.plan > 0 && <span className="absolute -top-1 h-4 w-px bg-ink/70" style={{ left: `${(a.plan / maxFn) * 100}%` }} />}
                    {a.hasForecast && a.forecast > 0 && <span className="absolute -top-0.5 h-3 w-px bg-ink/30" style={{ left: `${(a.forecast / maxFn) * 100}%` }} />}
                  </span>
                  <span className="text-right">
                    <span className="block text-[14px] font-semibold tabular text-ink">{a.hasActual ? inr(a.actual) : "—"}</span>
                    <span className="block text-[11.5px] tabular text-ink-4">{a.plan ? `of ${inr(a.plan)} ${L.plan}` : `no ${L.plan.toLowerCase()} set`} · {a.hasForecast ? `${inr(a.forecast)} ${L.forecast}` : `no ${L.forecast.toLowerCase()} set`}</span>
                  </span>
                  <span className="hidden text-right md:block">{a.hasActual && a.planReported ? <Gap dir={dir} base={a.planReported} value={a.actual} small /> : <Dash />}</span>
                  <span className="hidden text-right md:block">{mm ? <Mom dir={dir} prev={mm.prev} cur={mm.cur} small /> : <Dash />}</span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t border-line bg-subtle/30">
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <thead><tr className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
                        <th className="px-4 py-2 pl-10 text-left font-semibold">Line</th><th className="px-3 py-2 text-right font-semibold">{L.plan}</th><th className="px-3 py-2 text-right font-semibold">{L.forecast}</th>
                        <th className="px-3 py-2 text-right font-semibold">{L.actual}</th><th className="px-3 py-2 text-right font-semibold">vs {L.plan}</th><th className="px-3 py-2 text-right font-semibold">vs {L.forecast}</th><th className="px-3 py-2 text-right font-semibold">{grain === "year" ? "" : chg}</th>
                      </tr></thead>
                      <tbody>
                        {[...f.lines.map((l) => ({ l, group: null as string | null })), ...f.groups.flatMap((g) => g.lines.map((l, i) => ({ l, group: i === 0 ? g.name : null })))].map(({ l, group }) => (
                          <Fragment key={l.id}>
                            {group && <tr className="border-t border-line/60"><td colSpan={7} className="px-4 pb-1 pl-10 pt-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-4">{group}</td></tr>}
                            <LineRow l={l} span={span} prev={grain === "year" ? null : prev} labels={L} />
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-ink-4">Bar = {L.actual.toLowerCase()}, dark tick = {L.plan.toLowerCase()}, light tick = {L.forecast.toLowerCase()} · gaps compare only lines that have reported · hover a line for its remarks</p>
      </section>

      {unitCosts}

      {/* Needs a look */}
      <section aria-label="To review">
        <SectionHead title="Needs a look" hint={devs.length ? `The ${Math.min(5, key.length)} biggest of ${devs.length} for ${span.label}` : undefined}
          action={<Link href={`${reviewHref}${reviewHref.includes("?") ? "&" : "?"}period=${period}`} className="flex items-center gap-1 text-[12.5px] font-medium text-accent-ink hover:underline">Open review <ArrowUpRight size={13} /></Link>} />
        <div className="card divide-y divide-line">
          {key.length ? key.slice(0, 5).map((d) => (
            <div key={d.key} className="flex items-start gap-3 px-5 py-3">
              <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", d.severity === "high" ? "bg-bad" : d.severity === "medium" ? "bg-warn" : "bg-ink-4")} title={`${d.severity} priority`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] leading-snug text-ink">{d.title}</div>
                <div className="mt-0.5 truncate text-[12px] text-ink-3">{d.path} · {d.detail}</div>
              </div>
              {!span.periods.some((p) => hasReason(d.line, p)) && d.kind !== "under" && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-ink-3">needs a reason</span>}
            </div>
          )) : <div className="px-5 py-6 text-center text-[13px] text-ink-3">Nothing material to review for {span.label}.</div>}
        </div>
      </section>

      <section aria-label="Trend">
        <SectionHead title="Month by month" hint={`${L.plan}, ${L.forecast.toLowerCase()} and ${L.actual.toLowerCase()} across the year`} />
        <MonthlySpendChart tree={tree} selected={span.periods} />
      </section>

      <Collapsible id="aop:more" title="More detail" sub="Lines that moved away from their own average">
        <div className="space-y-5 border-t border-line p-4">
          <AverageInsights ins={avgIns} labels={L} />
          {more}
        </div>
      </Collapsible>
    </div>
  );
}

function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
      <div><h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>{hint && <p className="text-[12px] text-ink-4">{hint}</p>}</div>
      {action}
    </div>
  );
}
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className="mt-1 font-serif text-[24px] leading-none tabular text-ink">{value}</dd>
      {hint && <dd className="mt-1 truncate text-[11.5px] text-ink-4">{hint}</dd>}
    </div>
  );
}

function LineRow({ l, span, prev, labels: L }: { l: LineNode; span: Span; prev: Span | null; labels: SummaryTree["labels"] }) {
  const a = aggLines([l], span.periods), ap = prev ? aggLines([l], prev.periods) : null;
  const v = { plan: a.hasPlan ? a.plan : null, forecast: a.hasForecast ? a.forecast : null, actual: a.hasActual ? a.actual : null };
  const pv = ap?.hasActual ? ap.actual : null;
  const remarks = span.periods.flatMap((p) => l.remarks[p] ?? []).sort((x, y) => (x.at < y.at ? 1 : -1));
  const latestAny = remarks.length ? remarks : Object.entries(l.remarks).sort(([x], [y]) => (x < y ? 1 : -1))[0]?.[1] ?? [];
  const [hover, setHover] = useState(false);
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseOver={() => !hover && setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => setHover((h) => !h)} className="relative cursor-default border-b border-line/60 hover:bg-subtle/50">
      <td className="relative px-4 py-2 pl-10">
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="truncate">{l.name}</span>
          {remarks.length > 0 && <MessageSquareText size={12} className="shrink-0 text-info" />}
        </span>
        {/* hover card with remarks */}
        {hover && <div className="pointer-events-none absolute left-10 top-full z-20 mt-1 w-[340px] rounded-xl border border-line-strong bg-surface p-3 text-[12.5px]" style={{ boxShadow: "var(--shadow-pop)" }}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium text-ink">{l.name}</span>
            <span className="text-[11px] text-ink-4">{l.owner ?? "No owner"}</span>
          </div>
          <div className="mb-2 grid grid-cols-3 gap-2 text-[11.5px] tabular text-ink-3">
            <span>{L.plan}<br /><b className="font-medium text-ink">{inr(v.plan)}</b></span>
            <span>{L.forecast}<br /><b className="font-medium text-ink">{inr(v.forecast)}</b></span>
            <span>{L.actual}<br /><b className="font-medium text-ink">{inr(v.actual)}</b></span>
          </div>
          {remarks.length ? remarks.slice(0, 3).map((r, i) => (
            <div key={i} className="border-t border-line pt-1.5 mt-1.5">
              <div className="text-[10.5px] uppercase tracking-[0.04em] text-ink-4">{KIND_LABEL[r.kind]} · {r.author ?? "—"} · {ago(r.at)}</div>
              <div className="text-ink-2">{r.body}</div>
            </div>
          )) : latestAny.length ? (
            <div className="border-t border-line pt-1.5 text-ink-3">No remark for this period. Last remark: <span className="text-ink-2">{latestAny[0].body}</span></div>
          ) : l.reference ? <div className="border-t border-line pt-1.5 text-ink-3">{l.reference}</div> : <div className="border-t border-line pt-1.5 text-ink-4">No remarks yet.</div>}
        </div>}
      </td>
      <Num v={v.plan} /><Num v={v.forecast} /><Num v={v.actual} />
      <td className="px-3 py-2 text-right">{v.actual != null && a.planReported ? <Gap dir={l.direction} base={a.planReported} value={v.actual} small /> : <Dash />}</td>
      <td className="px-3 py-2 text-right">{v.actual != null && a.forecastReported ? <Gap dir={l.direction} base={a.forecastReported} value={v.actual} small /> : <Dash />}</td>
      <td className="px-3 py-2 text-right">{v.actual != null && pv ? <Mom dir={l.direction} prev={pv} cur={v.actual} small /> : <Dash />}</td>
    </tr>
  );
}

const Dash = () => <span className="text-ink-4">—</span>;
function Num({ v, strong }: { v: number | null; strong?: boolean }) {
  return <td className={cn("px-3 py-2 text-right tabular", strong ? "font-medium text-ink" : "text-ink-2")}>{v == null ? <Dash /> : inr(v)}</td>;
}
/** Actual vs a base (budget or provision): ₹ and %, coloured by favourability. */
function Gap({ dir, base, value, small }: { dir: Direction; base: number; value: number; small?: boolean }) {
  const diff = value - base, fav = impactOf(dir, base, value) >= 0, rel = base ? diff / Math.abs(base) : null;
  const tiny = Math.abs(diff) < Math.max(1000, Math.abs(base) * 0.005);
  return (
    <span className={cn("tabular whitespace-nowrap", tiny ? "text-ink-3" : fav ? "text-ok" : "text-bad", small ? "text-[12.5px]" : "")}>
      {inr(diff, { sign: true })}<span className="ml-1 text-[11px] opacity-75">{pct(rel, 0, true)}</span>
    </span>
  );
}
function Mom({ dir, prev, cur, small }: { dir: Direction; prev: number; cur: number; small?: boolean }) {
  const diff = cur - prev, rel = prev ? diff / Math.abs(prev) : null;
  const bad = dir === "lower_better" ? diff > 0 : diff < 0;
  const big = rel != null && Math.abs(rel) >= 0.15;
  return (
    <span className={cn("tabular whitespace-nowrap", !big ? "text-ink-3" : bad ? "text-warn" : "text-ok", small ? "text-[12.5px]" : "")}>
      {diff >= 0 ? "▲" : "▼"} {pct(rel == null ? null : Math.abs(rel), 0)}
    </span>
  );
}
export type { Agg };

/** Quarter / year: lines whose aggregated actual misses budget by the threshold, plus big quarter-on-quarter moves. */
function spanDeviations(tree: SummaryTree, span: Span, prev: Span | null): Deviation[] {
  const out: Deviation[] = [];
  for (const f of tree.functions) {
    const paths: [LineNode, string][] = [...f.lines.map((l) => [l, f.name] as [LineNode, string]), ...f.groups.flatMap((g) => g.lines.map((l) => [l, `${f.name} › ${g.name}`] as [LineNode, string]))];
    for (const [l, path] of paths) {
      const a = aggLines([l], span.periods);
      if (!a.hasActual || !a.planReported) continue;
      const diff = a.actual - a.planReported, rel = diff / Math.abs(a.planReported), fav = impactOf(l.direction, a.planReported, a.actual) >= 0;
      if (Math.abs(diff) >= 100000 && Math.abs(rel) >= tree.threshold)
        out.push({ key: `${l.id}:span`, kind: fav ? "under" : "over", line: l, fnName: f.name, path, period: span.key, amount: diff, pct: rel,
          severity: !fav && Math.abs(rel) > 2 * tree.threshold ? "high" : !fav ? "medium" : "low",
          title: `${l.name} ${inr(Math.abs(diff))} ${fav ? "under" : "over"} ${tree.labels.plan.toLowerCase()} · ${span.short}`,
          detail: `${tree.labels.actual} ${inr(a.actual)} vs ${inr(a.planReported)} (${pct(rel, 0, true)})`, prompt: "", chips: [] });
      if (prev) {
        const b = aggLines([l], prev.periods);
        if (b.hasActual && b.actual) {
          const d2 = a.actual - b.actual, r2 = d2 / Math.abs(b.actual);
          if (Math.abs(d2) >= 200000 && Math.abs(r2) >= 0.25)
            out.push({ key: `${l.id}:qoq`, kind: d2 > 0 ? "mom_up" : "mom_down", line: l, fnName: f.name, path, period: span.key, amount: d2, pct: r2,
              severity: (l.direction === "lower_better" ? d2 > 0 : d2 < 0) && Math.abs(r2) > 0.5 ? "medium" : "low",
              title: `${l.name} ${d2 > 0 ? "up" : "down"} ${pct(Math.abs(r2), 0)} vs ${prev.short}`, detail: `${prev.short} ${inr(b.actual)} → ${span.short} ${inr(a.actual)}`, prompt: "", chips: [] });
        }
      }
    }
  }
  const sev = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => sev[x.severity] - sev[y.severity] || Math.abs(y.amount) - Math.abs(x.amount));
}

