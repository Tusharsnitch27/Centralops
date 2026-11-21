"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, Check, ClipboardCopy, MessageSquarePlus, MoreHorizontal, Plus, Send } from "lucide-react";
import { Button, Tabs } from "@/components/ui";
import { Combobox, MenuItem, Modal, Popover, useToast } from "@/components/ui/client";
import type { ActionResult } from "@/server/core/result";
import { addSopNote, createSopAction, remindAllPending, remindStream, setSubmissionStatus } from "@/server/sop/actions";
import { addDays, today } from "@/lib/dates";

/** Run a server action with toast feedback + refresh. */
export function useSopAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (r: ActionResult<T>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast(r.message ?? "Saved", "success"); router.refresh(); } else toast(r.error, "error");
      after?.(r);
    });
  return { pending, run };
}

// Leadership views first, then the working tabs. Projections and stream scorecards live inside Inputs; data lineage is not shown.
const MAIN = [
  { key: "summary", href: "/sop", label: "Summary" },
  { key: "monthly", href: "/sop/monthly", label: "Monthly review" },
  { key: "detailed", href: "/sop/detailed", label: "Detailed" },
  { key: "inputs", href: "/sop/inputs", label: "Inputs" },
  { key: "capacity", href: "/sop/capacity", label: "Capacity" },
  { key: "review", href: "/sop/review", label: "Review meeting" },
  { key: "cost", href: "/sop/cost", label: "Processing cost" },
  { key: "productivity", href: "/sop/productivity", label: "Productivity" },
  { key: "sla", href: "/sop/sla", label: "Service levels" },
  { key: "controls", href: "/sop/controls", label: "Controls" },
];
const INPUT_TABS = [
  { key: "inputs", href: "/sop/inputs", label: "Submit & track" },
  { key: "streams", href: "/sop/streams", label: "Stream scorecards" },
  { key: "projections", href: "/sop/projections", label: "Stream detail" },
];

export function SopNav({ counts, overview = true }: { counts?: { inputs?: number; capacity?: number }; overview?: boolean }) {
  const path = usePathname();
  if (!overview) return <div className="mb-6"><Tabs active="inputs" items={[{ key: "inputs", href: "/sop/inputs", label: "My inputs", count: counts?.inputs }]} /></div>;
  const seg = path.split("/")[2] ?? "summary";
  const active = seg === "" ? "summary" : seg;
  const inInputs = INPUT_TABS.some((t) => t.key === active);
  const count = (k: string) => (k === "inputs" ? counts?.inputs : k === "capacity" ? counts?.capacity : undefined);
  return (
    <div className="mb-6 space-y-3">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Tabs className="min-w-max" active={inInputs ? "inputs" : active} items={MAIN.map((m) => ({ ...m, count: count(m.key) || undefined }))} />
      </div>
      {inInputs && (
        <div className="seg">
          {INPUT_TABS.map((t) => <Link key={t.key} href={t.href} data-on={active === t.key} className="seg-item">{t.label}</Link>)}
        </div>
      )}
    </div>
  );
}

export function RemindButton({ streamId, periods, label = "Send reminder", size = "xs", variant = "secondary" }: { streamId: string; periods: string[]; label?: string; size?: "xs" | "sm"; variant?: "secondary" | "ghost" | "subtle" }) {
  const { pending, run } = useSopAction();
  return (
    <Button size={size} variant={variant} disabled={pending} onClick={() => run(() => remindStream(streamId, periods))}>
      <BellRing size={13} />{pending ? "Sending…" : label}
    </Button>
  );
}

export function RemindAllButton({ periods, count, label, variant = "primary", size = "sm" }: { periods: string[]; count: number; label?: string; variant?: "primary" | "secondary"; size?: "xs" | "sm" }) {
  const { pending, run } = useSopAction();
  return (
    <Button size={size} variant={variant} disabled={pending || !count} onClick={() => run(() => remindAllPending(periods))}>
      <Send size={13} />{pending ? "Sending…" : label ?? `Remind all pending (${count})`}
    </Button>
  );
}

