"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ClipboardCopy, Download, MailCheck, MessageSquareReply, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { emailHtmlFor, generateExecSummary, markSent, pmFeedback, saveExecSummary, sendToLeadership, setReportStatus } from "@/server/weekly/actions";
import type { ActionResult } from "@/server/core/result";
import type { ReportStatus } from "@/server/weekly/model";
import { cn } from "@/lib/cn";

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, after?: (r: ActionResult<T>) => void) => start(async () => {
    const r = await fn();
    if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Done", "success"); router.refresh(); }
    after?.(r);
  });
  return { pending, run, toast };
}

const STEPS: { key: ReportStatus; label: string }[] = [
  { key: "collecting", label: "Collect" }, { key: "review", label: "Review" }, { key: "approved", label: "Approve" }, { key: "sent", label: "Sent" },
];

/** Workflow bar: status steps + the actions for the current step. */
export function DocToolbar({ reportId, status, emailReady }: { reportId: string; status: ReportStatus; emailReady: boolean }) {
  const { pending, run, toast } = useRun();
  const [manual, setManual] = useState(false);
  const [to, setTo] = useState("");
  const idx = STEPS.findIndex((s) => s.key === status);
  const copy = () => run(() => emailHtmlFor(reportId), async (r) => {
    if (!r.ok || !r.data) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([r.data.html], { type: "text/html" }), "text/plain": new Blob([r.data.subject], { type: "text/plain" }) })]);
      toast("Copied — paste into a new Gmail message", "success");
    } catch { toast("Couldn't access the clipboard", "error"); }
  });
  return (
    <div className="card mb-5 flex flex-wrap items-center gap-3 p-3 print:hidden">
      <ol className="flex items-center gap-1 text-[12px]">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <span className={cn("flex items-center gap-1.5 rounded-md px-2 py-1", i === idx ? "bg-ink font-medium text-white" : i < idx ? "text-ok" : "text-ink-4")}>
              <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", i === idx ? "bg-white/20" : i < idx ? "bg-ok-soft" : "bg-muted")}>{i < idx ? "✓" : i + 1}</span>{s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-4/50">›</span>}
          </li>
        ))}
      </ol>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => window.print()}><Download size={13} />PDF</Button>
        {status !== "sent" && <Button size="sm" variant="ghost" disabled={pending} onClick={copy}><ClipboardCopy size={13} />Copy for email</Button>}
        {status === "collecting" && <Button size="sm" disabled={pending} onClick={() => run(() => setReportStatus(reportId, "review"))}>Start review</Button>}
        {(status === "review" || status === "approved") && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setReportStatus(reportId, "collecting"))}><RotateCcw size={13} />Reopen</Button>}
        {status === "review" && <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setReportStatus(reportId, "approved"))}><CheckCheck size={13} />Approve</Button>}
        {status === "approved" && <>
          <Button size="sm" disabled={pending} onClick={() => setManual(true)}><MailCheck size={13} />Mark as sent</Button>
          <Button size="sm" variant="primary" disabled={pending} title={emailReady ? undefined : "Set up email in Settings › Integrations"} onClick={() => run(() => sendToLeadership(reportId))}><Send size={13} />Send to leadership</Button>
        </>}
      </div>
      <Modal open={manual} onClose={() => setManual(false)} title="Mark as sent" description="Use this when you emailed it yourself (Copy for email → Gmail)."
        footer={<><Button onClick={() => setManual(false)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => run(() => markSent(reportId, to), (r) => r.ok && setManual(false))}>Mark sent</Button></>}>
        <label className="block"><span className="label">Sent to</span><input className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Leadership list / names" /></label>
      </Modal>
    </div>
  );
}

/** Executive summary: write it, or let Claude draft it from every section, then save. */
export function ExecSummaryEditor({ reportId, initial, engine }: { reportId: string; initial: string; engine: string | null }) {
  const [text, setText] = useState(initial);
  const [src, setSrc] = useState(engine);
  const { pending, run } = useRun();
  const [drafting, startDraft] = useTransition();
  const toast = useToast();
  const dirty = text !== initial;
  return (
    <div className="print:hidden">
      <textarea className="field min-h-[260px] text-[13px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One line per function — progress, numbers, what's next.\n\nCallouts for leadership:\n- …"} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={drafting} onClick={() => startDraft(async () => {
          const r = await generateExecSummary(reportId);
          if (!r.ok || !r.data) return toast(r.ok ? "Nothing to summarise" : r.error, "error");
          setText(r.data.text); setSrc(r.data.engine); toast(r.message ?? "Drafted", "success");
        })}><Sparkles size={13} className={drafting ? "animate-pulse" : undefined} />{drafting ? "Reading every section…" : text ? "Re-draft with AI" : "Draft with AI"}</Button>
        <span className="text-[11.5px] text-ink-4">{src === "claude" ? "Drafted by Claude — edit before approving" : src === "rules" ? "Drafted from the updates (AI is off)" : ""}</span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={pending || !dirty} onClick={() => run(() => saveExecSummary(reportId, text))}>{dirty ? "Save summary" : "Saved"}</Button>
      </div>
    </div>
  );
}

/** PM input on a section: note for the record, or send back to the owner. */
export function SectionFeedback({ entryId, initial }: { entryId: string; initial: string }) {
  const [open, setOpen] = useState(!!initial);
  const [c, setC] = useState(initial);
  const { pending, run } = useRun();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 flex items-center gap-1 text-[12px] text-ink-4 hover:text-ink print:hidden"><MessageSquareReply size={12} />Add feedback</button>;
  return (
    <div className="mt-3 rounded-lg border border-line bg-subtle/50 p-2.5 print:hidden">
      <textarea className="field min-h-[56px] text-[12.5px]" value={c} onChange={(e) => setC(e.target.value)} placeholder="Your input for the owner — what to fix, add or clarify" />
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => pmFeedback(entryId, c, false))}>Save note</Button>
        <Button size="xs" variant="primary" disabled={pending || !c.trim()} onClick={() => run(() => pmFeedback(entryId, c, true))}>Send back to owner</Button>
      </div>
    </div>
  );
}
