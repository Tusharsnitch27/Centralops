// Shared server-safe meeting UI bits.
import Link from "next/link";
import { CalendarDays, FileText, Layers, Repeat, FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateOf, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import type { MomStatus, Tone } from "@/lib/meta";

export type Phase = "upcoming" | "live" | "ended";
export const phaseOf = (m: { starts_at: string | Date; ends_at: string | Date | null }, now = Date.now()): Phase => {
  const s = new Date(m.starts_at).getTime();
  const e = m.ends_at ? new Date(m.ends_at).getTime() : s + 30 * 60000;
  return now < s ? "upcoming" : now <= e ? "live" : "ended";
};

/** What to show for a meeting's MoM state, taking time into account (an upcoming meeting isn't "pending"). */
export function momDisplay(m: { starts_at: string | Date; ends_at: string | Date | null; mom_status: MomStatus }): { label: string; tone: Tone } {
  const ph = phaseOf(m);
  if (m.mom_status === "pending" || m.mom_status === "draft") {
    if (ph === "upcoming") return { label: "Upcoming", tone: "neutral" };
    if (ph === "live") return { label: "In progress", tone: "info" };
    const hrs = (Date.now() - new Date(m.ends_at ?? m.starts_at).getTime()) / 3600000;
    if (m.mom_status === "draft") return { label: "MoM draft", tone: "amber" };
    return hrs > 24 ? { label: "MoM overdue", tone: "red" } : { label: "MoM pending", tone: "amber" };
  }
  if (m.mom_status === "submitted") return { label: "Awaiting review", tone: "info" };
  if (m.mom_status === "distributed") return { label: "Distributed", tone: "green" };
  if (m.mom_status === "skipped") return { label: "Skipped", tone: "muted" };
  return { label: "Not relevant", tone: "muted" };
}
export function MomBadge({ m, className }: { m: { starts_at: string | Date; ends_at: string | Date | null; mom_status: MomStatus }; className?: string }) {
  const d = momDisplay(m);
  return <Badge tone={d.tone} dot className={className}>{d.label}</Badge>;
}

export const timeRange = (s: string | Date, e: string | Date | null) => `${fmtTime(s)}${e ? ` – ${fmtTime(e)}` : ""}`;
export const durationMins = (s: string | Date, e: string | Date | null) => (e ? Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000) : null);
export const fmtDuration = (mins: number | null) => (mins == null ? "" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`);
export function dayLabel(ts: string | Date) {
  const d = dateOf(typeof ts === "string" ? ts : ts.toISOString());
  const r = relDay(d);
  return ["Today", "Tomorrow", "Yesterday"].includes(r) ? `${r} · ${fmtDate(d, { dow: true })}` : fmtDate(d, { dow: true });
}
export const isToday = (ts: string | Date) => dateOf(typeof ts === "string" ? ts : ts.toISOString()) === today();

export function LinkChips({ m, className }: { m: { review_id?: string | null; review_name?: string | null; project_id?: string | null; project_name?: string | null; project_code?: string | null; program_id?: string | null; program_name?: string | null }; className?: string }) {
  const chip = "inline-flex max-w-[220px] items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11.5px] text-ink-3 ring-1 ring-inset ring-line transition-colors hover:text-ink hover:ring-line-strong";
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {m.review_name && <span className={chip}><Repeat size={11} className="shrink-0" /><span className="truncate">{m.review_name}</span></span>}
      {m.project_name && <Link href={`/tasks/goals#project-${m.project_id}`} className={chip}><FolderKanban size={11} className="shrink-0" /><span className="truncate">{m.project_code ?? m.project_name}</span></Link>}
      {m.program_name && !m.project_name && <span className={chip}><Layers size={11} className="shrink-0" /><span className="truncate">{m.program_name}</span></span>}
    </span>
  );
}

export function SourceTag({ source }: { source: "calendar" | "manual" }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
      {source === "calendar" ? <CalendarDays size={12} /> : <FileText size={12} />}
      {source === "calendar" ? "Google Calendar" : "Added manually"}
    </span>
  );
}
