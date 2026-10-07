// Server-safe S&OP display bits.
import { Database, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/format";
import { fmtDate } from "@/lib/dates";
import { accuracyTone, dueLabel, SUB_META, type SubCell } from "@/server/sop/model";

export function SubChip({ cell, showDue = false }: { cell: SubCell; showDue?: boolean }) {
  const m = SUB_META[cell.state];
  const title = cell.submitted_at ? `Submitted ${fmtDate(cell.submitted_at.slice(0, 10))} · due ${fmtDate(cell.due_date)}` : `Due ${fmtDate(cell.due_date)}`;
  return (
    <span title={title} className="inline-flex items-center gap-1.5">
      <Badge tone={m.tone} dot>{m.label}</Badge>
      {showDue && (cell.state === "pending" || cell.state === "late") && (
        <span className={cn("text-[11.5px] tabular", cell.state === "late" ? "text-bad" : "text-ink-3")}>{dueLabel(cell.due_date)}</span>
      )}
    </span>
  );
}

export function DemoBadge({ className, long }: { className?: string; long?: boolean }) {
  return (
    <span title="Demo actuals — will come from Snowflake once access is shared" className={cn("inline-flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-warn ring-1 ring-inset ring-warn/25 bg-warn-soft", className)}>
      <FlaskConical size={11} />
      {long ? "Demo actuals — will come from Snowflake" : "Demo actuals"}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  if (source === "demo") return <DemoBadge />;
  return source === "snowflake"
    ? <Badge tone="info"><Database size={11} />Snowflake</Badge>
    : <Badge tone="muted">Manual actuals</Badge>;
}

export function Variance({ v, className, threshold = 0.2 }: { v: number | null | undefined; className?: string; threshold?: number }) {
  if (v == null) return <span className={cn("text-ink-4", className)}>—</span>;
  const a = Math.abs(v);
  return <span className={cn("tabular", a > threshold ? "font-medium text-bad" : a > threshold / 2 ? "text-warn" : "text-ink-2", className)}>{pct(v, 1, true)}</span>;
}

export function AccuracyText({ a, threshold = 0.2, className }: { a: number | null | undefined; threshold?: number; className?: string }) {
  const tone = accuracyTone(a ?? null, threshold);
  return <span className={cn("tabular", tone === "red" ? "text-bad" : tone === "amber" ? "text-warn" : tone === "green" ? "text-ok" : "text-ink-4", className)}>{a == null ? "—" : pct(a)}</span>;
}

export function Bar2({ value, max, tone = "neutral" }: { value: number; max: number; tone?: "neutral" | "red" }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", tone === "red" ? "bg-bad" : "bg-ink-3")} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}
