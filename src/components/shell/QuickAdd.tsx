"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Calendar, CircleCheck, Gavel, Hash, Send, User } from "lucide-react";
import { Modal, Combobox, useToast } from "@/components/ui/client";
import { Button, Kbd, Avatar } from "@/components/ui";
import { parseQuick } from "@/lib/quickParse";
import { fmtDate, today } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { quickAdd } from "@/server/shell/actions";

export type QuickKind = "task" | "project" | "meeting" | "decision" | "risk" | "followup";
export const openQuickAdd = (kind: QuickKind = "task", text?: string) => window.dispatchEvent(new CustomEvent("co:quickadd", { detail: { kind, text } }));

const KINDS: { kind: QuickKind; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { kind: "task", label: "Task", icon: <CircleCheck size={14} />, placeholder: "Share revised packaging budget @iqbal fri !high #aop" },
  { kind: "followup", label: "Follow-up", icon: <Send size={14} />, placeholder: "Sep actuals for SaaS lines @faisal tomorrow" },
  { kind: "meeting", label: "Meeting", icon: <Calendar size={14} />, placeholder: "Logistics vendor review" },
  { kind: "decision", label: "Decision", icon: <Gavel size={14} />, placeholder: "Continue Mudita Cargo for B2B till Dec" },
];

interface Options { people: { id: string; name: string; title: string | null; color: string | null }[]; projects: { id: string; name: string; code: string | null }[] }

export function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuickKind>("task");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [due, setDue] = useState<string>("");
  const [opts, setOpts] = useState<Options | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setKind(d.kind ?? "task"); setText(d.text ?? ""); setNotes(""); setOwnerId(null); setProjectId(null); setDue(""); setOpen(true);
      if (!opts) fetch("/api/options").then((r) => r.json()).then(setOpts).catch(() => {});
    };
    window.addEventListener("co:quickadd", on);
    return () => window.removeEventListener("co:quickadd", on);
  }, [opts]);

  const parsed = useMemo(() => parseQuick(text), [text]);
  const owner = ownerId ? opts?.people.find((p) => p.id === ownerId) : parsed.owner ? opts?.people.find((p) => p.name.toLowerCase().split(" ")[0] === parsed.owner!.toLowerCase()) : undefined;
  const dueDate = due || parsed.due || "";

  const submit = () => {
    if (!parsed.title) return;
    start(async () => {
      const r = await quickAdd({ kind, title: parsed.title, ownerId: owner?.id ?? null, ownerName: owner ? null : parsed.owner, dueDate: dueDate || null, priority: parsed.priority, projectId, tags: parsed.tags, notes: notes || null });
      if (!r.ok) { toast(r.error, "error"); return; }
      setOpen(false);
      toast(`${KINDS.find((k) => k.kind === kind)!.label} created`, "success");
      router.refresh();
      if (kind !== "task" && kind !== "followup" && r.data) router.push(r.data.href);
    });
  };

  const k = KINDS.find((x) => x.kind === kind)!;
  return (
    <Modal open={open} onClose={() => setOpen(false)} width={600}
      footer={
        <>
          <span className="mr-auto hidden text-[11.5px] text-ink-4 sm:block">@owner · #tag · !high · fri / 15 oct / in 3 days</span>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!parsed.title || pending}>{pending ? "Creating…" : `Create ${k.label.toLowerCase()}`} <Kbd className="border-canvas/20 bg-canvas/10 text-canvas/70">↵</Kbd></Button>
        </>
      }>
      <div className="-mx-1 mb-3 mt-3 flex flex-wrap gap-1">
        {KINDS.map((x) => (
          <button key={x.kind} onClick={() => setKind(x.kind)}
            className={cn("flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors", kind === x.kind ? "bg-ink text-canvas" : "text-ink-2 hover:bg-subtle")}>
            {x.icon}{x.label}
          </button>
        ))}
      </div>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={k.placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        className="w-full bg-transparent py-1 text-[17px] font-medium outline-none placeholder:font-normal placeholder:text-ink-4" />
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
        {owner && <Chip icon={<Avatar name={owner.name} color={owner.color} size={16} />}>{owner.name}</Chip>}
        {!owner && parsed.owner && <Chip icon={<User size={12} />}>@{parsed.owner} (team or unknown)</Chip>}
        {dueDate && <Chip icon={<Calendar size={12} />}>{fmtDate(dueDate, { dow: true })}</Chip>}
        {parsed.priority && <Chip>{parsed.priority}</Chip>}
        {parsed.tags.map((t) => <Chip key={t} icon={<Hash size={11} />}>{t}</Chip>)}
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} className="field mt-3 resize-none" />
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Combobox size="sm" placeholder={kind === "followup" ? "Waiting on…" : "Owner"} value={owner?.id ?? null} onChange={setOwnerId}
          options={(opts?.people ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined, icon: <Avatar name={p.name} color={p.color} size={16} /> }))} />
        <Combobox size="sm" placeholder="Project" value={projectId} onChange={setProjectId}
          options={(opts?.projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} />
        {kind !== "decision" && (
          <input type="date" min={today()} value={dueDate} onChange={(e) => setDue(e.target.value)} className="field h-8 py-1 text-[12.5px]" title="Due date" />
        )}
      </div>
    </Modal>
  );
}

function Chip({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return <span className="inline-flex h-6 items-center gap-1 rounded-md bg-subtle px-1.5 text-[12px] text-ink-2 ring-1 ring-inset ring-line">{icon}{children}</span>;
}
