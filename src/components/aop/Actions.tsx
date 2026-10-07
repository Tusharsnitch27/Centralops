"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BellRing, ListPlus, MessageCircleQuestion, Send } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Combobox, Modal, useToast } from "@/components/ui/client";
import { createCorrectiveTask, remindAll, requestItemUpdate, sendReminder } from "@/server/aop/actions";
import { addDays, today } from "@/lib/dates";

type Size = "xs" | "sm" | "md";
type Variant = "primary" | "secondary" | "ghost" | "subtle";

let peopleCache: { value: string; label: string; hint?: string }[] | null = null;
export function usePeople() {
  const [people, setPeople] = useState(peopleCache ?? []);
  useEffect(() => {
    if (peopleCache) return;
    fetch("/api/options").then((r) => r.json()).then((d: { people?: { id: string; name: string; title: string | null }[] }) => {
      peopleCache = (d.people ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined }));
      setPeople(peopleCache);
    }).catch(() => {});
  }, []);
  return people;
}

export function CreateTaskModal({ open, onClose, itemId, sectionId, defaultTitle, ownerId, context, onCreated }: {
  open: boolean; onClose: () => void; itemId?: string | null; sectionId?: string | null; defaultTitle: string; ownerId?: string | null; context?: ReactNode; onCreated?: () => void;
}) {
  const people = usePeople();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(defaultTitle);
  const [owner, setOwner] = useState<string | null>(ownerId ?? null);
  const [due, setDue] = useState(addDays(today(), 7));
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low">("high");
  useEffect(() => { if (open) { setTitle(defaultTitle); setOwner(ownerId ?? null); } }, [open, defaultTitle, ownerId]);
  const submit = () => start(async () => {
    const r = await createCorrectiveTask({ itemId: itemId ?? null, sectionId: sectionId ?? null, title, ownerId: owner, dueDate: due || null, priority });
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Task created", "success");
    onClose();
    onCreated?.();
    router.refresh();
  });
  return (
    <Modal open={open} onClose={onClose} title="Create corrective task" description={context} width={500}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !title.trim()} onClick={submit}>{pending ? "Creating…" : "Create task"}</Button></>}>
      <div className="space-y-3 pt-1">
        <Field label="Task"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner"><Combobox options={people} value={owner} onChange={setOwner} placeholder="Line owner" /></Field>
          <Field label="Due"><input type="date" className="field" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Priority">
          <div className="flex gap-1.5">
            {(["urgent", "high", "medium", "low"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`h-8 rounded-lg px-3 text-[12.5px] capitalize ring-1 ring-inset transition-colors ${priority === p ? "bg-ink text-canvas ring-ink" : "text-ink-2 ring-line-strong hover:bg-subtle"}`}>{p}</button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export function CreateTaskButton({ label = "Create task", size = "xs", variant = "ghost", ...p }: { itemId?: string | null; sectionId?: string | null; defaultTitle: string; ownerId?: string | null; context?: ReactNode; label?: ReactNode; size?: Size; variant?: Variant }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><ListPlus size={13} />{label}</Button>
      <CreateTaskModal open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}

export function ReminderButton({ cycleId, sectionId, period, kind, personId, label = "Send reminder", size = "xs", variant = "ghost", sent }: {
  cycleId: string; sectionId: string; period: string; kind: "actuals" | "projections"; personId?: string | null; label?: ReactNode; size?: Size; variant?: Variant; sent?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button size={size} variant={variant} disabled={pending} onClick={(e) => {
      e.stopPropagation();
      start(async () => {
        const r = await sendReminder({ cycleId, sectionId, period, kind, personId });
        if (!r.ok) return toast(r.error, "error");
        setDone(true); toast(r.message ?? "Reminder sent", "success"); router.refresh();
      });
    }}>
      <BellRing size={13} />{pending ? "Sending…" : done ? "Reminded" : sent ? "Remind again" : label}
    </Button>
  );
}

export function RemindAllButton({ cycleId, period, kind, sectionIds, size = "sm", variant = "primary" }: { cycleId: string; period: string; kind: "actuals" | "projections"; sectionIds: string[]; size?: Size; variant?: Variant }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size={size} variant={variant} disabled={pending || !sectionIds.length} onClick={() => start(async () => {
      const r = await remindAll({ cycleId, period, kind, sectionIds });
      if (!r.ok) return toast(r.error, "error");
      toast(r.message ?? "Reminders sent", "success"); router.refresh();
    })}>
      <Send size={13} />{pending ? "Sending…" : `Remind all${sectionIds.length ? ` (${sectionIds.length})` : ""}`}
    </Button>
  );
}

export function RequestUpdateButton({ itemId, label = "Request update", size = "xs", variant = "ghost" }: { itemId: string; label?: ReactNode; size?: Size; variant?: Variant }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button size={size} variant={variant} disabled={pending || done} onClick={(e) => {
      e.stopPropagation();
      start(async () => {
        const r = await requestItemUpdate({ itemId });
        if (!r.ok) return toast(r.error, "error");
        setDone(true); toast(r.message ?? "Requested", "success");
      });
    }}>
      <MessageCircleQuestion size={13} />{done ? "Requested" : pending ? "Sending…" : label}
    </Button>
  );
}
