"use client";
import { useState, useTransition } from "react";
import { BellRing, Mail, MessageSquare, MessageCircle, Smartphone, Check } from "lucide-react";
import { Modal, useToast } from "@/components/ui/client";
import { Avatar, Button, Dot } from "@/components/ui";
import { cn } from "@/lib/cn";
import { TASK_STATUS, type TaskStatus, type Tone } from "@/lib/meta";
import { postTaskUpdate } from "@/server/tasks/actions";
import { addTaskComment, requestTaskUpdateVia } from "@/server/tasks/collab-actions";

/** Post an update (optionally moving status) or a comment. */
export function TaskComposer({ id, status, me, isOwner, readOnly }: { id: string; status: TaskStatus; me: { name: string; color: string | null }; isOwner: boolean; readOnly?: boolean }) {
  const [mode, setMode] = useState<"update" | "comment">(isOwner ? "update" : "comment");
  const [body, setBody] = useState("");
  const [next, setNext] = useState<TaskStatus | "">("");
  const [pending, start] = useTransition();
  const toast = useToast();
  if (readOnly) return null;
  const submit = () => {
    if (!body.trim()) return;
    start(async () => {
      const r = mode === "update" ? await postTaskUpdate(id, body, next || undefined) : await addTaskComment(id, body);
      if (!r.ok) return toast(r.error, "error");
      toast(mode === "update" ? "Update posted" : "Comment added", "success");
      setBody(""); setNext("");
    });
  };
  const statuses = (Object.keys(TASK_STATUS) as TaskStatus[]).filter((s) => s !== status && s !== "cancelled");
  return (
    <div className="flex gap-3">
      <Avatar name={me.name} color={me.color} size={28} className="mt-1" />
      <div className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface transition-[border-color,box-shadow] focus-within:border-ink-3 focus-within:ring-4 focus-within:ring-ink/5">
        <div className="flex items-center gap-1 border-b border-line px-2 pt-1.5">
          {(["update", "comment"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn("relative -mb-px h-8 px-2 text-[12.5px] transition-colors", mode === m ? "font-medium text-ink after:absolute after:inset-x-1.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-ink" : "text-ink-3 hover:text-ink")}>
              {m === "update" ? "Post update" : "Comment"}
            </button>
          ))}
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder={mode === "update" ? "What moved since the last update? What's next, and is anything blocking?" : "Add a comment…"}
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4" />
        <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
          {mode === "update" && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[11.5px] text-ink-4">Move to</span>
              {statuses.map((s) => (
                <button key={s} type="button" onClick={() => setNext(next === s ? "" : s)}
                  className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11.5px] transition-colors",
                    next === s ? "border-ink bg-ink text-canvas" : "border-line text-ink-2 hover:border-line-strong hover:text-ink")}>
                  {next === s ? <Check size={10} /> : <Dot tone={TASK_STATUS[s].tone as Tone} className="size-1.5" />}
                  {TASK_STATUS[s].label}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] text-ink-4 sm:inline">⌘ Enter</span>
            <Button size="xs" variant="primary" disabled={!body.trim() || pending} onClick={submit}>
              {pending ? "Posting…" : mode === "update" ? (next ? `Post & mark ${TASK_STATUS[next].label.toLowerCase()}` : "Post update") : "Comment"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHANNELS = [
  { key: "in_app", label: "In-app", icon: <BellRing size={14} />, live: true },
  { key: "email", label: "Email", icon: <Mail size={14} />, live: false },
  { key: "slack", label: "Slack", icon: <MessageSquare size={14} />, live: false },
  { key: "whatsapp", label: "WhatsApp", icon: <Smartphone size={14} />, live: false },
] as const;

/** "Request update" with an optional message. In-app is live; other channels are shown as coming soon. */
export function RequestUpdateButton({ id, ownerLabel, title, variant = "secondary", size = "sm", disabled }: {
  id: string; ownerLabel: string | null; title: string; variant?: "secondary" | "primary" | "ghost"; size?: "xs" | "sm"; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const send = () => start(async () => {
    const r = await requestTaskUpdateVia(id, msg.trim() || null, "in_app");
    if (!r.ok) return toast(r.error, "error");
    toast(`Update requested from ${ownerLabel ?? "the owner"}`, "success");
    setMsg(""); setOpen(false);
  });
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled || !ownerLabel} onClick={() => setOpen(true)} title={!ownerLabel ? "Assign an owner first" : undefined}>
        <MessageCircle size={14} /> Request update
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} width={480} title={`Ask ${ownerLabel ?? "the owner"} for an update`} description={`“${title}”`}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={send}>{pending ? "Sending…" : "Send request"}</Button></>}>
        <textarea autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="field resize-none"
          placeholder={`Could you share a quick update on “${title.length > 50 ? `${title.slice(0, 48)}…` : title}”?`} />
        <div className="mt-3">
          <div className="label">Send via</div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {CHANNELS.map((c) => (
              <div key={c.key} title={c.live ? undefined : "Coming soon"}
                className={cn("flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-[12.5px]",
                  c.live ? "border-ink bg-subtle text-ink" : "cursor-not-allowed border-line text-ink-4")}>
                <span className="flex items-center gap-1.5">{c.icon}{c.label}</span>
                <span className="text-[10.5px]">{c.live ? "Active" : "Coming soon"}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">The request is logged in the task journey and stays open until {ownerLabel ?? "they"} post{ownerLabel ? "s" : ""} an update.</p>
      </Modal>
    </>
  );
}
