"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { Combobox, Modal, useToast } from "@/components/ui/client";
import { addCallout, updateCallout } from "@/server/sop/capacityActions";
import { createSopAction } from "@/server/sop/actions";
import type { Callout } from "@/server/sop/capacityTools";
import { findPoc } from "@/lib/pocFind";
import { addDays, fmtDate, today } from "@/lib/dates";
import { cn } from "@/lib/cn";

/** S&OP review call-outs (from the MOM sheet): owner, status, and a task to track each one. */
export function Callouts({ items, people, canEdit }: { items: Callout[]; people: { id: string; name: string }[]; canEdit: boolean }) {
  const [task, setTask] = useState<Callout | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else router.refresh(); });
  const open = items.filter((i) => i.status === "open").length;
  const dates = [...new Set(items.map((i) => i.meeting_date ?? ""))];
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <span className="text-[12.5px] text-ink-3"><b className="font-semibold text-ink">{open}</b> open of {items.length}</span>
        {canEdit && <Button size="xs" onClick={() => setAdding(true)}><Plus size={12} />Call-out</Button>}
      </div>
      {dates.map((d) => (
        <div key={d}>
          <div className="bg-subtle/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">{d ? `Review · ${fmtDate(d, { dow: true })}` : "Undated"}</div>
          {items.filter((i) => (i.meeting_date ?? "") === d).map((c) => (
            <div key={c.id} className="flex flex-wrap items-start gap-3 border-b border-line/60 px-5 py-2.5 last:border-0">
              <button type="button" disabled={!canEdit || pending} onClick={() => run(() => updateCallout(c.id, { status: c.status === "open" ? "done" : "open" }))} className="mt-0.5 text-ink-4 hover:text-ok" aria-label="Toggle done">
                {c.status === "done" ? <CheckCircle2 size={16} className="text-ok" /> : <Circle size={16} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn("text-[13px]", c.status === "done" ? "text-ink-4 line-through" : "text-ink")}>{c.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
                  <span>POC: {c.poc || "—"}</span>
                  {c.remarks && <span className="text-ink-4">· {c.remarks}</span>}
                </div>
              </div>
              {c.task_id
                ? <Link href={`/tasks/${c.task_id}`} className="shrink-0"><Badge tone={c.task_status === "completed" ? "green" : "info"}>CO-{c.task_number}{c.task_due ? ` · due ${fmtDate(c.task_due)}` : ""}</Badge></Link>
                : canEdit && c.status === "open" && <Button size="xs" variant="ghost" onClick={() => setTask(c)}>Create task</Button>}
            </div>
          ))}
        </div>
      ))}
      {task && <TaskModal c={task} people={people} onClose={() => setTask(null)} />}
      {adding && <AddModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function TaskModal({ c, people, onClose }: { c: Callout; people: { id: string; name: string }[]; onClose: () => void }) {
  const hit = findPoc(c.poc, people);
  const [title, setTitle] = useState(c.title.split(/\s[–-]\s/)[0]);
  const [owner, setOwner] = useState<string | null>(hit?.personId ?? null);
  const [due, setDue] = useState(addDays(today(), 7));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Modal open onClose={onClose} title="Track this call-out as a task" description={`${c.title}${c.poc ? ` · POC ${c.poc}` : ""}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim() || !due} onClick={() => start(async () => {
        const r = await createSopAction({ title, description: `S&OP review call-out${c.meeting_date ? ` (${c.meeting_date})` : ""}: ${c.title}${c.poc ? `\nPOC: ${c.poc}` : ""}${c.remarks ? `\n${c.remarks}` : ""}`, ownerId: owner, dueDate: due, priority: "high" });
        if (!r.ok || !r.data) return toast(r.ok ? "Failed" : r.error, "error");
        await updateCallout(c.id, { taskId: r.data.id });
        toast(r.message ?? "Task created", "success"); onClose(); router.refresh();
      })}>Create task</Button></>}>
      <div className="space-y-3">
        <label className="block"><span className="label">Task</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="label">Owner {c.poc && !hit?.personId && <span className="text-ink-4">(POC “{c.poc}” isn’t one person)</span>}</span><Combobox options={people.map((p) => ({ value: p.id, label: p.name }))} value={owner} onChange={setOwner} placeholder="Assign…" /></div>
          <label className="block"><span className="label">Due date</span><input type="date" className="field" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ title: "", poc: "", meetingDate: today(), remarks: "" });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Modal open onClose={onClose} title="Add a review call-out"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !f.title.trim()} onClick={() => start(async () => { const r = await addCallout(f); if (!r.ok) return toast(r.error, "error"); onClose(); router.refresh(); })}>Add</Button></>}>
      <div className="space-y-3">
        <label className="block"><span className="label">Call-out</span><input className="field" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Outbound throughput slow — South WH at 96%" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label">POC</span><input className="field" value={f.poc} onChange={(e) => setF({ ...f, poc: e.target.value })} placeholder="Person or team" /></label>
          <label className="block"><span className="label">Review date</span><input type="date" className="field" value={f.meetingDate} onChange={(e) => setF({ ...f, meetingDate: e.target.value })} /></label>
        </div>
        <label className="block"><span className="label">Remarks</span><input className="field" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
      </div>
    </Modal>
  );
}
