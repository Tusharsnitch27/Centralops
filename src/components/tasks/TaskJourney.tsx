import {
  AlertOctagon, ArrowRight, BellRing, CalendarClock, CircleCheck, CircleDot, Eye, Flag, Link2, MessageSquare, PenLine, Play, RotateCcw, Sparkles, UserPlus, XCircle, Unlock,
} from "lucide-react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ago, dateOf, diffDays, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { TASK_SOURCE } from "@/lib/meta";
import type { JourneyEvent } from "@/server/tasks/detail";

type Tone = "neutral" | "info" | "green" | "amber" | "red";
const RING: Record<Tone, string> = {
  neutral: "bg-surface text-ink-3 ring-line-strong",
  info: "bg-info-soft text-info ring-info/25",
  green: "bg-ok-soft text-ok ring-ok/25",
  amber: "bg-warn-soft text-warn ring-warn/30",
  red: "bg-bad-soft text-bad ring-bad/25",
};

interface Rendered { icon: React.ReactNode; tone: Tone; headline: React.ReactNode; change?: { from: string | null; to: string | null }; note?: string | null; quote?: boolean; milestone?: boolean }

const B = ({ children }: { children: React.ReactNode }) => <span className="font-medium text-ink">{children}</span>;

function render(e: JourneyEvent, dueDate: string | null): Rendered {
  const who = <B>{e.actor_name ?? "System"}</B>;
  switch (e.event) {
    case "created": {
      const src = e.to_value && e.to_value !== "manual" ? TASK_SOURCE[e.to_value as keyof typeof TASK_SOURCE] ?? e.to_value : null;
      return { icon: <Sparkles size={13} />, tone: "neutral", headline: <>{who} created the task{src && <> from <B>{src}</B></>}</>, note: e.note, milestone: true };
    }
    case "assigned":
      return e.from_label
        ? { icon: <UserPlus size={13} />, tone: "info", headline: <>{who} reassigned the task</>, change: { from: e.from_label, to: e.to_label ?? "Unassigned" }, note: e.note }
        : { icon: <UserPlus size={13} />, tone: "info", headline: <>{who} assigned it to <B>{e.to_label ?? "nobody"}</B></>, note: e.note };
    case "acknowledged":
      return { icon: <Eye size={13} />, tone: "green", headline: <>{who} acknowledged the task</> };
    case "status_changed":
      return { icon: e.to_value === "In progress" ? <Play size={12} /> : <CircleDot size={13} />, tone: e.to_value === "In progress" ? "info" : e.to_value === "Waiting" ? "amber" : "neutral",
        headline: <>{who} moved it to <B>{e.to_value}</B></>, change: { from: e.from_value, to: e.to_value }, note: e.note, quote: true };
    case "blocked":
      return { icon: <AlertOctagon size={13} />, tone: "red", headline: <>{who} flagged it as <span className="font-medium text-bad">blocked</span></>, note: e.note, quote: true };
    case "unblocked":
      return { icon: <Unlock size={13} />, tone: "green", headline: <>{who} unblocked it</>, change: { from: e.from_value, to: e.to_value }, note: e.note, quote: true };
    case "updated":
      if (e.from_value != null || e.to_value != null)
        return { icon: <PenLine size={13} />, tone: "neutral", headline: <>{who} changed the {(e.note ?? "details").toLowerCase()}</>, change: { from: e.from_label, to: e.to_label } };
      return { icon: <MessageSquare size={13} />, tone: "neutral", headline: <>{who} posted an update</>, note: e.note, quote: true };
    case "due_changed": {
      const slip = e.from_value && e.to_value ? diffDays(e.to_value.slice(0, 10), e.from_value.slice(0, 10)) : 0;
      return { icon: <CalendarClock size={13} />, tone: slip > 0 ? "amber" : "neutral",
        headline: <>{who} {e.from_value ? (e.to_value ? <>moved the due date{slip ? <span className={cn("ml-1 text-[12px]", slip > 0 ? "text-warn" : "text-ok")}>({slip > 0 ? `+${slip}` : slip}d)</span> : null}</> : "cleared the due date") : <>set the due date</>}</>,
        change: { from: e.from_label, to: e.to_label }, note: e.note, quote: true };
    }
    case "priority_changed":
      return { icon: <Flag size={13} />, tone: e.to_value === "urgent" ? "red" : "neutral", headline: <>{who} changed priority</>, change: { from: e.from_label, to: e.to_label } };
    case "completed": {
      const done = dateOf(e.created_at);
      const delta = dueDate ? diffDays(dueDate, done) : null;
      return { icon: <CircleCheck size={13} />, tone: "green", milestone: true,
        headline: <>{who} completed the task{delta != null && <span className={cn("ml-1.5 text-[12px]", delta >= 0 ? "text-ok" : "text-bad")}>{delta > 0 ? `${delta}d early` : delta === 0 ? "on the due date" : `${-delta}d late`}</span>}</>, note: e.note, quote: true };
    }
    case "reopened":
      return { icon: <RotateCcw size={13} />, tone: "amber", headline: <>{who} reopened it</>, change: { from: e.from_value, to: e.to_value }, note: e.note, quote: true };
    case "cancelled":
      return { icon: <XCircle size={13} />, tone: "neutral", headline: <>{who} cancelled the task</>, note: e.note, quote: true };
    case "commented":
      return { icon: <MessageSquare size={13} />, tone: "neutral", headline: <>{who} commented</>, note: e.note, quote: true };
    case "followed_up":
      return { icon: <BellRing size={13} />, tone: "amber", headline: <>{who} requested an update{e.to_label && <span className="text-ink-3"> via {e.to_label}</span>}</>, note: e.note, quote: true };
    case "linked":
      return { icon: <Link2 size={13} />, tone: "neutral",
        headline: e.note === "Blocked by" ? <>{who} added a blocker: <B>{e.to_value}</B></> : <>{who} {e.to_label ? <>linked it to {(e.note ?? "").toLowerCase() || "an object"} <B>{e.to_label}</B></> : <>removed the {(e.note ?? "link").toLowerCase()}</>}</> };
    default:
      return { icon: <CircleDot size={13} />, tone: "neutral", headline: <>{who} · {e.event.replace(/_/g, " ")}</>, note: e.note };
  }
}

