"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Combobox, Modal, type Option } from "@/components/ui/client";
import { createProject, updateProject } from "@/server/projects/actions";
import { ChipSelect, DateInput, FieldRow, TextArea, useAction } from "./form";

export interface PickerOptions { people: Option[]; teams: Option[]; programs: Option[] }

export interface ProjectFormValue {
  id?: string;
  name: string;
  code: string;
  programId: string | null;
  ownerId: string | null;
  sponsorId: string | null;
  teamIds: string[];
  startDate: string;
  targetDate: string;
  objective: string;
  budget: string;
  spent: string;
}

const EMPTY: ProjectFormValue = { name: "", code: "", programId: null, ownerId: null, sponsorId: null, teamIds: [], startDate: "", targetDate: "", objective: "", budget: "", spent: "" };

export function ProjectFormButton({ options, initial, defaultProgramId, variant = "primary", label }: {
  options: PickerOptions; initial?: Partial<ProjectFormValue>; defaultProgramId?: string | null; variant?: "primary" | "secondary" | "ghost"; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const edit = Boolean(initial?.id);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {edit ? <Pencil size={13} /> : <Plus size={14} />}{label ?? (edit ? "Edit" : "New project")}
      </Button>
      {open && <ProjectFormModal options={options} initial={{ ...EMPTY, programId: defaultProgramId ?? null, ...initial }} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProjectFormModal({ options, initial, onClose }: { options: PickerOptions; initial: ProjectFormValue; onClose: () => void }) {
  const [v, setV] = useState<ProjectFormValue>(initial);
  const [pending, run] = useAction();
  const router = useRouter();
  const set = <K extends keyof ProjectFormValue>(k: K, val: ProjectFormValue[K]) => setV((s) => ({ ...s, [k]: val }));
  const edit = Boolean(v.id);
  const money = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,₹\s]/g, "")));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (edit) {
      run(() => updateProject(v.id!, {
        name: v.name, objective: v.objective, programId: v.programId, ownerId: v.ownerId, sponsorId: v.sponsorId, teamIds: v.teamIds,
        startDate: v.startDate || null, targetDate: v.targetDate || null, budget: money(v.budget), spent: money(v.spent),
      }), { onOk: onClose });
    } else {
      run(() => createProject({
        name: v.name, code: v.code, programId: v.programId, ownerId: v.ownerId, sponsorId: v.sponsorId, teamIds: v.teamIds,
        startDate: v.startDate || null, targetDate: v.targetDate || null, objective: v.objective, budget: money(v.budget),
      }), { onOk: (d) => { onClose(); if (d?.id) router.push(`/projects/${d.id}`); } });
    }
  };
  return (
    <Modal open onClose={onClose} width={600} title={edit ? "Edit project" : "New project"} description={edit ? undefined : "Projects roll up into a program and are tracked through milestones, tasks and structured updates."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="project-form" disabled={pending || !v.name.trim()}>{pending ? "Saving…" : edit ? "Save changes" : "Create project"}</Button></>}>
      <form id="project-form" onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Name"><input autoFocus className="field" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. RFID Expansion — COCO doors" /></Field>
          <Field label="Code"><input className="field font-mono uppercase" value={v.code} disabled={edit} onChange={(e) => set("code", e.target.value)} placeholder="RFID" maxLength={10} /></Field>
        </div>
        <Field label="Objective"><TextArea value={v.objective} onChange={(x) => set("objective", x)} rows={2} placeholder="What does done look like, and by when?" /></Field>
        <FieldRow>
          <Field label="Program"><Combobox options={options.programs} value={v.programId} onChange={(x) => set("programId", x)} placeholder="No program" /></Field>
          <Field label="Owner"><Combobox options={options.people} value={v.ownerId} onChange={(x) => set("ownerId", x)} placeholder="Who drives it" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Sponsor"><Combobox options={options.people} value={v.sponsorId} onChange={(x) => set("sponsorId", x)} placeholder="Who it's accountable to" /></Field>
          <Field label="Budget (₹)" hint={edit ? undefined : "Optional — enables budget utilisation"}><input className="field tabular" inputMode="numeric" value={v.budget} onChange={(e) => set("budget", e.target.value)} placeholder="1,48,00,000" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Start"><DateInput value={v.startDate} onChange={(x) => set("startDate", x)} allowPast /></Field>
          <Field label="Target date"><DateInput value={v.targetDate} onChange={(x) => set("targetDate", x)} min={edit && initial.targetDate && initial.targetDate < new Date().toISOString().slice(0, 10) ? initial.targetDate : undefined} /></Field>
        </FieldRow>
        {edit && <Field label="Spent to date (₹)"><input className="field tabular" inputMode="numeric" value={v.spent} onChange={(e) => set("spent", e.target.value)} /></Field>}
        <div>
          <span className="label">Teams involved</span>
          <ChipSelect options={options.teams} value={v.teamIds} onChange={(x) => set("teamIds", x)} />
        </div>
      </form>
    </Modal>
  );
}
