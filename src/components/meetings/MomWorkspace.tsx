"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Ban, ClipboardPaste, FileText, LayoutList, NotebookPen, PenLine, SkipForward, Sparkles, Zap } from "lucide-react";
import { Button, Kbd } from "@/components/ui";
import { Popover, useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { today } from "@/lib/dates";
import { closeMomPrompt, saveMomDraft, submitMom } from "@/server/meetings/actions";
import { MOM_SECTIONS, composeMom, emptySections, parseMom, type MomSections } from "./momFormat";

type Mode = "prompt" | "sections" | "free" | "quick";

export interface MomWorkspaceProps {
  meetingId: string;
  title: string;
  status: "pending" | "draft" | "submitted" | "distributed" | "skipped" | "not_relevant";
  isPM: boolean;
  isOwner: boolean;
  ownerName: string | null;
  note: { kind: "mom" | "quick"; body: string; updated_at: string } | null;
  agenda: string | null;
  followUpDate: string | null;
  startEditing?: boolean;
}

function AutoGrow({ value, onChange, placeholder, minRows = 2, className, autoFocus, onKeyDown }: { value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; className?: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; }, [value]);
  return (
    <textarea ref={ref} rows={minRows} value={value} autoFocus={autoFocus} onKeyDown={onKeyDown} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={cn("block w-full resize-none bg-transparent text-[13.5px] leading-[1.6] text-ink outline-none placeholder:text-ink-4", className)} />
  );
}

