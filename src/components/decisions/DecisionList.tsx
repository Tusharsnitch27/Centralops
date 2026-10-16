"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, CircleDashed, FolderKanban, Gavel, ListChecks } from "lucide-react";
import { Avatar, Badge, Button, Field } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/meta";
import { DECISION_STATUS, type DecisionStatus } from "@/server/decisions/meta";
import { markDecisionMade } from "@/server/decisions/actions";
import { TextArea, todayIST, useAction } from "@/components/projects/form";
import { DecisionFormButton, type DecisionOptions } from "./DecisionForm";

export interface DecisionView {
  id: string; title: string; context: string | null; reason: string | null; impact: string | null; status: DecisionStatus;
  decided_on: string | null; due_date: string | null; meeting_id: string | null; meeting_title: string | null; meeting_date: string | null;
  decision_maker_id: string | null; maker_name: string | null; maker_color: string | null; project_id: string | null; project_name: string | null; project_code: string | null;
  tasks: { id: string; number: number; title: string; status: string; owner_name: string | null; due_date: string | null }[];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: string | null) => (d ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : "—");
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

export function DecisionList({ decisions, options, focusId, editable, compact }: { decisions: DecisionView[]; options: DecisionOptions; focusId?: string | null; editable: boolean; compact?: boolean }) {
  return (
    <div className="divide-y divide-line/70">
      {decisions.map((d) => <DecisionRow key={d.id} d={d} options={options} focused={d.id === focusId} editable={editable} compact={compact} />)}
    </div>
  );
}

function DecisionRow({ d, options, focused, editable, compact }: { d: DecisionView; options: DecisionOptions; focused: boolean; editable: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused) { setOpen(true); ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, [focused]);
  const pending = d.status === "pending" || d.status === "proposed";
  const td = todayIST();
  const dueIn = pending && d.due_date ? days(d.due_date, td) : null;
  const st = DECISION_STATUS[d.status];
  const hasDetail = d.context || d.reason || d.impact || d.tasks.length;
  return (
    <div ref={ref} id={`d-${d.id}`} className={cn("group scroll-mt-24 px-4 py-3 transition-colors", focused && "bg-info-soft/40 ring-1 ring-inset ring-info/25")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border", pending ? "border-warn/30 bg-warn-soft text-warn" : "border-line bg-subtle text-ink-3")}>
          {pending ? <CircleDashed size={14} /> : <Gavel size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink">{d.title}</span>
            {hasDetail ? <ChevronDown size={14} className={cn("mt-0.5 shrink-0 text-ink-4 transition-transform", open && "rotate-180")} /> : null}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
            {pending ? (
              <span className={cn("font-medium tabular", dueIn != null && dueIn < 0 ? "text-bad" : dueIn != null && dueIn <= 3 ? "text-warn" : "text-ink-2")}>
                {d.due_date ? (dueIn! < 0 ? `${-dueIn!}d overdue` : dueIn === 0 ? "Decide today" : `Decide by ${fmt(d.due_date)}`) : "No decide-by date"}
              </span>
            ) : <span className="tabular">{fmt(d.decided_on)}</span>}
            {!pending && d.status !== "made" && <Badge tone={st.tone as Tone}>{st.label}</Badge>}
            {d.maker_name && <span className="flex items-center gap-1"><Avatar name={d.maker_name} color={d.maker_color} size={16} />{d.maker_name}</span>}
            {d.meeting_id && <Link href={`/meetings/${d.meeting_id}`} className="flex items-center gap-1 hover:text-ink"><CalendarClock size={12} />{d.meeting_title}{d.meeting_date ? ` · ${fmt(d.meeting_date)}` : ""}</Link>}
            {!compact && d.project_id && <Link href={`/projects/${d.project_id}`} className="flex items-center gap-1 hover:text-ink"><FolderKanban size={12} />{d.project_code ?? d.project_name}</Link>}
            {d.tasks.length > 0 && <span className="flex items-center gap-1"><ListChecks size={12} />{d.tasks.filter((t) => t.status === "completed").length}/{d.tasks.length} actions done</span>}
          </div>
          {open && hasDetail ? (
            <div className="mt-3 grid gap-x-6 gap-y-2 rounded-lg border border-line bg-subtle/40 p-3 text-[13px] sm:grid-cols-[90px_1fr]">
              {d.context && <><dt className="text-[12px] text-ink-3">Context</dt><dd className="whitespace-pre-line text-ink-2">{d.context}</dd></>}
              {d.reason && <><dt className="text-[12px] text-ink-3">Reason</dt><dd className="whitespace-pre-line text-ink-2">{d.reason}</dd></>}
              {d.impact && <><dt className="text-[12px] text-ink-3">Impact</dt><dd className="whitespace-pre-line text-ink-2">{d.impact}</dd></>}
              {d.tasks.length > 0 && (
                <>
                  <dt className="text-[12px] text-ink-3">Actions</dt>
                  <dd className="space-y-1">
                    {d.tasks.map((t) => (
                      <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-2 text-ink-2 hover:text-ink">
                        {t.status === "completed" ? <CheckCircle2 size={13} className="text-ok" /> : <CircleDashed size={13} className="text-ink-4" />}
                        <span className="font-mono text-[11px] text-ink-4">CO-{t.number}</span>
                        <span className={cn("truncate", t.status === "completed" && "text-ink-3 line-through")}>{t.title}</span>
                        {t.owner_name && <span className="shrink-0 text-[12px] text-ink-3">· {t.owner_name}</span>}
                      </Link>
                    ))}
                  </dd>
                </>
              )}
            </div>
          ) : null}
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            {pending && <MarkMade d={d} />}
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <DecisionFormButton options={options} variant="ghost" size="xs" iconOnly initial={{
                id: d.id, title: d.title, context: d.context ?? "", reason: d.reason ?? "", impact: d.impact ?? "", status: d.status, decidedOn: d.decided_on ?? todayIST(), dueDate: d.due_date ?? "",
                meetingId: d.meeting_id, makerId: d.decision_maker_id, projectId: d.project_id, taskIds: d.tasks.map((t) => t.id),
              }} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MarkMade({ d }: { d: DecisionView }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(d.title);
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState("");
  const [pending, run] = useAction();
  return (
    <>
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}><Gavel size={12} />Record decision</Button>
      <Modal open={open} onClose={() => setOpen(false)} width={520} title="Record the decision" description="Moves it from Decisions required into the log, dated today."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={pending || !title.trim()} onClick={() => run(() => markDecisionMade(d.id, { title, reason, impact }), { onOk: () => setOpen(false) })}>{pending ? "Saving…" : "Mark decided"}</Button></>}>
        <div className="space-y-3.5">
          <Field label="What was decided"><TextArea autoFocus rows={2} value={title} onChange={setTitle} /></Field>
          <Field label="Reason"><TextArea rows={2} value={reason} onChange={setReason} placeholder="Why this option" /></Field>
          <Field label="Impact"><TextArea rows={2} value={impact} onChange={setImpact} placeholder="Cost, timeline, people affected" /></Field>
        </div>
      </Modal>
    </>
  );
}
