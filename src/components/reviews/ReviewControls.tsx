"use client";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Avatar, Button, Field } from "@/components/ui";
import { Combobox, Modal, type Option } from "@/components/ui/client";
import { saveReview, setReviewMomOwner } from "@/server/reviews/actions";
import { FieldRow, TextArea, useAction } from "@/components/projects/form";

const CADENCES = ["daily", "weekly", "fortnightly", "monthly", "quarterly", "adhoc"] as const;
const MODULES: { value: string; label: string; hint: string }[] = [
  { value: "aop", label: "AOP / cost", hint: "Budget vs actual KPIs" },
  { value: "sop", label: "S&OP", hint: "Projection submissions & accuracy" },
  { value: "program", label: "Program", hint: "Projects in the program" },
  { value: "project", label: "Project", hint: "One project" },
  { value: "general", label: "General", hint: "Actions & decisions only" },
];

/** The PM picks who writes the MoM for every meeting of this review. */
export function MomOwnerPicker({ reviewId, value, name, color, people, disabled }: { reviewId: string; value: string | null; name: string | null; color: string | null; people: Option[]; disabled?: boolean }) {
  const [pending, run] = useAction();
  if (disabled) return <span className="flex items-center gap-1.5"><Avatar name={name} color={color} size={20} /><span className="text-ink-2">{name ?? "Not set"}</span></span>;
  return (
    <div className={pending ? "pointer-events-none opacity-60" : ""} onClick={(e) => e.stopPropagation()}>
      <Combobox size="sm" options={people} value={value} placeholder="Choose MoM owner" allowClear={false} className="w-[170px]"
        renderValue={(o) => o ? <span className="flex items-center gap-1.5 truncate"><Avatar name={o.label} size={18} />{o.label}</span> : <span className="text-warn">Not set</span>}
        onChange={(v) => { if (v !== value) run(() => setReviewMomOwner(reviewId, v)); }} />
    </div>
  );
}

export interface ReviewFormValue {
  id?: string; name: string; cadence: string; module: string; description: string; ownerId: string | null; momOwnerId: string | null;
  programId: string | null; projectId: string | null; calendarMatch: string; active: boolean;
}

export function ReviewFormButton({ options, initial, variant = "primary" }: { options: { people: Option[]; programs: Option[]; projects: Option[] }; initial?: Partial<ReviewFormValue>; variant?: "primary" | "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const edit = Boolean(initial?.id);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>{edit ? <Pencil size={13} /> : <Plus size={14} />}{edit ? "Edit series" : "New review"}</Button>
      {open && <ReviewModal options={options} initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewModal({ options, initial, onClose }: { options: { people: Option[]; programs: Option[]; projects: Option[] }; initial?: Partial<ReviewFormValue>; onClose: () => void }) {
  const [v, setV] = useState<ReviewFormValue>({ name: "", cadence: "weekly", module: "general", description: "", ownerId: null, momOwnerId: null, programId: null, projectId: null, calendarMatch: "", active: true, ...initial });
  const set = <K extends keyof ReviewFormValue>(k: K, x: ReviewFormValue[K]) => setV((s) => ({ ...s, [k]: x }));
  const [pending, run] = useAction();
  return (
    <Modal open onClose={onClose} width={600} title={v.id ? "Edit review series" : "New review series"} description="A recurring business review. Calendar events matching the keyword join the series; its pack compiles itself."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !v.name.trim()} onClick={() => run(() => saveReview({ ...v }), { onOk: onClose })}>{pending ? "Saving…" : v.id ? "Save" : "Create review"}</Button></>}>
      <div className="space-y-3.5">
        <Field label="Name"><input autoFocus className="field" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Weekly Returns Review" /></Field>
        <FieldRow>
          <Field label="Cadence">
            <select className="field capitalize" value={v.cadence} onChange={(e) => set("cadence", e.target.value)}>{CADENCES.map((c) => <option key={c} value={c}>{c === "adhoc" ? "Ad hoc" : c}</option>)}</select>
          </Field>
          <Field label="Review pack">
            <select className="field" value={v.module} onChange={(e) => set("module", e.target.value)}>{MODULES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}</select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Owner"><Combobox options={options.people} value={v.ownerId} onChange={(x) => set("ownerId", x)} placeholder="Chairs the review" /></Field>
          <Field label="MoM owner" hint="Writes the minutes for every meeting of this review"><Combobox options={options.people} value={v.momOwnerId} onChange={(x) => set("momOwnerId", x)} placeholder="Who writes the MoM" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Program"><Combobox options={options.programs} value={v.programId} onChange={(x) => set("programId", x)} placeholder="None" /></Field>
          <Field label="Project"><Combobox options={options.projects} value={v.projectId} onChange={(x) => set("projectId", x)} placeholder="None" /></Field>
        </FieldRow>
        <Field label="Calendar match" hint="Case-insensitive text in calendar event titles, e.g. “s&op” or “rfid”"><input className="field" value={v.calendarMatch} onChange={(e) => set("calendarMatch", e.target.value)} placeholder="returns review" /></Field>
        <Field label="What's reviewed"><TextArea rows={2} value={v.description} onChange={(x) => set("description", x)} placeholder="Agenda backbone — KPIs, inputs, actions" /></Field>
        {v.id && <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} />Active</label>}
      </div>
    </Modal>
  );
}
