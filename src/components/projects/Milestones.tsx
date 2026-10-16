"use client";
import { useState } from "react";
import { Check, Flag, Pencil, Plus } from "lucide-react";
import { Badge, Button, Field } from "@/components/ui";
import { Modal, MenuItem, Popover } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/meta";
import { MILESTONE_STATUS, type MilestoneStatus } from "@/server/projects/metrics";
import { saveMilestone, setMilestoneStatus } from "@/server/projects/actions";
import { DateInput, FieldRow, todayIST, useAction } from "./form";

export interface MilestoneView {
  id: string; title: string; due_date: string | null; baseline_date: string | null; status: MilestoneStatus; slip: number; overdue: number; completed_at: string | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: string | null) => (d ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : "—");
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Horizontal plan-vs-current timeline. Baseline = hollow marker, current = filled; amber connector = slip. */
export function MilestoneTimeline({ milestones, start, target }: { milestones: MilestoneView[]; start: string | null; target: string | null }) {
  const dated = milestones.filter((m) => m.due_date);
  if (!dated.length) return null;
  const td = todayIST();
  const pts = [...dated.flatMap((m) => [m.due_date!, m.baseline_date ?? m.due_date!]), td, ...(start ? [start] : []), ...(target ? [target] : [])].map(t);
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = (hi - lo) * 0.04 || 86400000 * 7;
  const x = (d: string) => ((t(d) - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  // month ticks
  const ticks: { label: string; at: number }[] = [];
  const s0 = new Date(lo - pad); let cur = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 1);
  while (cur < hi + pad) { const d = new Date(cur); ticks.push({ label: MON[d.getUTCMonth()], at: ((cur - (lo - pad)) / (hi + pad - (lo - pad))) * 100 }); cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return (
    <div className="relative h-[150px] select-none px-2">
      <div className="absolute inset-x-2 top-[75px] h-px bg-line-strong" />
      {ticks.map((k) => (
        <div key={k.at} className="absolute top-[70px] flex flex-col items-center" style={{ left: `calc(${k.at}% )` }}>
          <span className="h-[11px] w-px bg-line-strong" />
          <span className="mt-[52px] -translate-x-0 text-[10.5px] uppercase tracking-wide text-ink-4">{k.label}</span>
        </div>
      ))}
      {start && <Marker at={x(start)} label="Start" sub={fmt(start)} />}
      {target && <Marker at={x(target)} label="Target" sub={fmt(target)} strong />}
      <div className="absolute top-[52px] bottom-[30px] w-px bg-info/60" style={{ left: `${x(td)}%` }}>
        <span className="absolute -top-4 -translate-x-1/2 rounded bg-info-soft px-1 text-[10.5px] font-medium text-info">Today</span>
      </div>
      {dated.map((m, i) => {
        const cx = x(m.due_date!), bx = m.baseline_date ? x(m.baseline_date) : cx;
        const late = m.slip > 0 || m.overdue > 0;
        const up = i % 2 === 0;
        const tone = m.status === "done" ? "bg-ok border-ok" : m.overdue > 0 ? "bg-bad border-bad" : late ? "bg-warn border-warn" : m.status === "in_progress" ? "bg-info border-info" : "bg-surface border-ink-3";
        return (
          <div key={m.id}>
            {m.slip > 0 && <div className="absolute top-[74px] h-[3px] rounded-full bg-warn/45" style={{ left: `${Math.min(bx, cx)}%`, width: `${Math.abs(cx - bx)}%` }} title={`Slipped ${m.slip}d vs baseline`} />}
            {m.slip > 0 && <span className="absolute top-[71px] size-[9px] -translate-x-1/2 rounded-full border-[1.5px] border-dashed border-warn bg-surface" style={{ left: `${bx}%` }} title={`Baseline ${fmt(m.baseline_date)}`} />}
            <span className={cn("absolute top-[70px] z-10 size-[11px] -translate-x-1/2 rotate-45 rounded-[2px] border-[1.5px]", tone)} style={{ left: `${cx}%` }} />
            <div className={cn("absolute w-[132px] -translate-x-1/2 text-center", up ? "top-0" : "top-[92px]")} style={{ left: `${Math.min(Math.max(cx, 6), 94)}%` }}>
              <div className={cn("truncate text-[11.5px] leading-tight", m.status === "done" ? "text-ink-3" : "font-medium text-ink")} title={m.title}>{m.title}</div>
              <div className="text-[10.5px] tabular text-ink-3">
                {fmt(m.due_date)}{m.slip > 0 && <span className="ml-1 font-medium text-warn">+{m.slip}d</span>}{m.status === "done" && <span className="ml-1 text-ok">✓</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Marker({ at, label, sub, strong }: { at: number; label: string; sub: string; strong?: boolean }) {
  return (
    <div className="absolute top-[60px] bottom-[30px] w-px border-l border-dashed border-line-strong" style={{ left: `${at}%` }} title={`${label} · ${sub}`}>
      <span className={cn("absolute -bottom-0 left-1 text-[10.5px] whitespace-nowrap", strong ? "font-medium text-ink-2" : "text-ink-4")}>{label}</span>
    </div>
  );
}

/** Milestone list with complete / edit / add. */
export function MilestoneList({ projectId, milestones, editable }: { projectId: string; milestones: MilestoneView[]; editable: boolean }) {
  const [editing, setEditing] = useState<MilestoneView | "new" | null>(null);
  const [pending, run] = useAction();
  return (
    <div>
      <div className="divide-y divide-line/70">
        {milestones.map((m) => {
          const st = MILESTONE_STATUS[m.status];
          return (
            <div key={m.id} className="group flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-subtle/50">
              <button type="button" disabled={!editable || pending} aria-label={m.status === "done" ? "Reopen milestone" : "Complete milestone"}
                onClick={() => run(() => setMilestoneStatus(m.id, m.status === "done" ? "in_progress" : "done"))}
                className={cn("flex size-[18px] shrink-0 rotate-45 items-center justify-center rounded-[4px] border transition-colors",
                  m.status === "done" ? "border-ok bg-ok text-canvas" : "border-ink-4 hover:border-ink-2")}>
                <Check size={10} strokeWidth={3} className={cn("-rotate-45", m.status === "done" ? "opacity-100" : "opacity-0 group-hover:opacity-30")} />
              </button>
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", m.status === "done" ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}>{m.title}</span>
              {m.overdue > 0 && <Badge tone="red">{m.overdue}d overdue</Badge>}
              {m.slip > 0 && <Badge tone="amber">Slipped +{m.slip}d</Badge>}
              {editable ? (
                <Popover align="end" trigger={({ toggle }) => <button type="button" onClick={toggle}><Badge tone={st.tone as Tone}>{st.label}</Badge></button>}>
                  {(close) => (Object.keys(MILESTONE_STATUS) as MilestoneStatus[]).map((s) => (
                    <MenuItem key={s} active={s === m.status} onClick={() => { close(); run(() => setMilestoneStatus(m.id, s)); }}>{MILESTONE_STATUS[s].label}</MenuItem>
                  ))}
                </Popover>
              ) : <Badge tone={st.tone as Tone}>{st.label}</Badge>}
              <span className="w-[120px] shrink-0 text-right text-[12px] tabular text-ink-3">
                {m.baseline_date && m.baseline_date !== m.due_date && <span className="mr-1.5 text-ink-4 line-through">{fmt(m.baseline_date)}</span>}
                <span className={cn(m.overdue > 0 ? "font-medium text-bad" : "text-ink-2")}>{fmt(m.due_date)}</span>
              </span>
              {editable && <button type="button" onClick={() => setEditing(m)} className="rounded p-1 text-ink-4 opacity-0 hover:bg-muted hover:text-ink group-hover:opacity-100" aria-label="Edit milestone"><Pencil size={13} /></button>}
            </div>
          );
        })}
        {!milestones.length && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-subtle text-ink-3"><Flag size={17} /></div>
            <div className="text-[13px] font-medium text-ink">No milestones yet</div>
            <p className="mt-1 max-w-sm text-[13px] text-ink-3">Milestones drive progress and slip tracking. Add the 3–6 checkpoints that matter.</p>
          </div>
        )}
      </div>
      {editable && (
        <div className="border-t border-line px-3 py-2">
          <Button variant="ghost" size="xs" onClick={() => setEditing("new")}><Plus size={13} />Add milestone</Button>
        </div>
      )}
      {editing && <MilestoneModal projectId={projectId} m={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MilestoneModal({ projectId, m, onClose }: { projectId: string; m: MilestoneView | null; onClose: () => void }) {
  const [title, setTitle] = useState(m?.title ?? "");
  const [due, setDue] = useState(m?.due_date ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(m?.status ?? "pending");
  const [note, setNote] = useState("");
  const [pending, run] = useAction();
  const moved = m && due !== m.due_date;
  const pastLocked = m?.due_date && m.due_date < todayIST();
  return (
    <Modal open onClose={onClose} width={480} title={m ? "Edit milestone" : "Add milestone"}
      description={m ? (m.baseline_date ? `Baseline ${fmt(m.baseline_date)} stays fixed — moving the date shows as slip.` : undefined) : "The first date you set becomes the baseline."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !title.trim()} onClick={() => run(() => saveMilestone({ id: m?.id, projectId, title, dueDate: due || null, status, note }), { onOk: onClose })}>{pending ? "Saving…" : m ? "Save" : "Add milestone"}</Button></>}>
      <div className="space-y-3.5">
        <Field label="Milestone"><input autoFocus className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Handheld rollout — North WH" /></Field>
        <FieldRow>
          <Field label="Due date" hint={pastLocked && !moved ? "Past due — pick a new date to re-plan" : undefined}><DateInput value={due} onChange={setDue} /></Field>
          <Field label="Status">
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value as MilestoneStatus)}>
              {(Object.keys(MILESTONE_STATUS) as MilestoneStatus[]).map((s) => <option key={s} value={s}>{MILESTONE_STATUS[s].label}</option>)}
            </select>
          </Field>
        </FieldRow>
        {moved && <Field label="Why is the date moving?"><input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vendor recalibration slot moved to Monday" /></Field>}
      </div>
    </Modal>
  );
}
