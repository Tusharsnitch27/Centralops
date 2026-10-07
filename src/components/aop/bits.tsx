// Server-safe AOP display atoms.
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { STATUS_META, type AopStatus } from "@/server/aop/calc";

export function AopStatusBadge({ status, className }: { status: AopStatus; className?: string }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone} dot className={className}>{m.label}</Badge>;
}

/** Raw variance (actual − plan) with sign; colour by favourability. */
export function Variance({ variance, base, impact, className, showPct = true, tolerance = 0.005 }: { variance: number; base: number; impact: number; className?: string; showPct?: boolean; tolerance?: number }) {
  const p = base ? variance / Math.abs(base) : null;
  const neutral = !base || Math.abs(impact) / Math.abs(base) < tolerance;
  return (
    <span className={cn("tabular", neutral ? "text-ink-3" : impact < 0 ? "text-bad" : "text-ok", className)}>
      {inr(variance, { sign: true })}{showPct && p != null && <span className="ml-1 text-[0.92em] opacity-80">{pct(p, 1, true)}</span>}
    </span>
  );
}

export function Meter({ value, tone = "neutral", marker }: { value: number; tone?: "neutral" | "red" | "amber" | "green"; marker?: number }) {
  const v = Math.max(0, Math.min(1.25, value || 0));
  return (
    <div className="relative h-1.5 w-full rounded-full bg-muted">
      <div className={cn("h-full rounded-full", tone === "red" ? "bg-bad" : tone === "amber" ? "bg-warn" : tone === "green" ? "bg-ok" : "bg-ink-2")} style={{ width: `${(Math.min(v, 1) * 100).toFixed(1)}%` }} />
      {marker != null && <div className="absolute -top-0.5 h-2.5 w-px bg-ink-3" style={{ left: `${Math.min(100, marker * 100)}%` }} />}
    </div>
  );
}