const dayLabel = (d: string) => {
  const r = relDay(d);
  return r === "Today" || r === "Yesterday" ? `${r} · ${fmtDate(d, { dow: true })}` : fmtDate(d, { dow: true });
};

/** The task journey — an append-only accountability timeline from task_history. */
export function TaskJourney({ events, open, dueDate, ownerLabel }: { events: JourneyEvent[]; open: boolean; dueDate: string | null; ownerLabel: string | null }) {
  const days: { day: string; items: JourneyEvent[] }[] = [];
  for (const e of events) {
    const d = dateOf(e.created_at);
    const last = days[days.length - 1];
    if (last?.day === d) last.items.push(e); else days.push({ day: d, items: [e] });
  }
  const td = today();
  return (
    <ol className="relative">
      {days.map((g, gi) => (
        <li key={g.day}>
          <div className={cn("relative flex items-center gap-3 pb-3 pt-1 before:absolute before:bottom-0 before:left-[13.5px] before:w-px before:bg-line", gi === 0 ? "before:top-1/2" : "before:top-0")}>
            <span className="relative z-[1] flex w-7 justify-center"><span className="size-1.5 rounded-full bg-ink-4/60" /></span>
            <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-3">{dayLabel(g.day)}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ol>
            {g.items.map((e) => {
              const r = render(e, dueDate);
              return (
                <li key={e.id} className="group relative flex gap-3 pb-5 before:absolute before:bottom-0 before:left-[13.5px] before:top-0 before:w-px before:bg-line">
                  <span className={cn("relative z-[1] mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1", RING[r.tone], r.milestone && "ring-2")}>
                    {r.icon}
                  </span>
                  <div className="min-w-0 flex-1 pt-[3px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <div className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
                        {e.actor_name && <Avatar name={e.actor_name} color={e.actor_color} size={18} className="ring-1" />}
                        <span className="min-w-0">{r.headline}</span>
                      </div>
                      <time dateTime={new Date(e.created_at).toISOString()} title={`${fmtDate(dateOf(e.created_at), { dow: true, year: true })} · ${fmtTime(e.created_at)}`}
                        className="shrink-0 text-[11.5px] tabular text-ink-4">
                        {ago(e.created_at)} <span className="text-ink-4/70">· {fmtTime(e.created_at)}</span>
                      </time>
                    </div>
                    {r.change && (r.change.from || r.change.to) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                        {r.change.from && <span className="rounded-md bg-subtle px-1.5 py-0.5 text-ink-3 line-through decoration-ink-4/60">{r.change.from}</span>}
                        {r.change.from && r.change.to && <ArrowRight size={12} className="text-ink-4" />}
                        {r.change.to && <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-ink ring-1 ring-inset ring-line">{r.change.to}</span>}
                      </div>
                    )}
                    {r.note && (
                      r.quote
                        ? <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-2">{r.note}</p>
                        : <p className="mt-1 text-[12.5px] text-ink-3">{r.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
      {open && (
        <li className="relative flex gap-3">
          <span className="relative z-[1] mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong bg-canvas text-ink-4">
            <CircleCheck size={13} />
          </span>
          <div className="pt-[5px] text-[13px] text-ink-3">
            {dueDate
              ? dueDate < td
                ? <>Awaiting completion from {ownerLabel ?? "the owner"} — <span className="font-medium text-bad">{diffDays(td, dueDate)}d past due</span></>
                : <>Awaiting completion from {ownerLabel ?? "the owner"} · due {relDay(dueDate).toLowerCase()}</>
              : <>Awaiting completion from {ownerLabel ?? "the owner"} · no due date</>}
          </div>
        </li>
      )}
    </ol>
  );
}

/** One-line digest above the journey: time to acknowledge, slips, follow-ups. */
export function journeySummary(events: JourneyEvent[]) {
  const created = events.find((e) => e.event === "created");
  const ack = events.find((e) => e.event === "acknowledged" || (e.event === "status_changed" && e.to_value === "In progress"));
  const slips = events.filter((e) => e.event === "due_changed" && e.from_value).length;
  const nudges = events.filter((e) => e.event === "followed_up").length;
  const updates = events.filter((e) => e.event === "updated" && e.from_value == null && e.to_value == null).length;
  const out: string[] = [];
  if (created && ack) {
    const h = Math.max(0, Math.round((new Date(ack.created_at).getTime() - new Date(created.created_at).getTime()) / 3600000));
    out.push(`Acknowledged in ${h < 1 ? "under an hour" : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`}`);
  } else if (created) out.push("Not yet acknowledged");
  out.push(`${updates} update${updates === 1 ? "" : "s"}`);
  if (slips) out.push(`${slips} due-date change${slips === 1 ? "" : "s"}`);
  if (nudges) out.push(`${nudges} follow-up${nudges === 1 ? "" : "s"}`);
  return out;
}
