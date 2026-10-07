"use client";
import { useState, useTransition } from "react";
import { AlarmClockOff, BellRing, Check, Send, Undo2, X } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requestTaskUpdate } from "@/server/tasks/actions";
import { bulkRequestUpdates, closeFollowup, snoozeFollowup, unsnoozeFollowup } from "@/server/tasks/collab-actions";

/** One-click "Request update" + "Snooze 2d" for a follow-up queue row. */
export function FollowupRowActions({ taskId, who }: { taskId: string; who: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | "sent" | "snoozed">(null);
  const toast = useToast();
  if (done)
    return (
      <span className="inline-flex h-7 items-center gap-1.5 px-2 text-[12px] text-ink-3 animate-fade-in">
        <Check size={13} className="text-ok" /> {done === "sent" ? `Asked ${who}` : "Snoozed 2 days"}
      </span>
    );
  return (
    <div className={cn("flex shrink-0 items-center gap-1", pending && "pointer-events-none opacity-60")}>
      <Button size="xs" variant="ghost" title="Hide for 2 days"
        onClick={() => start(async () => { const r = await snoozeFollowup(taskId, 2); if (!r.ok) toast(r.error, "error"); else setDone("snoozed"); })}>
        <AlarmClockOff size={13} /> <span className="hidden sm:inline">Snooze 2d</span>
      </Button>
      <Button size="xs" variant="secondary"
        onClick={() => start(async () => { const r = await requestTaskUpdate(taskId); if (!r.ok) toast(r.error, "error"); else { setDone("sent"); toast(`Update requested from ${who}`, "success"); } })}>
        <BellRing size={13} /> Request update
      </Button>
    </div>
  );
}

export function BulkRequestButton({ count, taskIds }: { count: number; taskIds: string[] }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const toast = useToast();
  if (!count) return null;
  return (
    <Button variant="primary" size="sm" disabled={pending || sent}
      onClick={() => start(async () => {
        const r = await bulkRequestUpdates(taskIds);
        if (!r.ok) return toast(r.error, "error");
        setSent(true);
        toast(r.message ?? "Requests sent", "success");
      })}>
      {sent ? <><Check size={14} /> Requests sent</> : <><Send size={14} /> {pending ? "Sending…" : `Request updates from all (${count})`}</>}
    </Button>
  );
}

export function CloseFollowupButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <button type="button" disabled={pending} title="Close this follow-up without a response"
      onClick={() => start(async () => { const r = await closeFollowup(id); if (!r.ok) toast(r.error, "error"); else toast("Follow-up closed"); })}
      className="rounded-md p-1 text-ink-4 hover:bg-subtle hover:text-ink disabled:opacity-50" aria-label="Close follow-up">
      <X size={13} />
    </button>
  );
}

export function UnsnoozeButton({ taskId }: { taskId: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button size="xs" variant="ghost" disabled={pending}
      onClick={() => start(async () => { const r = await unsnoozeFollowup(taskId); if (!r.ok) toast(r.error, "error"); })}>
      <Undo2 size={12} /> Unsnooze
    </Button>
  );
}
