"use client";
import { useMemo, useState } from "react";
import { Check, Pencil, Plus } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Combobox, Modal, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { saveDecision } from "@/server/decisions/actions";
import type { DecisionStatus } from "@/server/decisions/meta";
import { DateInput, FieldRow, TextArea, todayIST, useAction } from "@/components/projects/form";

export interface DecisionOptions {
  people: Option[];
  projects: Option[];
  meetings: Option[];
  tasks: (Option & { projectId: string | null })[];
}

export interface DecisionFormValue {
  id?: string;
  title: string;
  context: string;
  reason: string;
  impact: string;
  status: DecisionStatus;
  decidedOn: string;
  dueDate: string;
  meetingId: string | null;
  makerId: string | null;
  projectId: string | null;
  taskIds: string[];
}

export function DecisionFormButton({ options, initial, label, variant = "primary", size = "sm", iconOnly }: {
  options: DecisionOptions; initial?: Partial<DecisionFormValue>; label?: string; variant?: "primary" | "secondary" | "ghost"; size?: "xs" | "sm"; iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const edit = Boolean(initial?.id);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} aria-label={edit ? "Edit decision" : "Log decision"}>
        {edit ? <Pencil size={13} /> : <Plus size={14} />}{!iconOnly && (label ?? (edit ? "Edit" : "Log decision"))}
      </Button>
      {open && <DecisionModal options={options} initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

function DecisionModal({ options, initial, onClose }: { options: DecisionOptions; initial?: Partial<DecisionFormValue>; onClose: () => void }) {
  const [v, setV] = useState<DecisionFormValue>({
    title: "", context: "", reason: "", impact: "", status: "made", decidedOn: todayIST(), dueDate: "", meetingId: null, makerId: null, projectId: null, taskIds: [], ...initial,
  });
  const set = <K extends keyof DecisionFormValue>(k: K, x: DecisionFormValue[K]) => setV((s) => ({ ...s, [k]: x }));
  const [pending, run] = useAction();
  const pendingKind = v.status === "pending" || v.status === "proposed";
  const [taskQuery, setTaskQuery] = useState("");
  const tasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    const pool = options.tasks.filter((t) => v.taskIds.includes(t.value) || !v.projectId || t.projectId === v.projectId);
    return (q ? pool.filter((t) => t.label.toLowerCase().includes(q) || t.hint?.toLowerCase().includes(q)) : pool)
      .sort((a, b) => Number(v.taskIds.includes(b.value)) - Number(v.taskIds.includes(a.value))).slice(0, 40);
  }, [options.tasks, v.projectId, v.taskIds, taskQuery]);

  return (
    <Modal open onClose={onClose} width={640} title={v.id ? "Edit decision" : "Log a decision"} description="Decisions are the institutional memory — capture the why, not just the what."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !v.title.trim()} onClick={() => run(() => saveDecision({
          id: v.id, title: v.title, context: v.context, reason: v.reason, impact: v.impact, status: v.status, decidedOn: v.decidedOn || null, dueDate: v.dueDate || null,
          meetingId: v.meetingId, makerId: v.makerId, projectId: v.projectId, taskIds: v.taskIds,
        }), { onOk: onClose })}>{pending ? "Saving…" : v.id ? "Save" : pendingKind ? "Add to decisions required" : "Log decision"}</Button></>}>
      <div className="space-y-3.5">
        <div className="inline-flex rounded-lg border border-line-strong p-0.5">
          {([["made", "Decided"], ["pending", "Decision required"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => set("status", k)}
              className={cn("h-7 rounded-md px-3 text-[12.5px]", (k === "pending" ? pendingKind : !pendingKind) ? "bg-subtle font-medium text-ink" : "text-ink-3 hover:text-ink")}>{l}</button>
          ))}
        </div>
        <Field label={pendingKind ? "What needs deciding?" : "Decision"}><TextArea autoFocus rows={2} value={v.title} onChange={(x) => set("title", x)} placeholder={pendingKind ? "Approve temp manpower budget for OND peak" : "Proceed with COCO wave 1 (12 doors) in November"} /></Field>
        <Field label="Context"><TextArea rows={2} value={v.context} onChange={(x) => set("context", x)} placeholder="What prompted it — numbers, constraints" /></Field>
        {!pendingKind && (
          <FieldRow>
            <Field label="Reason"><TextArea rows={2} value={v.reason} onChange={(x) => set("reason", x)} placeholder="Why this option" /></Field>
            <Field label="Impact"><TextArea rows={2} value={v.impact} onChange={(x) => set("impact", x)} placeholder="Cost, timeline, people affected" /></Field>
          </FieldRow>
        )}
        <FieldRow>
          <Field label={pendingKind ? "Who decides" : "Decided by"}><Combobox options={options.people} value={v.makerId} onChange={(x) => set("makerId", x)} placeholder="Person" /></Field>
          {pendingKind
            ? <Field label="Decide by"><DateInput value={v.dueDate} onChange={(x) => set("dueDate", x)} /></Field>
            : <Field label="Decided on"><input type="date" className="field" value={v.decidedOn} max={todayIST()} onChange={(e) => set("decidedOn", e.target.value)} /></Field>}
        </FieldRow>
        <FieldRow>
          <Field label="Project"><Combobox options={options.projects} value={v.projectId} onChange={(x) => set("projectId", x)} placeholder="None" /></Field>
          <Field label="Meeting"><Combobox options={options.meetings} value={v.meetingId} onChange={(x) => set("meetingId", x)} placeholder="Not from a meeting" /></Field>
        </FieldRow>
        <div>
          <span className="label">Related tasks {v.taskIds.length > 0 && <span className="text-ink-3">· {v.taskIds.length} linked</span>}</span>
          <input className="field mb-1.5 h-8 py-1 text-[12.5px]" placeholder={v.projectId ? "Search this project's tasks…" : "Search tasks…"} value={taskQuery} onChange={(e) => setTaskQuery(e.target.value)} />
          <div className="max-h-40 overflow-y-auto rounded-lg border border-line scroll-thin">
            {tasks.map((t) => {
              const on = v.taskIds.includes(t.value);
              return (
                <button key={t.value} type="button" onClick={() => set("taskIds", on ? v.taskIds.filter((x) => x !== t.value) : [...v.taskIds, t.value])}
                  className={cn("flex w-full items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-left text-[12.5px] last:border-0 hover:bg-subtle", on && "bg-subtle")}>
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-ink bg-ink text-canvas" : "border-line-strong")}>{on && <Check size={10} strokeWidth={3} />}</span>
                  <span className="w-12 shrink-0 font-mono text-[11px] text-ink-4">{t.hint}</span>
                  <span className="truncate text-ink-2">{t.label}</span>
                </button>
              );
            })}
            {!tasks.length && <div className="px-3 py-3 text-center text-[12px] text-ink-4">No tasks match</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
