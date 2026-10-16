// Server components: project card + table rows.
import Link from "next/link";
import { AlertTriangle, CalendarClock, Flag, ShieldAlert } from "lucide-react";
import { Avatar, Badge, HealthBadge, Progress } from "@/components/ui";
import { cn } from "@/lib/cn";
import { diffDays, fmtDate, relDay, today } from "@/lib/dates";
import { HEALTH, type Tone } from "@/lib/meta";
import { PROJECT_STATUS, pctInt } from "@/server/projects/metrics";
import type { ProjectListItem } from "@/server/projects/queries";

const healthTone = (h: keyof typeof HEALTH) => HEALTH[h].tone as Tone;

export function ProjectStatusBadge({ status }: { status: keyof typeof PROJECT_STATUS }) {
  const m = PROJECT_STATUS[status];
  return <Badge tone={m.tone as Tone}>{m.label}</Badge>;
}

function TargetLabel({ date }: { date: string | null }) {
  if (!date) return <span className="text-ink-4">No target</span>;
  const d = diffDays(date, today());
  return <span className={cn("tabular", d < 0 ? "font-medium text-bad" : "text-ink-2")} title={fmtDate(date, { year: true })}>{d < 0 ? `${-d}d past target` : fmtDate(date)}</span>;
}

export function NextMilestone({ p, compact }: { p: ProjectListItem; compact?: boolean }) {
  if (!p.next_ms_title) return <span className="text-ink-4">{p.ms_total ? "All milestones done" : "No milestones"}</span>;
  const overdue = p.next_ms_due && p.next_ms_due < today();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Flag size={12} className={cn("shrink-0", overdue ? "text-bad" : "text-ink-4")} />
      <span className={cn("truncate", compact ? "max-w-[200px]" : "")}>{p.next_ms_title}</span>
      <span className={cn("shrink-0 tabular", overdue ? "font-medium text-bad" : "text-ink-3")}>{relDay(p.next_ms_due)}</span>
      {!!p.next_ms_slip && p.next_ms_slip > 0 && <span className="shrink-0 rounded bg-warn-soft px-1 text-[11px] font-medium text-warn tabular">+{p.next_ms_slip}d</span>}
    </span>
  );
}

export function ProjectCard({ p }: { p: ProjectListItem }) {
  const pc = pctInt(p.progress);
  return (
    <Link href={`/projects/${p.id}`} className="card group flex flex-col gap-3 p-4 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_4px_16px_-6px_rgb(24_24_27/0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2 font-mono text-[11px] text-ink-4">{p.code ?? "—"}{p.status !== "active" && <ProjectStatusBadge status={p.status} />}</div>
          <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{p.name}</div>
        </div>
        <HealthBadge health={p.health} className="shrink-0" />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px]">
          <span className="text-ink-3">Progress</span>
          <span className="font-medium tabular text-ink">{pc}%</span>
        </div>
        <Progress value={p.progress} tone={p.health === "on_track" ? "neutral" : healthTone(p.health)} />
      </div>
      <div className="text-[12.5px] text-ink-2"><NextMilestone p={p} compact /></div>
      <div className="mt-auto flex items-center gap-3 border-t border-line/70 pt-3 text-[12px]">
        <Avatar name={p.owner_name} color={p.owner_color} size={20} />
        <span className="flex items-center gap-1 text-ink-3"><CalendarClock size={12} /><TargetLabel date={p.target_date} /></span>
        <span className="ml-auto flex items-center gap-2.5">
          {p.overdue_tasks > 0 && <span className="flex items-center gap-1 font-medium text-bad" title="Overdue tasks"><AlertTriangle size={12} />{p.overdue_tasks}</span>}
          {p.ms_slipped > 0 && <span className="flex items-center gap-1 font-medium text-warn" title="Slipped milestones"><Flag size={12} />{p.ms_slipped}</span>}
          {p.open_risks > 0 && <span className={cn("flex items-center gap-1", (p.top_risk_score ?? 0) >= 15 ? "font-medium text-bad" : "text-ink-3")} title="Open risks"><ShieldAlert size={12} />{p.open_risks}</span>}
        </span>
      </div>
    </Link>
  );
}

export function ProjectTable({ projects }: { projects: ProjectListItem[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-[30%]">Project</th><th>Health</th><th>Status</th><th>Owner</th><th className="w-[130px]">Progress</th><th>Target</th>
            <th className="text-right">Overdue</th><th className="text-right">Risks</th><th>Next milestone</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/projects/${p.id}`} className="flex min-w-0 items-center gap-2 hover:underline hover:decoration-line-strong hover:underline-offset-4">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-ink-4">{p.code}</span>
                  <span className="truncate font-medium text-ink">{p.name}</span>
                </Link>
              </td>
              <td><HealthBadge health={p.health} /></td>
              <td><ProjectStatusBadge status={p.status} /></td>
              <td><span className="flex items-center gap-1.5"><Avatar name={p.owner_name} color={p.owner_color} size={20} /><span className="text-ink-2">{p.owner_name ?? "—"}</span></span></td>
              <td><span className="flex items-center gap-2"><Progress value={p.progress} className="w-16" tone={p.health === "on_track" ? "neutral" : healthTone(p.health)} /><span className="tabular text-ink-2">{pctInt(p.progress)}%</span></span></td>
              <td className="whitespace-nowrap"><TargetLabel date={p.target_date} /></td>
              <td className={cn("text-right tabular", p.overdue_tasks ? "font-medium text-bad" : "text-ink-4")}>{p.overdue_tasks || "—"}</td>
              <td className={cn("text-right tabular", p.open_risks ? "text-ink-2" : "text-ink-4")}>{p.open_risks || "—"}</td>
              <td className="max-w-[280px] text-[12.5px] text-ink-2"><NextMilestone p={p} compact /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