/** The MoM owner's side: the "Add MoM" prompt, the editor (sections or free text), quick notes, skip / not relevant. */
export function MomWorkspace(p: MomWorkspaceProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const initial = p.note ? parseMom(p.note.body) : { sections: { ...emptySections(), agenda: p.agenda ?? "" }, structured: true };
  const [mode, setMode] = useState<Mode>(p.note || p.startEditing ? (p.note?.kind === "quick" ? "quick" : initial.structured ? "sections" : "free") : "prompt");
  const [sections, setSections] = useState<MomSections>(initial.sections);
  const [free, setFree] = useState(p.note && !initial.structured ? p.note.body : "");
  const [quick, setQuick] = useState(p.note?.kind === "quick" ? p.note.body : "");
  const [followUp, setFollowUp] = useState(p.followUpDate ?? "");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(p.note ? new Date(p.note.updated_at).getTime() : null);

  const body = mode === "sections" ? composeMom(sections) : mode === "free" ? free : quick;
  const payload = useCallback(() => ({ kind: (mode === "quick" ? "quick" : "mom") as "mom" | "quick", body, discussion: mode === "sections" ? sections.discussion || null : null, blockers: mode === "sections" ? sections.blockers || null : null, followUpDate: followUp || null }), [mode, body, sections, followUp]);

  const save = useCallback((quiet = false) => start(async () => {
    const r = await saveMomDraft(p.meetingId, payload());
    if (!r.ok) { toast(r.error, "error"); return; }
    setDirty(false); setSavedAt(Date.now());
    if (!quiet) { toast("Draft saved"); router.refresh(); }
  }), [p.meetingId, payload, router, toast]);

  const submit = () => start(async () => {
    if (!body.trim()) { toast("Write something first — even three lines is enough", "error"); return; }
    const r = await submitMom(p.meetingId, payload());
    if (!r.ok) { toast(r.error, "error"); return; }
    setDirty(false);
    toast(r.message ?? "Submitted", "success");
    router.refresh();
  });

  const close = (outcome: "skipped" | "not_relevant", reason?: string) => start(async () => {
    const r = await closeMomPrompt(p.meetingId, outcome, reason);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(r.message ?? "Done", "success");
    router.refresh();
  });

  // ⌘S saves, ⌘↵ submits
  const keys = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  };
  // autosave drafts after a pause
  useEffect(() => {
    if (!dirty || mode === "prompt") return;
    const t = setTimeout(() => save(true), 4000);
    return () => clearTimeout(t);
  }, [dirty, mode, body, followUp, save]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (mode === "prompt") {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-start gap-4 px-5 py-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-warn/20 bg-warn-soft text-warn"><NotebookPen size={18} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink">{p.isOwner ? "Add the MoM" : `Add the MoM for ${p.ownerName ?? "the owner"}`}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              {p.isOwner ? "You're the MoM owner for this meeting." : `${p.ownerName ?? "The MoM owner"} hasn't added minutes yet — as PM you can write them.`} Once submitted, actions are extracted for review and distribution.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="md" onClick={() => setMode("sections")}><PenLine size={14} />Write MoM</Button>
              <Button size="md" onClick={() => setMode("quick")}><Zap size={14} />Add quick notes</Button>
              <span className="mx-1 h-5 w-px bg-line" />
              <ClosePopover label="Skip" icon={<SkipForward size={14} />} title="Skip this MoM?" body="Recorded once — you won't be asked again for this meeting." onConfirm={(r) => close("skipped", r)} disabled={pending} />
              <ClosePopover label="Not relevant" icon={<Ban size={14} />} title="Not relevant for minutes?" body="e.g. a 1:1, an FYI session or a cancelled-in-the-room meeting." onConfirm={(r) => close("not_relevant", r)} disabled={pending} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const set = (k: keyof MomSections, v: string) => { setSections((s) => ({ ...s, [k]: v })); setDirty(true); };
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "free" && mode === "sections") setFree(composeMom(sections));
    if (m === "sections" && mode === "free") setSections(parseMom(free).sections);
    if (m === "sections" && mode === "quick" && quick.trim()) setSections((s) => ({ ...s, notes: s.notes || quick }));
    setMode(m);
  };
  const filled = MOM_SECTIONS.filter((s) => sections[s.key].trim()).length;

  return (
    <div className="card overflow-hidden" onKeyDown={keys}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-subtle p-0.5">
          {([["sections", "Sections", <LayoutList key="a" size={13} />], ["free", "Paste / free text", <ClipboardPaste key="b" size={13} />], ["quick", "Quick notes", <Zap key="c" size={13} />]] as const).map(([k, l, i]) => (
            <button key={k} type="button" onClick={() => switchMode(k)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors", mode === k ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-ink-3 hover:text-ink")}>{i}{l}</button>
          ))}
        </div>
        <span className="text-[12px] text-ink-4">
          {pending ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase()}` : mode === "sections" ? `${filled} of ${MOM_SECTIONS.length} sections` : ""}
        </span>
      </div>

      {mode === "sections" && (
        <div className="divide-y divide-line/70">
          {MOM_SECTIONS.map((s, i) => (
            <div key={s.key} className="group grid gap-1 px-5 py-3.5 transition-colors focus-within:bg-subtle/40 md:grid-cols-[150px_1fr] md:gap-5">
              <div className="pt-0.5">
                <div className="text-[12.5px] font-medium text-ink-2">{s.label}</div>
                <div className="text-[11.5px] text-ink-4">{s.hint}</div>
              </div>
              <AutoGrow value={sections[s.key]} onChange={(v) => set(s.key, v)} placeholder={s.placeholder} minRows={s.key === "notes" ? 4 : 2} autoFocus={i === 1 && !p.note} />
            </div>
          ))}
        </div>
      )}
      {mode === "free" && (
        <div className="px-5 py-4">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-3"><FileText size={12} />Paste the whole MoM — from a doc, an email or WhatsApp. Lines like “Nitin to … by Friday”, “Decision: …”, “Risk: …” are picked up automatically.</p>
          <AutoGrow value={free} onChange={(v) => { setFree(v); setDirty(true); }} minRows={14} autoFocus placeholder={"Attendees: …\n\nTunnel reads at 92% vs 98% target; go-live slips a week.\nDecision: go ahead with wave 1 in November.\nRisk: tag supply lead time is 4 weeks.\n\nNext steps:\n- Nitin to re-test tunnel reads by next Wednesday\n- Faisal to integrate handheld counts by 25th"} className="font-[450]" />
        </div>
      )}
      {mode === "quick" && (
        <div className="px-5 py-4">
          <p className="mb-2 text-[12px] text-ink-3">Three lines is fine — who does what, by when, and anything decided.</p>
          <AutoGrow value={quick} onChange={(v) => { setQuick(v); setDirty(true); }} minRows={5} autoFocus placeholder={"Manish to raise PO for 3 handhelds by Friday\nAgreed to start wave 1 in November\nNeed confirmation from finance on Nov budget"} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-subtle/50 px-4 py-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
          Follow-up date
          <input type="date" min={today()} value={followUp} onChange={(e) => { setFollowUp(e.target.value); setDirty(true); }} className="field h-8 w-[150px] py-1 text-[12.5px]" />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {p.status === "pending" && !p.note && <Button variant="ghost" size="sm" onClick={() => setMode("prompt")}>Cancel</Button>}
          <Button size="sm" onClick={() => save()} disabled={pending}>Save draft <Kbd className="ml-1">⌘S</Kbd></Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={pending || !body.trim()}>
            <Sparkles size={13} />{pending ? "Working…" : p.status === "submitted" ? "Resubmit" : p.isPM ? "Submit & review" : "Submit for review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClosePopover({ label, icon, title, body, onConfirm, disabled }: { label: string; icon: React.ReactNode; title: string; body: string; onConfirm: (reason?: string) => void; disabled?: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Popover className="w-[300px] p-3" trigger={({ toggle }) => <Button variant="ghost" size="md" onClick={toggle} disabled={disabled}>{icon}{label}</Button>}>
      {(close) => (
        <div>
          <div className="text-[13px] font-medium text-ink">{title}</div>
          <p className="mt-0.5 text-[12px] text-ink-3">{body}</p>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="field mt-2.5 h-8 py-1 text-[12.5px]"
            onKeyDown={(e) => { if (e.key === "Enter") { onConfirm(reason || undefined); close(); } }} />
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={close}>Cancel</Button>
            <Button variant="primary" size="xs" onClick={() => { onConfirm(reason || undefined); close(); }}>{label}</Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
