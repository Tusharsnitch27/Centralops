import Link from "next/link";
import { ArrowUpRight, Gavel, History, TriangleAlert } from "lucide-react";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { fmtDate, dateOf } from "@/lib/dates";
import { RISK_LEVEL } from "@/lib/meta";
import type { DecisionLite, MeetingBrief, MomNote, RiskLite } from "@/server/meetings/queries";
import { parseMom, MOM_SECTIONS } from "./momFormat";

/** Pre-read for recurring reviews: what happened last time, and whether it got done. */
export function BriefCard({ brief, compact }: { brief: MeetingBrief; compact?: boolean }) {
  const c = brief.closure;
  const open = brief.actions.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  return (
    <Card>
      <CardHeader icon={<History size={15} />} title="Meeting brief"
        subtitle={brief.previous ? <>Since the last review · <Link className="hover:text-ink hover:underline" href={`/meetings/${brief.previous.id}`}>{fmtDate(dateOf(brief.previous.starts_at), { dow: true })}</Link></> : "Open items from this series"} />
      <div className="space-y-5 px-4 py-4">
        {brief.previous?.summary && <p className="text-[13px] leading-[1.6] text-ink-2">{brief.previous.summary}</p>}

        {c.total > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Actions from last time</span>
              <span className="text-[12px] tabular text-ink-3">{c.completed}/{c.total} closed</span>
            </div>
            <div className="mb-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="bg-ok" style={{ width: `${(c.completed / c.total) * 100}%` }} />
              <span className="bg-info/70" style={{ width: `${(c.in_progress / c.total) * 100}%` }} />
              <span className="bg-bad" style={{ width: `${(c.overdue / c.total) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" />{c.completed} completed</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-info/70" />{c.in_progress} in progress</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-bad" />{c.overdue} overdue</span>
              {c.not_started > 0 && <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-line-strong" />{c.not_started} not started</span>}
            </div>
            {open.length > 0 && !compact && <div className="-mx-4 mt-3 border-t border-line/70"><TaskList tasks={open} showProject={false} /></div>}
          </div>
        )}

        {brief.carried.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5">Still open from earlier meetings · {brief.carried.length}</div>
            {!compact && <div className="-mx-4 border-y border-line/70"><TaskList tasks={brief.carried.slice(0, 6)} showProject={false} /></div>}
          </div>
        )}

        {brief.decisions.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5">Decisions made</div>
            <DecisionList decisions={brief.decisions} />
          </div>
        )}

        {brief.risks.length > 0 && (
          <div>
            <div className="eyebrow mb-1.5">Open risks</div>
            <RiskList risks={brief.risks} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function DecisionList({ decisions }: { decisions: DecisionLite[] }) {
  return (
    <ul className="space-y-2">
      {decisions.map((d) => (
        <li key={d.id} className="flex gap-2.5">
          <Gavel size={13} className="mt-0.5 shrink-0 text-ink-4" />
          <div className="min-w-0">
            <Link href={"/meetings"} className="text-[13px] text-ink hover:underline">{d.title}</Link>
            {(d.context || d.decision_maker_name) && <div className="text-[12px] text-ink-3">{[d.decision_maker_name, d.context].filter(Boolean).join(" · ")}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RiskList({ risks }: { risks: RiskLite[] }) {
  return (
    <ul className="space-y-2">
      {risks.map((r) => {
        const lvl = RISK_LEVEL(r.score);
        return (
          <li key={r.id} className="flex items-start gap-2.5">
            <TriangleAlert size={13} className={lvl.tone === "red" ? "mt-0.5 shrink-0 text-bad" : lvl.tone === "amber" ? "mt-0.5 shrink-0 text-warn" : "mt-0.5 shrink-0 text-ink-4"} />
            <div className="min-w-0 flex-1">
              <Link href={`/risks/${r.id}`} className="text-[13px] text-ink hover:underline">{r.title}</Link>
              {r.mitigation && <div className="text-[12px] text-ink-3">Mitigation: {r.mitigation}</div>}
            </div>
            <Badge tone={lvl.tone}>{lvl.label}</Badge>
            {r.owner_name && <Avatar name={r.owner_name} color={r.owner_color} size={20} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Read-only MoM, rendered by section. */
export function MomView({ note, collapsed }: { note: MomNote; collapsed?: boolean }) {
  const { sections, structured } = parseMom(note.body);
  const body = structured ? (
    <div className="space-y-4">
      {MOM_SECTIONS.filter((s) => sections[s.key].trim()).map((s) => (
        <div key={s.key} className="grid gap-1 md:grid-cols-[150px_1fr] md:gap-5">
          <div className="text-[12.5px] font-medium text-ink-3">{s.label}</div>
          <p className="whitespace-pre-line text-[13px] leading-[1.65] text-ink-2">{sections[s.key]}</p>
        </div>
      ))}
    </div>
  ) : <p className="whitespace-pre-line text-[13px] leading-[1.65] text-ink-2">{note.body}</p>;
  if (collapsed) {
    return (
      <details className="group card">
        <summary className="bar-dark flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium">
          <span>Minutes {note.author_name ? <span className="font-normal text-ink-3">by {note.author_name}</span> : null}</span>
          <span className="flex items-center gap-1 text-[12px] font-normal text-ink-3">Show <ArrowUpRight size={12} className="transition-transform group-open:rotate-90" /></span>
        </summary>
        <div className="border-t border-line px-4 py-4">{body}</div>
      </details>
    );
  }
  return body;
}
