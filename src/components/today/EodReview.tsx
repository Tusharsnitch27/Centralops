"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, CalendarArrowUp, Check, Moon, NotebookPen, Send } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { moveTasksToTomorrow } from "@/server/meetings/actions";

interface T { id: string; number: number; title: string; due_date: string | null; overdue: boolean }
interface Props {
  completed: { id: string; number: number; title: string }[];
  open: T[];
  meetings: { id: string; title: string; time: string }[];
  followups: { id: string; label: string; person: string | null; color: string | null; href: string }[];
}

/** End-of-day review: what got done, what's still open (roll forward), MoMs still owed, follow-ups pending. */
export function EodReview({ completed, open, meetings, followups }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const move = () => start(async () => {
    const r = await moveTasksToTomorrow([...sel]);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(r.message ?? "Moved", "success"); setSel(new Set()); router.refresh();
  });
  const col = "min-w-0 px-4 py-3.5";
  const head = (icon: React.ReactNode, label: string, n: number) => <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{icon}{label}<span className="rounded-full bg-muted px-1.5 text-[11px] tracking-normal text-ink-2">{n}</span></div>;
  return (
    <div className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Moon size={15} className="text-ink-3" />
          <div>
            <h2 className="text-[13px] font-semibold text-ink">End-of-day review</h2>
            <p className="text-[12px] text-ink-3">{completed.length} done today · {open.length} still open · {meetings.length} MoM{meetings.length === 1 ? "" : "s"} owed</p>
          </div>
        </div>
        <Button variant="primary" size="sm" disabled={!sel.size || pending} onClick={move}><CalendarArrowUp size={14} />{sel.size ? `Move ${sel.size} to tomorrow` : "Select tasks to move"}</Button>
      </div>
      <div className="grid divide-y divide-line md:grid-cols-[1.4fr_1fr_1fr] md:divide-x md:divide-y-0">
        <div className={col}>
          {head(<ArrowRight size={12} />, "Still open", open.length)}
          {open.length ? (
            <ul className="-mx-1.5 space-y-0.5">
              {open.map((t) => (
                <li key={t.id}>
                  <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[13px] hover:bg-subtle", sel.has(t.id) && "bg-subtle")}>
                    <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} className="size-3.5 accent-ink" />
                    <span className="w-12 shrink-0 font-mono text-[11px] text-ink-4">CO-{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                    {t.overdue && <span className="text-[11.5px] font-medium text-bad">Overdue</span>}
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-ink-4">Nothing left open for today. Nice.</p>}
          {open.length > 1 && <button type="button" onClick={() => setSel(sel.size === open.length ? new Set() : new Set(open.map((o) => o.id)))} className="mt-1.5 text-[12px] text-ink-3 hover:text-ink">{sel.size === open.length ? "Clear selection" : "Select all"}</button>}
        </div>
        <div className={col}>
          {head(<NotebookPen size={12} />, "Meetings without MoM", meetings.length)}
          {meetings.length ? meetings.map((m) => (
            <Link key={m.id} href={`/meetings/${m.id}`} className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] hover:bg-subtle">
              <span className="min-w-0 flex-1 truncate text-ink">{m.title}</span><span className="text-[12px] text-ink-3">{m.time}</span><span className="text-[12px] font-medium text-warn">Add MoM</span>
            </Link>
          )) : <p className="text-[13px] text-ink-4">All minutes are in.</p>}
          <div className="mt-4">{head(<Check size={12} />, "Completed today", completed.length)}</div>
          {completed.slice(0, 6).map((t) => <Link key={t.id} href={`/tasks/${t.id}`} className="block truncate py-0.5 text-[12.5px] text-ink-3 line-through decoration-ink-4 hover:text-ink">{t.title}</Link>)}
          {!completed.length && <p className="text-[13px] text-ink-4">Nothing marked done yet.</p>}
        </div>
        <div className={col}>
          {head(<Send size={12} />, "Follow-ups pending", followups.length)}
          {followups.length ? followups.slice(0, 8).map((f) => (
            <Link key={f.id} href={f.href} className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] hover:bg-subtle">
              <Avatar name={f.person} color={f.color} size={18} /><span className="min-w-0 flex-1 truncate text-ink-2">{f.label}</span>
            </Link>
          )) : <p className="text-[13px] text-ink-4">No one owes you an update.</p>}
        </div>
      </div>
    </div>
  );
}
