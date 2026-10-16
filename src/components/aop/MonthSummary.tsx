"use client";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, MessageSquareText, ArrowUpRight } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { ago } from "@/lib/dates";
import { impactOf, monLabel, monShort, type Direction } from "@/server/aop/calc";
import type { LineNode, SummaryTree } from "@/server/aop/summaryData";
import { FunctionBars, MonthlySpendChart } from "./SummaryCharts";
import { activeMonths, aggLines, averageInsights, customSpan, deviationsFor, momLike, fnLines, hasReason, prevSpan, priorWindow, spansFor, type Agg, type Deviation, type Grain, type Span } from "./summaryMath";
import { AverageInsights } from "./AverageInsights";

const KIND_LABEL = { commentary: "Remark", variance_reason: "Reason", corrective_action: "Action" } as const;

/** Month filter + function → line summary (Budget / Provision / Actuals / gaps / MoM) + key items to review. */
export function MonthSummary({ tree, reviewHref }: { tree: SummaryTree; reviewHref: string }) {
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

  return (
    <div>
      {/* Period filter: month · quarter · year */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="seg">
          <span className="seg-label">View</span>
          {(["month", "quarter", "year", "custom"] as Grain[]).map((g) => (
            <button key={g} data-on={grain === g} onClick={() => { setGrain(g); setSpanKey(defaultKey(g)); }} className="seg-item capitalize">{g}</button>
          ))}
        </div>
        {grain === "custom" ? (
          <div className="seg">
            <span className="seg-label">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-full border border-line bg-subtle px-3 text-[13px] font-semibold text-ink outline-none">
              {months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
            </select>
            <span className="seg-label">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-full border border-line bg-subtle px-3 text-[13px] font-semibold text-ink outline-none">
              {months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
            </select>
            <span className="px-2 text-[12.5px] font-medium text-ink-3">{span.periods.length} month{span.periods.length === 1 ? "" : "s"}</span>
          </div>
        ) : (
        <div className="seg max-w-full overflow-x-auto [scrollbar-width:none]">
          <span className="seg-label">Period</span>
          {spans.map((x) => (
            <button key={x.key} data-on={x.key === span.key} onClick={() => setSpanKey(x.key)} title={x.label} className={cn("seg-item shrink-0 tabular", !x.closed && x.key !== span.key && "text-ink-4")}>
              {grain === "month" ? monShort(x.key) : x.short}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Headline tile */}
      <div className="hero mb-6 grid gap-6 p-6 md:p-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-between gap-6">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">Opex · {span.label}</div>
            <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] tabular text-white">{total.hasActual ? inr(total.actual) : "—"}</span>
              {total.hasActual && total.planReported > 0 && (
                <span className={cn("mb-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold", total.actual > total.planReported ? "bg-[#ff6b6b]/20 text-[#ffb3b3]" : "text-white")}
                  style={total.actual <= total.planReported ? { background: "color-mix(in srgb, var(--color-accent) 45%, transparent)" } : undefined}>
                  {pct((total.actual - total.planReported) / total.planReported, 1, true)} vs {L.plan.toLowerCase()}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[13px] font-medium text-white/60">{L.actual} · {L.plan} {inr(total.plan)}</div>
            <p className="mt-4 max-w-[560px] text-[13px] leading-relaxed text-white/80">
              {total.hasActual ? <>Reported lines are <b className="font-semibold text-white">{inr(Math.abs(total.actual - total.planReported))} {total.actual > total.planReported ? `over ${L.plan.toLowerCase()}` : `under ${L.plan.toLowerCase()}`}</b>. </> : null}
              {total.missing ? <><b className="font-semibold text-white">{total.missing} line{total.missing === 1 ? "" : "s"}</b> still to report {L.actual.toLowerCase()}. </> : closed ? "Every line has reported. " : null}
              {devs.length ? <><b className="font-semibold text-white">{devs.length} item{devs.length === 1 ? "" : "s"}</b> flagged for review.</> : null}
            </p>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-[12px] font-medium text-white/60"><span>{L.actual} vs {L.plan}</span><span className="font-semibold text-white">{total.plan ? pct(total.actual / total.plan, 0) : "—"}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, total.plan ? (total.actual / total.plan) * 100 : 0)}%`, background: "linear-gradient(90deg, var(--color-accent), var(--color-accent-2))" }} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <HeroTile label={L.plan} value={inr(total.plan)} hint={grain === "month" ? "This month" : span.short} />
          <HeroTile label={L.forecast} value={total.hasForecast ? inr(total.forecast) : "—"} hint={total.hasForecast && total.plan ? `${pct(total.forecast / total.plan, 0)} of ${L.plan.toLowerCase()}` : undefined} />
          <HeroTile label={`Gap vs ${L.plan}`} value={total.hasActual ? inr(total.actual - total.planReported, { sign: true }) : "—"} hint="Reported lines only"
            tone={total.hasActual ? (total.actual > total.planReported ? "bad" : "ok") : undefined} />
          <HeroTile label={grain === "quarter" ? "Quarter-on-quarter" : grain === "year" ? "Run-rate / month" : grain === "custom" ? "vs prior period" : "Month-on-month"}
            value={grain === "year" ? (total.hasActual ? inr(total.actual / Math.max(1, span.periods.filter((p) => tree.lastClosed && p <= tree.lastClosed).length)) : "—") : momTotal ? pct((momTotal.cur - momTotal.prev) / momTotal.prev, 0, true) : "—"}
            hint={grain === "year" ? `Avg ${L.actual.toLowerCase()} per closed month` : prev && momTotal ? `vs ${prev.short} · ${momTotal.lines} like-for-like lines` : undefined}
            tone={momTotal && grain !== "year" ? (momTotal.cur > momTotal.prev ? "bad" : "ok") : undefined} />
        </div>
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <MonthlySpendChart tree={tree} selected={span.periods} />
        <FunctionBars tree={tree} periods={span.periods} />
      </div>

      <div className="space-y-5">
        {/* Function table */}
        <div className="card min-w-0 overflow-x-auto lg:overflow-visible">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="thead-hl border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em]">
                <th className="px-4 py-2.5 text-left font-medium">Function · line</th>
                <th className="px-3 py-2.5 text-right font-medium">{L.plan}</th>
                <th className="px-3 py-2.5 text-right font-medium">{L.forecast}</th>
                <th className="px-3 py-2.5 text-right font-medium">{L.actual}</th>
                <th className="px-3 py-2.5 text-right font-medium">vs {L.plan}</th>
                <th className="px-3 py-2.5 text-right font-medium">vs {L.forecast}</th>
                <th className="px-3 py-2.5 text-right font-medium">{grain === "year" ? "" : chg}</th>
              </tr>
            </thead>
            <tbody>
              {tree.functions.map((f) => {
                const a = aggLines(fnLines(f), span.periods), ap = prev ? aggLines(fnLines(f), prev.periods) : null;
                const isOpen = open.has(f.id);
                return (
                  <Fragment key={f.id}>
                    <tr onClick={() => toggle(f.id)} className="cursor-pointer border-b border-line bg-subtle/40 hover:bg-subtle">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={14} className={cn("text-ink-3 transition-transform", isOpen && "rotate-90")} />
                          <span className="font-semibold text-ink">{f.name}</span>
                          <span className="flex items-center gap-1 text-[12px] text-ink-3"><Avatar name={f.owner} size={16} />{f.owner}</span>
                          {a.missing > 0 && closed && <Badge tone="amber">{a.missing} missing</Badge>}
                        </div>
                      </td>
                      <Num v={a.plan} strong /><Num v={a.hasForecast ? a.forecast : null} strong /><Num v={a.hasActual ? a.actual : null} strong />
                      <td className="px-3 py-2.5 text-right">{a.hasActual && a.planReported ? <Gap dir={dir} base={a.planReported} value={a.actual} small /> : <Dash />}</td>
                      <td className="px-3 py-2.5 text-right">{a.hasActual && a.hasForecast ? <Gap dir={dir} base={a.forecastReported} value={a.actual} small /> : <Dash />}</td>
                      <td className="px-3 py-2.5 text-right">{(() => { const mm = grain !== "year" && prev ? momLike(fnLines(f), span.periods, prev.periods) : null; return mm ? <Mom dir={dir} prev={mm.prev} cur={mm.cur} small /> : <Dash />; })()}</td>
                    </tr>
                    {isOpen && [...f.lines.map((l) => ({ l, group: null as string | null })), ...f.groups.flatMap((g) => g.lines.map((l, i) => ({ l, group: i === 0 ? g.name : null })))].map(({ l, group }) => (
                      <Fragment key={l.id}>
                        {group && <tr className="border-b border-line/60"><td colSpan={7} className="px-4 pb-1 pl-10 pt-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-4">{group}</td></tr>}
                        <LineRow l={l} span={span} prev={grain === "year" ? null : prev} labels={L} />
                      </Fragment>
                    ))}
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-line-strong font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <Num v={total.plan} strong /><Num v={total.hasForecast ? total.forecast : null} strong /><Num v={total.hasActual ? total.actual : null} strong />
                <td className="px-3 py-2.5 text-right">{total.hasActual ? <Gap dir={dir} base={total.planReported} value={total.actual} small /> : <Dash />}</td>
                <td className="px-3 py-2.5 text-right">{total.hasActual && total.hasForecast ? <Gap dir={dir} base={total.forecastReported} value={total.actual} small /> : <Dash />}</td>
                <td className="px-3 py-2.5 text-right">{(() => { const mm = grain !== "year" && prev ? momLike(all, span.periods, prev.periods) : null; return mm ? <Mom dir={dir} prev={mm.prev} cur={mm.cur} small /> : <Dash />; })()}</td>
              </tr>
            </tbody>
          </table>
          <div className="border-t border-line px-4 py-2 text-[11.5px] text-ink-4">Click a function to see its lines · hover a line for remarks · gaps compare only lines that have {L.actual.toLowerCase()}</div>
        </div>

        {/* Key items to review */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Key items to review</div>
              <div className="text-[12px] text-ink-3">{span.label} · {devs.length} deviation{devs.length === 1 ? "" : "s"}</div>
            </div>
            <Link href={`${reviewHref}${reviewHref.includes("?") ? "&" : "?"}period=${period}`} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Review <ArrowUpRight size={12} /></Link>
          </div>
          {key.length ? <div className="grid md:grid-cols-2 xl:grid-cols-3 [&>div]:border-b [&>div]:border-line/70 md:[&>div]:border-r">{key.map((d) => (
            <div key={d.key} className="px-4 py-2.5">
              <div className="flex items-start gap-2">
                <span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", d.severity === "high" ? "bg-bad" : d.severity === "medium" ? "bg-warn" : "bg-ink-4")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug text-ink">{d.title}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{d.path} · {d.detail}</div>
                </div>
                {!span.periods.some((p) => hasReason(d.line, p)) && d.kind !== "under" && <Badge tone="muted">No remark</Badge>}
              </div>
            </div>
          ))}</div> : <div className="px-4 py-8 text-center text-[13px] text-ink-3">Nothing material to review for {span.label}.</div>}
        </div>

        <AverageInsights ins={avgIns} labels={L} />
      </div>
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
function Kpi({ label, value, hint, hintTone }: { label: string; value: React.ReactNode; hint?: string; hintTone?: "warn" }) {
  return (
    <div className="min-w-0 border-b border-line md:border-b-0">
      <div className="eyebrow mb-1.5 truncate">{label}</div>
      <div className="whitespace-nowrap font-serif text-[20px] leading-none tabular text-ink">{value}</div>
      {hint && <div className={cn("mt-1.5 truncate text-[11.5px]", hintTone === "warn" ? "text-warn" : "text-ink-3")}>{hint}</div>}
    </div>
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

function HeroTile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
      <div className="text-[11.5px] font-semibold text-white/55">{label}</div>
      <div className={cn("mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular", tone === "bad" ? "text-[#ffb3b3]" : "text-white")}
        style={tone === "ok" ? { color: "var(--color-accent-2)" } : undefined}>{value}</div>
      {hint && <div className="mt-2 truncate text-[11.5px] font-medium text-white/50">{hint}</div>}
    </div>
  );
}
