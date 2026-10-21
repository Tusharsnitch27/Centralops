"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, OctagonAlert, Plus, X } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { addAssignees, clearBlocker, raiseBlocker, removeAssignee } from "@/server/tasks/people-actions";
import { patchTask } from "@/server/tasks/actions";
import type { TaskAssignee, TaskBlocker } from "@/server/tasks/people";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";

interface P { id: string; name: string; color?: string | null }

/** Who's on the task besides the owner, blockers raised on a person, and the goal it rolls up to. */
export function TaskPeoplePanel({ taskId, ownerId, assignees, blockers, people, goals, goalId, readOnly }: {
  taskId: string; ownerId: string | null; assignees: TaskAssignee[]; blockers: TaskBlocker[]; people: P[]; goals: { id: string; title: string }[]; goalId: string | null; readOnly: boolean;
}) {
  const [raising, setRaising] = useState(false);
  const [body, setBody] = useState("");
  const [on, setOn] = useState("");
  const [onLabel, setOnLabel] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); if (!r.ok) return toast(r.error ?? "Failed", "error"); if (r.message) toast(r.message, "success"); after?.(); router.refresh();
  });
  const open = blockers.filter((b) => b.status === "open");
  const onTask = new Set([ownerId, ...assignees.map((a) => a.user_id)]);
  return (
    <div className="space-y-4">
      {/* people */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Also working on it</div>
        <div className="space-y-1">
          {assignees.map((a) => (
            <div key={a.user_id} className="group flex items-center gap-2 rounded-md px-1 py-1">
              <Avatar name={a.name} color={a.avatar_color} size={20} /><span className="min-w-0 flex-1 truncate text-[12.5px]">{a.name}</span>
              {!readOnly && <button type="button" disabled={pending} onClick={() => run(() => removeAssignee(taskId, a.user_id))} className="rounded p-0.5 text-ink-4 opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Remove"><X size={12} /></button>}
            </div>
          ))}
          {!assignees.length && <div className="px-1 text-[12.5px] text-ink-4">Just the owner</div>}
          {!readOnly && (
            <select className="field mt-1 h-8 py-0 text-[12.5px]" value="" disabled={pending} onChange={(e) => e.target.value && run(() => addAssignees(taskId, [e.target.value]))}>
              <option value="">+ Add person</option>
              {people.filter((p) => !onTask.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* blockers */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={cn("text-[11px] font-semibold uppercase tracking-[0.08em]", open.length ? "text-bad" : "text-ink-4")}>Blockers{open.length ? ` · ${open.length} open` : ""}</span>
          {!readOnly && open.length > 1 && <button type="button" disabled={pending} onClick={() => run(() => clearBlocker(taskId, null))} className="text-[11.5px] text-ink-3 hover:text-ink">Clear all</button>}
        </div>
        <div className="space-y-1.5">
          {blockers.map((b) => (
            <div key={b.id} className={cn("rounded-lg border px-2.5 py-2", b.status === "open" ? "border-bad/25 bg-bad-soft/40" : "border-line bg-subtle/40")}>
              <div className="flex items-start gap-2">
                {b.status === "open" ? <OctagonAlert size={13} className="mt-0.5 shrink-0 text-bad" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" />}
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[12.5px]", b.status === "cleared" && "text-ink-4 line-through")}>{b.body}</div>
                  <div className="text-[11px] text-ink-4">{b.on_name ? <>On <b className="font-semibold text-ink-2">{b.on_name}</b> · </> : null}{b.status === "open" ? `raised ${ago(b.created_at)}${b.raised_by_name ? ` by ${b.raised_by_name}` : ""}` : `cleared ${ago(b.cleared_at)}${b.cleared_by_name ? ` by ${b.cleared_by_name}` : ""}`}</div>
                </div>
                {!readOnly && b.status === "open" && <button type="button" disabled={pending} onClick={() => run(() => clearBlocker(taskId, b.id))} className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-ok hover:bg-ok-soft">Clear</button>}
              </div>
            </div>
          ))}
          {!blockers.length && !raising && <div className="px-1 text-[12.5px] text-ink-4">Nothing blocking</div>}
          {!readOnly && (raising ? (
            <div className="space-y-2 rounded-lg border border-line bg-surface p-2.5">
              <textarea className="field min-h-[56px] text-[12.5px]" autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's blocking?" />
              <select className="field h-8 py-0 text-[12.5px]" value={on} onChange={(e) => setOn(e.target.value)}>
                <option value="">Who needs to clear it?</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="__other">Someone outside the team…</option>
              </select>
              {on === "__other" && <input className="field h-8 py-0 text-[12.5px]" value={onLabel} onChange={(e) => setOnLabel(e.target.value)} placeholder="Name / vendor" />}
              <div className="flex justify-end gap-2">
                <Button size="xs" variant="ghost" onClick={() => setRaising(false)}>Cancel</Button>
                <Button size="xs" variant="primary" disabled={pending || !body.trim()} onClick={() => run(() => raiseBlocker(taskId, body, on && on !== "__other" ? on : null, on === "__other" ? onLabel : null), () => { setRaising(false); setBody(""); setOn(""); setOnLabel(""); })}>Raise blocker</Button>
              </div>
            </div>
          ) : <button type="button" onClick={() => setRaising(true)} className="flex items-center gap-1 px-1 text-[12px] text-ink-3 hover:text-ink"><Plus size={12} />Raise a blocker on someone</button>)}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-4">Completing the task, or moving it out of Blocked, clears every open blocker.</p>
      </div>

      {/* goal */}
      {goals.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Goal</span>
          <select className="field h-8 py-0 text-[12.5px]" disabled={readOnly || pending} value={goalId ?? ""} onChange={(e) => run(() => patchTask(taskId, { goalId: e.target.value || null }))}>
            <option value="">No goal</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
