import Link from "next/link";
import { CircleCheck, Sparkles } from "lucide-react";
import { Avatar, AvatarStack } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateOf } from "@/lib/dates";
import type { MeetingRow as Row } from "@/server/meetings/queries";
import { LinkChips, MomBadge, dayLabel, timeRange } from "./bits";

export function MeetingRow({ m, me, showDay }: { m: Row; me: string; showDay?: boolean }) {
  const mine = m.mom_owner_id === me;
  return (
    <div
      className="group relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line/70 px-4 py-3 transition-colors last:border-0 hover:bg-subtle/60 md:grid-cols-[minmax(0,1fr)_150px_110px_150px_150px]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link href={`/meetings/${m.id}`} className="truncate text-[13px] font-medium text-ink before:absolute before:inset-0 before:content-[''] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{m.title}</Link>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
          {showDay && <span>{dayLabel(m.starts_at)}</span>}
          <span className="tabular md:hidden">{timeRange(m.starts_at, m.ends_at)}</span>
          <LinkChips m={m} className="relative z-10" />
        </div>
      </div>
      <div className="hidden text-[12.5px] tabular text-ink-2 md:block">{timeRange(m.starts_at, m.ends_at)}</div>
      <div className="hidden md:block"><AvatarStack people={m.attendees} max={4} size={22} /></div>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        {m.mom_owner_name ? (
          <>
            <Avatar name={m.mom_owner_name} color={m.mom_owner_color} size={20} />
            <span className={cn("truncate text-[12.5px]", mine ? "font-medium text-ink" : "text-ink-2")}>{mine ? "You" : m.mom_owner_name}</span>
          </>
        ) : <span className="text-[12.5px] text-ink-4">No MoM owner</span>}
      </div>
      <div className="flex items-center justify-end gap-2">
        {m.mom_status === "submitted" && m.pending_suggestions > 0 && (
          <span className="hidden items-center gap-1 text-[11.5px] text-info lg:inline-flex"><Sparkles size={12} />{m.pending_suggestions}</span>
        )}
        {m.actions_count > 0 && <span title={`${m.actions_count} actions created`} className="hidden items-center gap-1 text-[11.5px] tabular text-ink-3 lg:inline-flex"><CircleCheck size={12} />{m.actions_count}</span>}
        <MomBadge m={m} />
      </div>
    </div>
  );
}

/** Rows grouped under day headers (or a custom grouping). */
export function MeetingGroups({ groups, me }: { groups: { label: string; hint?: string; rows: Row[] }[]; me: string }) {
  return (
    <div className="space-y-5">
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.label}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{g.label}</h3>
            {g.hint && <span className="text-[12px] text-ink-4">{g.hint}</span>}
          </div>
          <div className="card overflow-hidden">
            {g.rows.map((m) => <MeetingRow key={m.id} m={m} me={me} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export function groupByDay(rows: Row[]) {
  const out: { label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const key = dayLabel(r.starts_at);
    const last = out[out.length - 1];
    if (last && last.label === key) last.rows.push(r);
    else out.push({ label: key, rows: [r] });
  }
  return out;
}
export const dayKey = (r: Row) => dateOf(r.starts_at);
