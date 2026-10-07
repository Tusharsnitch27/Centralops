"use client";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Badge, Button, Field } from "@/components/ui";
import { Combobox, Modal, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { RISK_LEVEL } from "@/lib/meta";
import { saveRisk } from "@/server/risks/actions";
import { RISK_STATUS, type RiskStatus } from "@/server/risks/meta";
import { DateInput, FieldRow, TextArea, useAction } from "@/components/projects/form";

export interface RiskFormValue {
  id?: string; title: string; description: string; projectId: string | null; ownerId: string | null; probability: number; impact: number;
  mitigation: string; triggerSignal: string; targetDate: string; status: RiskStatus;
}

const P_LABEL = ["", "Rare", "Unlikely", "Possible", "Likely", "Almost certain"];
const I_LABEL = ["", "Minimal", "Minor", "Moderate", "Major", "Severe"];

export function RiskFormButton({ options, initial, label, variant = "primary", size = "sm", iconOnly }: {
  options: { people: Option[]; projects: Option[] }; initial?: Partial<RiskFormValue>; label?: string; variant?: "primary" | "secondary" | "ghost"; size?: "xs" | "sm"; iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const edit = Boolean(initial?.id);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} aria-label={edit ? "Edit risk" : "Log risk"}>
        {edit ? <Pencil size={13} /> : <Plus size={14} />}{!iconOnly && (label ?? (edit ? "Edit" : "Log risk"))}
      </Button>
      {open && <RiskModal options={options} initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

function Scale({ value, onChange, labels }: { value: number; onChange: (n: number) => void; labels: string[] }) {
  return (
    <div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} title={labels[n]}
            className={cn("h-8 flex-1 rounded-md border text-[12.5px] tabular transition-colors", n === value ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-2 hover:bg-subtle")}>{n}</button>
        ))}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">{labels[value]}</div>
    </div>
  );
}

function RiskModal({ options, initial, onClose }: { options: { people: Option[]; projects: Option[] }; initial?: Partial<RiskFormValue>; onClose: () => void }) {
  const [v, setV] = useState<RiskFormValue>({ title: "", description: "", projectId: null, ownerId: null, probability: 3, impact: 3, mitigation: "", triggerSignal: "", targetDate: "", status: "open", ...initial });
  const set = <K extends keyof RiskFormValue>(k: K, x: RiskFormValue[K]) => setV((s) => ({ ...s, [k]: x }));
  const [pending, run] = useAction();
  const score = v.probability * v.impact;
  const lvl = RISK_LEVEL(score);
  return (
    <Modal open onClose={onClose} width={620} title={v.id ? "Edit risk" : "Log a risk"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !v.title.trim()} onClick={() => run(() => saveRisk({ ...v, targetDate: v.targetDate || null }), { onOk: onClose })}>{pending ? "Saving…" : v.id ? "Save" : "Log risk"}</Button></>}>
      <div className="space-y-3.5">
        <Field label="Risk"><TextArea autoFocus rows={2} value={v.title} onChange={(x) => set("title", x)} placeholder="South warehouse inward capacity breach in Diwali week" /></Field>
        <FieldRow>
          <Field label="Project"><Combobox options={options.projects} value={v.projectId} onChange={(x) => set("projectId", x)} placeholder="None" /></Field>
          <Field label="Owner"><Combobox options={options.people} value={v.ownerId} onChange={(x) => set("ownerId", x)} placeholder="Who watches it" /></Field>
        </FieldRow>
        <div className="grid grid-cols-[1fr_1fr_110px] items-start gap-3">
          <div><span className="label">Probability</span><Scale value={v.probability} onChange={(n) => set("probability", n)} labels={P_LABEL} /></div>
          <div><span className="label">Impact</span><Scale value={v.impact} onChange={(n) => set("impact", n)} labels={I_LABEL} /></div>
          <div><span className="label">Score</span><div className="flex h-8 items-center gap-2"><span className="font-serif text-[22px] tabular">{score}</span><Badge tone={lvl.tone}>{lvl.label}</Badge></div></div>
        </div>
        <Field label="Mitigation"><TextArea rows={2} value={v.mitigation} onChange={(x) => set("mitigation", x)} placeholder="What we're doing about it" /></Field>
        <FieldRow>
          <Field label="Trigger signal"><input className="field" value={v.triggerSignal} onChange={(e) => set("triggerSignal", e.target.value)} placeholder="Required inward > 20K/day for 3+ days" /></Field>
          <Field label="Target date"><DateInput value={v.targetDate} onChange={(x) => set("targetDate", x)} /></Field>
        </FieldRow>
        {v.id && (
          <Field label="Status">
            <select className="field" value={v.status} onChange={(e) => set("status", e.target.value as RiskStatus)}>
              {(Object.keys(RISK_STATUS) as RiskStatus[]).filter((s) => s !== "escalated" || v.status === "escalated").map((s) => <option key={s} value={s}>{RISK_STATUS[s].label}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
