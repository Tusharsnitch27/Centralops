"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, HelpCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { resetWeek, runFollowThrough } from "@/server/weekly/actions";
import type { FollowItem, FollowSection, FollowThrough } from "@/server/weekly/followthrough";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

const KIND: Record<FollowItem["kind"], string> = { next_step: "Next step", metric: "Metric", blocker: "Blocker" };
const STATUS: Record<FollowItem["status"], { label: string; cls: string }> = {
  skipped: { label: "Skipped", cls: "bg-bad-soft text-bad" },
  no_progress: { label: "Not moved", cls: "bg-warn-soft text-warn" },
  worse: { label: "Worse", cls: "bg-bad-soft text-bad" },
  repeated: { label: "Still open", cls: "bg-warn-soft text-warn" },
};

function Items({ items }: { items: FollowItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-subtle px-1.5 py-0.5 font-medium text-ink-2">{KIND[it.kind]}</span>
            <span className={cn("rounded px-1.5 py-0.5 font-semibold", STATUS[it.status].cls)}>{STATUS[it.status].label}</span>
          </div>
          <div className="mt-1 text-[12.5px] text-ink-2"><span className="text-ink-4">Last week:</span> {it.last_week}</div>
          <div className="text-[12.5px] text-ink-3"><span className="text-ink-4">This week:</span> {it.this_week}</div>
          <div className="mt-1 flex gap-1.5 text-[12.5px] font-medium text-ink"><HelpCircle size={13} className="mt-0.5 shrink-0 text-info" />{it.question}</div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Admin / PM only: what last week promised (next steps), flagged (metrics off target) or was stuck on (blockers) that this week skipped
 * or didn't move — per function, each with a question to ask. Written by AI (rules when AI isn't configured); runs on first open.
 */
export function FollowThroughPanel({ weekOf, data, engine, at, stale, auto }: { weekOf: string; data: FollowThrough | null; engine: string | null; at: string | null; stale: boolean; auto: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = () => start(async () => { const r = await runFollowThrough(weekOf); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Updated", "success"); router.refresh(); } });
  const once = useRef(false);
  useEffect(() => { if (auto && !data && !once.current) { once.current = true; run(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const total = data?.sections.reduce((a, s) => a + s.items.length, 0) ?? 0;
  return (
    <div className="card mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Sparkles size={15} className="text-info" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">Follow-through vs last week <span className="ml-1 text-[11px] font-normal text-ink-4">admins & program managers only</span></div>
          <div className="text-[12px] text-ink-3">
            {data?.prev_week_of ? `Next steps, weak metrics and blockers from ${fmtDate(data.prev_week_of)} that this week skipped or didn't move` : "Compares each function with the previous week"}
            {at ? ` · ${engine === "claude" ? "AI" : "rules"} · ${new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
            {stale && <span className="ml-1 text-warn">· updates changed since — refresh</span>}
          </div>
        </div>
        <Button size="sm" variant={stale ? "primary" : "secondary"} disabled={pending} onClick={run}><RefreshCw size={13} className={cn(pending && "animate-spin")} />{data ? "Refresh" : "Check now"}</Button>
      </div>
      <div className="p-4">
        {pending && !data ? <p className="text-[13px] text-ink-3">Reading last week’s next steps and this week’s updates…</p>
          : !data ? <p className="text-[13px] text-ink-3">Not checked yet.</p>
          : !data.prev_week_of ? <p className="text-[13px] text-ink-3">There is no earlier week to compare with.</p>
          : !total ? <p className="text-[13px] text-ok">Everything promised last week shows up this week.</p>
          : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.sections.map((s) => (
                <div key={s.section}>
                  <a href={s.section_id ? `#sec-${s.section_id}` : undefined} className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold hover:underline">{s.section}<span className="text-[11.5px] font-normal text-ink-4">{s.owners} · {s.items.length}</span></a>
                  <Items items={s.items} />
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/** Inline, at the top of a section the reader is going through. */
export function SectionPrompts({ s }: { s: FollowSection }) {
  return (
    <div className="mx-4 mt-4 rounded-xl border border-info/25 bg-info-soft/40 p-3 md:mx-5">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-info"><Sparkles size={12} />Ask about — from last week</div>
      <Items items={s.items} />
    </div>
  );
}

/** Admin only: clear every update of the week so it can be rewritten. Two confirmations: acknowledge, then type the week's date. */
export function ResetWeek({ reportId, weekOf, title }: { reportId: string; weekOf: string; title: string }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const close = () => { setStep(0); setAck(false); setTyped(""); };
  return (
    <div className="mt-8 rounded-xl border border-bad/25 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle size={16} className="text-bad" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Clear this week’s updates</div>
          <div className="text-[12px] text-ink-3">Admin only. Removes every section’s update, screenshots, tables, the executive summary and the approval / sent status for {title}, so it can be rewritten.</div>
        </div>
        <Button size="sm" variant="danger" onClick={() => setStep(1)}><Trash2 size={13} />Clear & rewrite…</Button>
      </div>
      {step > 0 && (
        <Modal open onClose={close} title={step === 1 ? "Clear all updates of this week?" : "Final confirmation"}
          footer={step === 1
            ? <><Button onClick={close}>Cancel</Button><Button variant="danger" disabled={!ack} onClick={() => setStep(2)}>Continue</Button></>
            : <><Button onClick={close}>Cancel</Button><Button variant="danger" disabled={pending || typed.trim() !== weekOf} onClick={() => start(async () => {
                const r = await resetWeek(reportId, typed); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Cleared", "success"); close(); router.refresh();
              })}>{pending ? "Clearing…" : "Clear everything"}</Button></>}>
          {step === 1 ? (
            <div className="space-y-3 text-[13px]">
              <p>This deletes <b>every section’s update</b> for <b>{title}</b> — text, metrics, tables and screenshots — plus the executive summary, PM notes and approval / sent status. Owners will see empty sections and fill them in again.</p>
              <p className="text-bad">This can’t be undone.</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand everything for this week will be removed</label>
            </div>
          ) : (
            <div className="space-y-2 text-[13px]">
              <p>Type the week’s date <b className="tabular">{weekOf}</b> to clear it.</p>
              <input className="field tabular" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={weekOf} />
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
