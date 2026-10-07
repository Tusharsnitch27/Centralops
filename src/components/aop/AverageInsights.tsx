import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { monShort } from "@/server/aop/calc";
import type { AvgInsight, AvgInsights } from "./summaryMath";

/** Increases / decreases vs each line's own monthly average, and the most volatile lines. */
export function AverageInsights({ ins, labels }: { ins: AvgInsights; labels: { actual: string } }) {
  const empty = !ins.increases.length && !ins.decreases.length && !ins.volatile.length;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <div className="text-[16px] font-bold tracking-[-0.01em] text-ink">Insights · variation from average</div>
          <div className="text-[12.5px] font-medium text-ink-3">
            {labels.actual} per month in <b className="font-bold text-ink-2">{ins.focusLabel}</b> compared with each line’s own <b className="font-bold text-ink-2">{ins.baseLabel}</b>
          </div>
        </div>
        <span className="rounded-full bg-subtle px-3 py-1 text-[12px] font-semibold text-ink-3">Threshold ±15% · ₹50K+/mo per line</span>
      </div>
      {empty ? (
        <div className="px-5 py-10 text-center text-[13.5px] text-ink-3">Not enough closed months to compare yet — insights appear once at least two other months have {labels.actual.toLowerCase()}.</div>
      ) : (
        <div className="grid divide-line lg:grid-cols-3 lg:divide-x">
          <Column title="Above average" icon={<TrendingUp size={15} />} tone="up" items={ins.increases} empty="Nothing running materially above its average." />
          <Column title="Below average" icon={<TrendingDown size={15} />} tone="down" items={ins.decreases} empty="Nothing running materially below its average." />
          <Column title="Most variable" icon={<Activity size={15} />} tone="var" items={ins.volatile} empty="No line swings by 25%+ month to month." />
        </div>
      )}
    </div>
  );
}

function Column({ title, icon, tone, items, empty }: { title: string; icon: React.ReactNode; tone: "up" | "down" | "var"; items: AvgInsight[]; empty: string }) {
  return (
    <div className="p-4">
      <div className={cn("mb-3 flex items-center gap-2 text-[13.5px] font-bold",
        tone === "up" ? "text-bad" : tone === "down" ? "text-accent-ink" : "text-ink-2")}>
        <span className={cn("flex size-7 items-center justify-center rounded-lg", tone === "up" ? "bg-bad-soft" : tone === "down" ? "bg-accent-soft" : "bg-subtle")}>{icon}</span>
        {title}
        <span className="ml-auto rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-ink-3">{items.length}</span>
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((i) => {
            const costUp = i.direction === "lower_better";
            const bad = tone === "up" ? costUp : tone === "down" ? !costUp : false;
            return (
              <div key={i.key} className="rounded-2xl border border-line/80 bg-subtle/40 p-3 transition-colors hover:bg-subtle">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-bold text-ink">{i.name}</span>
                      {i.level === "function" && <span className="rounded-md bg-ink px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">Function</span>}
                    </div>
                    <div className="truncate text-[11.5px] font-medium text-ink-4">{i.path}</div>
                  </div>
                  {tone !== "var" ? (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12px] font-extrabold tabular", bad ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-ink")}>{pct(i.deltaPct, 0, true)}</span>
                  ) : <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-extrabold tabular text-warn">±{pct((i as AvgInsight & { cv: number }).cv, 0)}</span>}
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="text-[12px] font-medium text-ink-3">
                    {tone !== "var" ? <><b className="font-bold text-ink">{inr(i.focusAvg)}</b>/mo vs <b className="font-semibold text-ink-2">{inr(i.baseAvg)}</b> avg · <b className={bad ? "font-bold text-bad" : "font-bold text-accent-ink"}>{inr(i.delta, { sign: true })}</b></> : i.note}
                  </div>
                  <Spark series={i.series} tone={tone === "var" ? "var" : bad ? "bad" : "good"} />
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-ink-4">{empty}</div>}
    </div>
  );
}

/** Tiny monthly bar sparkline; the latest bar is emphasised. */
function Spark({ series, tone }: { series: { p: string; v: number | null }[]; tone: "bad" | "good" | "var" }) {
  const vals = series.map((s) => s.v ?? 0), max = Math.max(1, ...vals);
  const color = tone === "bad" ? "linear-gradient(180deg,#f87171,#dc2626)" : tone === "good" ? "linear-gradient(180deg, var(--color-accent-2), var(--color-accent))" : "linear-gradient(180deg,#fbbf24,#d97706)";
  return (
    <div className="flex h-8 shrink-0 items-end gap-[3px]" title={series.map((s) => `${monShort(s.p)} ${s.v == null ? "—" : inr(s.v)}`).join(" · ")}>
      {series.map((s, i) => (
        <span key={s.p} className="w-[5px] rounded-full" style={{ height: `${Math.max(10, ((s.v ?? 0) / max) * 100)}%`, background: s.v == null ? "var(--color-muted)" : color, opacity: i === series.length - 1 ? 1 : 0.5 }} />
      ))}
    </div>
  );
}
