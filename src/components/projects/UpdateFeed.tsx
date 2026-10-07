// Server component: project update feed; each update is compared with the one before it.
import { ArrowRight, MessageSquareText } from "lucide-react";
import { Avatar, Badge, HealthBadge } from "@/components/ui";
import { ago, dateOf, diffDays, fmtDate } from "@/lib/dates";
import { HEALTH, type Tone } from "@/lib/meta";
import type { ProjectUpdate } from "@/server/projects/queries";

export interface DiffChip { label: string; tone: Tone }

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/[.\s]+$/, "");
const hasText = (s: string | null) => !!s && !/^(none|nil|na|n\/a|-|no)\.?$/i.test(s.trim());

/** What changed between two consecutive updates. */
export function diffUpdates(cur: ProjectUpdate, prev: ProjectUpdate | undefined): DiffChip[] {
  if (!prev) return [{ label: "First update", tone: "neutral" }];
  const out: DiffChip[] = [];
  if (cur.expected_completion && prev.expected_completion && cur.expected_completion !== prev.expected_completion) {
    const d = diffDays(cur.expected_completion, prev.expected_completion);
    out.push({ label: `Expected completion ${d > 0 ? "+" : "−"}${Math.abs(d)}d`, tone: d > 0 ? "amber" : "green" });
  } else if (cur.expected_completion && !prev.expected_completion) out.push({ label: `Completion set ${fmtDate(cur.expected_completion)}`, tone: "info" });
  if (cur.health && prev.health && cur.health !== prev.health) {
    const worse = ["on_track", "at_risk", "delayed"].indexOf(cur.health) > ["on_track", "at_risk", "delayed"].indexOf(prev.health);
    out.push({ label: `Health ${HEALTH[prev.health].label} → ${HEALTH[cur.health].label}`, tone: worse ? (cur.health === "delayed" ? "red" : "amber") : "green" });
  }
  if (cur.percent_complete != null && prev.percent_complete != null && cur.percent_complete !== prev.percent_complete) {
    const up = cur.percent_complete > prev.percent_complete;
    out.push({ label: `% ${prev.percent_complete} → ${cur.percent_complete}`, tone: up ? "neutral" : "amber" });
  } else if (cur.percent_complete != null && prev.percent_complete != null && cur.percent_complete === prev.percent_complete) {
    out.push({ label: `No progress (${cur.percent_complete}%)`, tone: "amber" });
  }
  if (hasText(cur.blockers) && !hasText(prev.blockers)) out.push({ label: "New blocker", tone: "red" });
  else if (!hasText(cur.blockers) && hasText(prev.blockers)) out.push({ label: "Blocker cleared", tone: "green" });
  else if (hasText(cur.blockers) && hasText(prev.blockers) && norm(cur.blockers) !== norm(prev.blockers)) out.push({ label: "Blocker changed", tone: "amber" });
  else if (hasText(cur.blockers) && norm(cur.blockers) === norm(prev.blockers)) out.push({ label: "Same blocker as last time", tone: "amber" });
  if (hasText(cur.decisions_required) && !hasText(prev.decisions_required)) out.push({ label: "Decision needed", tone: "amber" });
  const gap = diffDays(dateOf(new Date(cur.created_at)), dateOf(new Date(prev.created_at)));
  if (gap > 0) out.push({ label: `${gap}d since previous`, tone: "muted" });
  return out;
}

export function UpdateFeed({ updates, empty }: { updates: ProjectUpdate[]; empty?: React.ReactNode }) {
  if (!updates.length) return <>{empty}</>;
  return (
    <ol className="relative space-y-4 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-line">
      {updates.map((u, i) => {
        const chips = diffUpdates(u, updates[i + 1]);
        return (
          <li key={u.id} className="relative flex gap-3">
            <Avatar name={u.author_name} color={u.author_color} size={30} className="z-10" />
            <div className="card min-w-0 flex-1 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{u.author_name ?? "Someone"}</span>
                <span className="text-[12px] text-ink-3" title={new Date(u.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>{ago(u.created_at)}</span>
                <span className="ml-auto flex items-center gap-2">
                  {u.health && <HealthBadge health={u.health} />}
                  {u.percent_complete != null && <span className="text-[12px] font-medium tabular text-ink-2">{u.percent_complete}%</span>}
                </span>
              </div>
              {chips.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{chips.map((c) => <Badge key={c.label} tone={c.tone}>{c.label}</Badge>)}</div>}
              <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[150px_1fr]">
                <Row label="What changed" value={u.what_changed} />
                {u.progress && norm(u.progress) !== norm(u.what_changed) && <Row label="Progress" value={u.progress} />}
                {hasText(u.blockers) && <Row label="Blockers" value={u.blockers} tone="text-bad" />}
                {hasText(u.decisions_required) && <Row label="Decisions required" value={u.decisions_required} tone="text-warn" />}
                {u.next_steps && <Row label="Next steps" value={u.next_steps} />}
                {u.expected_completion && <Row label="Expected completion" value={fmtDate(u.expected_completion, { year: true })} />}
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value, tone }: { label: string; value: string | null; tone?: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-[12px] text-ink-3 sm:pt-px">{label}</dt>
      <dd className={`whitespace-pre-line text-ink-2 ${tone ?? ""}`}>{value}</dd>
    </>
  );
}

/** Compact "latest vs previous" strip for the overview. */
export function LatestUpdateStrip({ updates }: { updates: ProjectUpdate[] }) {
  const [cur, prev] = updates;
  if (!cur) return null;
  const chips = diffUpdates(cur, prev).filter((c) => c.tone !== "muted");
  return (
    <div className="flex items-start gap-3">
      <MessageSquareText size={15} className="mt-0.5 shrink-0 text-ink-4" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink-2"><span className="font-medium text-ink">{cur.author_name}</span> · {ago(cur.created_at)}<ArrowRight size={11} className="mx-1 inline text-ink-4" />{cur.what_changed}</div>
        {chips.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{chips.map((c) => <Badge key={c.label} tone={c.tone}>{c.label}</Badge>)}</div>}
      </div>
    </div>
  );
}
