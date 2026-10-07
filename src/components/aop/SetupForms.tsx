"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Avatar, Button, Card, CardHeader, Field } from "@/components/ui";
import { Combobox, Modal, useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { addContributor, addItem, addSection, createCycle, removeContributor, setSectionOwner, updateCycle } from "@/server/aop/actions";
import { LABEL_PRESETS, type Labels } from "@/server/aop/calc";
import { usePeople } from "./Actions";

type Kind = "cost" | "revenue" | "mixed";
type Status = "draft" | "active" | "closed";
export interface SetupCycle { id: string; name: string; kind: Kind; status: Status; labels: Labels; actuals_cutoff_day: number; projection_cutoff_day: number; guidelines: string[]; fy_start: string; months: number }
export interface SetupSection { id: string; name: string; kind: string; parentId: string | null; ownerId: string | null; ownerName: string | null; ownerLabel: string | null; contributors: { id: string; name: string }[]; items: number }

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, after?: (d: unknown) => void) => start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error ?? "Failed", "error");
      toast(r.message ?? "Saved", "success"); after?.(r.data); router.refresh();
    }),
  };
}

export function CycleSettings({ cycle, canEdit }: { cycle: SetupCycle; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [c, setC] = useState(cycle);
  const [newG, setNewG] = useState("");
  const dirty = JSON.stringify(c) !== JSON.stringify(cycle);
  return (
    <Card>
      <CardHeader title="Cycle settings" subtitle="Measure names and cut-offs drive every label, reminder and due date"
        action={canEdit ? <Button size="sm" variant="primary" disabled={pending || !dirty} onClick={() => run(() => updateCycle({ ...c, fy_start: c.fy_start }))}>{pending ? "Saving…" : "Save changes"}</Button> : null} />
      <fieldset disabled={!canEdit} className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Name"><input className="field" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind" hint="Revenue/target plans treat higher as better">
            <select className="field" value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value as Kind })}><option value="cost">Cost</option><option value="revenue">Revenue / target</option><option value="mixed">Mixed</option></select>
          </Field>
          <Field label="Status"><select className="field" value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as Status })}><option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option></select></Field>
        </div>
        <div className="md:col-span-2">
          <div className="label flex items-center justify-between">Measure labels
            <span className="flex gap-1">{Object.entries(LABEL_PRESETS).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setC({ ...c, labels: l })} className="rounded-md px-1.5 py-0.5 text-[11.5px] font-normal text-ink-3 ring-1 ring-inset ring-line hover:text-ink">{l.plan} / {l.forecast} / {l.actual}</button>
            ))}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(["plan", "forecast", "actual"] as const).map((k) => (
              <label key={k} className="block"><span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-4">{k}</span>
                <input className="field" value={c.labels[k]} onChange={(e) => setC({ ...c, labels: { ...c.labels, [k]: e.target.value } })} /></label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan year starts"><input type="month" className="field" value={c.fy_start.slice(0, 7)} onChange={(e) => setC({ ...c, fy_start: `${e.target.value}-01` })} /></Field>
          <Field label="Months"><input type="number" min={1} max={24} className="field" value={c.months} onChange={(e) => setC({ ...c, months: Number(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${c.labels.actual} due (day of next month)`}><input type="number" min={1} max={28} className="field" value={c.actuals_cutoff_day} onChange={(e) => setC({ ...c, actuals_cutoff_day: Number(e.target.value) })} /></Field>
          <Field label={`${c.labels.forecast} due (day of prior month)`}><input type="number" min={1} max={28} className="field" value={c.projection_cutoff_day} onChange={(e) => setC({ ...c, projection_cutoff_day: Number(e.target.value) })} /></Field>
        </div>
        <div className="md:col-span-2">
          <span className="label">Guidelines for owners</span>
          <ol className="space-y-1.5">
            {c.guidelines.map((g, i) => (
              <li key={i} className="group flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right text-[12px] tabular text-ink-4">{i + 1}.</span>
                <textarea rows={1} className="field min-h-9 resize-y py-1.5 text-[13px]" value={g.replace(/^\d+\.\s*/, "")}
                  onChange={(e) => setC({ ...c, guidelines: c.guidelines.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button type="button" onClick={() => setC({ ...c, guidelines: c.guidelines.filter((_, j) => j !== i) })} className="mt-1.5 rounded p-1 text-ink-4 opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Remove"><X size={14} /></button>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex gap-2 pl-7">
            <input className="field h-8 py-1 text-[13px]" placeholder="Add a guideline" value={newG} onChange={(e) => setNewG(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newG.trim()) { e.preventDefault(); setC({ ...c, guidelines: [...c.guidelines, newG.trim()] }); setNewG(""); } }} />
            <Button size="sm" disabled={!newG.trim()} onClick={() => { setC({ ...c, guidelines: [...c.guidelines, newG.trim()] }); setNewG(""); }}><Plus size={13} />Add</Button>
          </div>
        </div>
      </fieldset>
    </Card>
  );
}

export function OwnersTable({ cycleId, sections, canEdit }: { cycleId: string; sections: SetupSection[]; canEdit: boolean }) {
  const people = usePeople();
  const { pending, run } = useRun();
  const [adding, setAdding] = useState<{ kind: "function" | "group" | "line"; parentId: string | null; name: string } | null>(null);
  const fns = sections.filter((s) => !s.parentId);
  const kids = (id: string) => sections.filter((s) => s.parentId === id);
  const row = (s: SetupSection, depth: number) => (
    <tr key={s.id} className={cn(depth === 0 && "bg-subtle/50")}>
      <td style={{ paddingLeft: 12 + depth * 18 }} className={cn(depth === 0 ? "font-medium text-ink" : "text-ink-2")}>
        {s.name}<span className="ml-2 text-[11.5px] font-normal text-ink-4">{s.items ? `${s.items} lines` : ""}</span>
      </td>
      <td className="w-[210px]">
        {canEdit ? <Combobox size="sm" options={people} value={s.ownerId} placeholder="Assign owner" onChange={(v) => run(() => setSectionOwner({ sectionId: s.id, ownerId: v, cascade: depth === 0 }))} />
          : <span className="flex items-center gap-1.5"><Avatar name={s.ownerName} size={18} />{s.ownerName ?? "—"}</span>}
      </td>
      <td className="text-[12px] text-ink-3">{depth === 0 ? s.ownerLabel ?? "" : ""}</td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          {s.contributors.map((c) => (
            <span key={c.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-subtle pl-1 pr-1.5 text-[12px] text-ink-2 ring-1 ring-inset ring-line">
              <Avatar name={c.name} size={16} />{c.name}
              {canEdit && <button type="button" onClick={() => run(() => removeContributor({ sectionId: s.id, userId: c.id }))} className="text-ink-4 hover:text-bad" aria-label="Remove"><X size={11} /></button>}
            </span>
          ))}
          {canEdit && <div className="w-[130px]"><Combobox size="sm" options={people.filter((p) => !s.contributors.some((c) => c.id === p.value) && p.value !== s.ownerId)} value={null} placeholder="+ Contributor" allowClear={false}
            onChange={(v) => v && run(() => addContributor({ sectionId: s.id, userId: v }))} /></div>}
        </div>
      </td>
      <td className="w-[150px] text-right">
        {canEdit && <span className="inline-flex gap-1">
          {depth === 0 && <Button size="xs" variant="ghost" onClick={() => setAdding({ kind: "group", parentId: s.id, name: "" })}><Plus size={12} />Group</Button>}
          <Button size="xs" variant="ghost" onClick={() => setAdding({ kind: "line", parentId: s.id, name: "" })}><Plus size={12} />Line</Button>
        </span>}
      </td>
    </tr>
  );
  return (
    <Card className="min-w-0">
      <CardHeader title="Owners & contributors" subtitle="Owners can update their lines' provisions, actuals and commentary; the function owner receives input reminders"
        action={canEdit ? <Button size="xs" variant="secondary" onClick={() => setAdding({ kind: "function", parentId: null, name: "" })}><Plus size={13} />Function</Button> : null} />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Function / group</th><th>Owner</th><th>As written</th><th>Contributors</th><th /></tr></thead>
          <tbody>{fns.flatMap((f) => [row(f, 0), ...kids(f.id).map((g) => row(g, 1))])}</tbody>
        </table>
      </div>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add ${adding.kind}` : ""} width={420}
        footer={<><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button variant="primary" disabled={pending || !adding?.name.trim()} onClick={() => adding && run(
          () => (adding.kind === "line" ? addItem({ sectionId: adding.parentId!, name: adding.name }) : addSection({ cycleId, parentId: adding.parentId, name: adding.name })), () => setAdding(null))}>Add</Button></>}>
        {adding && <Field label="Name"><input autoFocus className="field" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></Field>}
      </Modal>
    </Card>
  );
}

export function NewCycleButton({ currentId, currentName }: { currentId: string | null; currentName: string | null }) {
  const router = useRouter();
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", kind: "cost" as Kind, fy_start: "2027-04", copy: !!currentId, copyPlan: false, activate: false });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Plus size={14} />New cycle</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New plan cycle" description="Cost budgets, revenue targets or a mix — labels follow the kind." width={480}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending || !f.name.trim()} onClick={() => run(() => createCycle({
          name: f.name, kind: f.kind, fy_start: `${f.fy_start}-01`, copyFrom: f.copy ? currentId : null, copyPlan: f.copyPlan, activate: f.activate,
        }), (d) => { setOpen(false); router.push(`/aop/setup?cycle=${(d as { id: string }).id}`); })}>Create cycle</Button></>}>
        <div className="space-y-3 pt-1">
          <Field label="Name"><input autoFocus className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Central Ops Cost · FY 27-28" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind"><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}><option value="cost">Cost (Budget / Provision / Actuals)</option><option value="revenue">Revenue (Target / Forecast / Actual)</option><option value="mixed">Mixed</option></select></Field>
            <Field label="First month"><input type="month" className="field" value={f.fy_start} onChange={(e) => setF({ ...f, fy_start: e.target.value })} /></Field>
          </div>
          {currentId && <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={f.copy} onChange={(e) => setF({ ...f, copy: e.target.checked })} />Copy functions, lines and owners from {currentName}</label>}
          {currentId && f.copy && <label className="flex items-center gap-2 pl-5 text-[13px] text-ink-2"><input type="checkbox" checked={f.copyPlan} onChange={(e) => setF({ ...f, copyPlan: e.target.checked })} />Also carry over monthly plan values as a starting point</label>}
          <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={f.activate} onChange={(e) => setF({ ...f, activate: e.target.checked })} />Make it active now</label>
        </div>
      </Modal>
    </>
  );
}