export function SubmissionMenu({ streamId, period, state }: { streamId: string; period: string; state: string }) {
  const { run } = useSopAction();
  return (
    <Popover align="end" className="w-52" trigger={({ toggle }) => (
      <button type="button" onClick={toggle} aria-label="More" className="rounded-md p-1 text-ink-4 opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-ink"><MoreHorizontal size={14} /></button>
    )}>
      {(close) => (
        <>
          <MenuItem onClick={() => { close(); location.href = `/sop/inputs?stream=${streamId}&period=${period}#submit`; }}>Enter projections</MenuItem>
          {(state === "pending" || state === "late") && <MenuItem onClick={() => { close(); run(() => remindStream(streamId, [period])); }}>Send reminder</MenuItem>}
          {state !== "na" ? <MenuItem onClick={() => { close(); run(() => setSubmissionStatus(streamId, period, "not_required")); }}>Mark not required</MenuItem>
            : <MenuItem onClick={() => { close(); run(() => setSubmissionStatus(streamId, period, "pending")); }}>Reopen</MenuItem>}
        </>
      )}
    </Popover>
  );
}

export interface PersonOpt { id: string; name: string; hint?: string | null }

export function CreateActionButton({ people, defaults, label = "Create action", size = "xs", variant = "secondary" }: {
  people: PersonOpt[]; defaults: { title: string; description?: string; ownerId?: string | null; streamId?: string | null; dueDate?: string };
  label?: string; size?: "xs" | "sm"; variant?: "secondary" | "ghost" | "primary" | "subtle";
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaults.title);
  const [desc, setDesc] = useState(defaults.description ?? "");
  const [owner, setOwner] = useState<string | null>(defaults.ownerId ?? null);
  const [due, setDue] = useState(defaults.dueDate ?? addDays(today(), 3));
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low">("high");
  const { pending, run } = useSopAction();
  const submit = () => run(() => createSopAction({ title, description: desc, ownerId: owner, dueDate: due, priority, streamId: defaults.streamId }), (r) => r.ok && setOpen(false));
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}><Plus size={13} />{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create S&OP action" description="Becomes a task (source S&OP) that shows up in the review pre-read until it's closed."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim()} onClick={submit}>{pending ? "Creating…" : "Create task"}</Button></>}>
        <div className="space-y-3">
          <label className="block"><span className="label">Action</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
          <label className="block"><span className="label">Context</span><textarea className="field min-h-20" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <div className="grid grid-cols-3 gap-3">
            <div><span className="label">Owner</span><Combobox options={people.map((p) => ({ value: p.id, label: p.name, hint: p.hint ?? undefined }))} value={owner} onChange={setOwner} placeholder="Assign…" /></div>
            <label className="block"><span className="label">Due</span><input type="date" className="field" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="block"><span className="label">Priority</span>
              <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
                <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function NoteButton({ streamId, period, streamName, periodLabel, size = "xs" }: { streamId: string; period: string; streamName: string; periodLabel: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"commentary" | "variance_reason" | "corrective_action">("commentary");
  const { pending, run } = useSopAction();
  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)}><MessageSquarePlus size={13} />Comment</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${streamName} · ${periodLabel}`} description="Commentary is shown on the stream card and in the review pre-read."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending || !body.trim()} onClick={() => run(() => addSopNote({ streamId, period, kind, body }), (r) => { if (r.ok) { setOpen(false); setBody(""); } })}>Add</Button></>}>
        <div className="mb-3 flex gap-1">
          {([["commentary", "Commentary"], ["variance_reason", "Variance reason"], ["corrective_action", "Corrective action"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-md px-2 py-1 text-[12.5px] ${kind === k ? "bg-ink text-canvas" : "text-ink-3 hover:bg-subtle"}`}>{l}</button>
          ))}
        </div>
        <textarea className="field min-h-28" autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Myntra SOR cut to 43K for October after the category reset…" />
      </Modal>
    </>
  );
}

export function CopyTextButton({ text, label = "Copy as text" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button variant="secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); toast("Pre-read copied", "success"); setTimeout(() => setDone(false), 2000); }
      catch { toast("Couldn't access the clipboard", "error"); }
    }}>
      {done ? <Check size={13} /> : <ClipboardCopy size={13} />}{done ? "Copied" : label}
    </Button>
  );
}
