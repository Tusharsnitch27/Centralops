"use client";
import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { HEALTH, type Health } from "@/lib/meta";
import { postProjectUpdate } from "@/server/projects/actions";
import { DateInput, FieldRow, TextArea, useAction } from "./form";

export interface UpdateDefaults { percent: number; health: Health; expected: string | null; previousBlockers: string | null }

/** Structured project update: what changed, progress, blockers, decisions required, next steps, expected completion, %, health. */
export function UpdateComposer({ projectId, defaults, variant = "primary", label = "Post update" }: { projectId: string; defaults: UpdateDefaults; variant?: "primary" | "secondary"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}><PenLine size={13} />{label}</Button>
      {open && <ComposerModal projectId={projectId} defaults={defaults} onClose={() => setOpen(false)} />}
    </>
  );
}

function ComposerModal({ projectId, defaults, onClose }: { projectId: string; defaults: UpdateDefaults; onClose: () => void }) {
  const [v, setV] = useState({ what: "", progress: "", blockers: defaults.previousBlockers ?? "", decisions: "", next: "", expected: defaults.expected && defaults.expected >= new Date().toISOString().slice(0, 10) ? defaults.expected : "", pct: String(defaults.percent), health: defaults.health });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const [pending, run] = useAction();
  return (
    <Modal open onClose={onClose} width={640} title="Project update" description="Structured so every update can be compared with the previous one."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !v.what.trim()} onClick={() => run(() => postProjectUpdate(projectId, {
          whatChanged: v.what, progress: v.progress, blockers: v.blockers, decisionsRequired: v.decisions, nextSteps: v.next,
          expectedCompletion: v.expected || null, percentComplete: v.pct === "" ? null : Number(v.pct), health: v.health as Health,
        }), { onOk: onClose })}>{pending ? "Posting…" : "Post update"}</Button></>}>
      <div className="space-y-3.5">
        <Field label="What changed since the last update?"><TextArea autoFocus value={v.what} onChange={(x) => set("what", x)} rows={3} placeholder="Tunnel installed; reads at 92% vs 98% target. Handheld demo successful." /></Field>
        <Field label="Progress since last update"><TextArea value={v.progress} onChange={(x) => set("progress", x)} rows={2} placeholder="What moved forward — milestones, tasks closed, numbers." /></Field>
        <FieldRow>
          <Field label="Blockers" hint={defaults.previousBlockers ? "Carried over from the last update — clear it if resolved" : undefined}><TextArea value={v.blockers} onChange={(x) => set("blockers", x)} rows={2} placeholder="None" /></Field>
          <Field label="Decisions required"><TextArea value={v.decisions} onChange={(x) => set("decisions", x)} rows={2} placeholder="Who needs to decide what, by when" /></Field>
        </FieldRow>
        <Field label="Next steps"><TextArea value={v.next} onChange={(x) => set("next", x)} rows={2} placeholder="Recalibrate tunnel; finalise wave 1 stores; PO for handhelds." /></Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Expected completion"><DateInput value={v.expected} onChange={(x) => set("expected", x)} /></Field>
          <Field label="% complete"><input className="field tabular" type="number" min={0} max={100} value={v.pct} onChange={(e) => set("pct", e.target.value)} /></Field>
        </div>
        <div>
          <span className="label">Health</span>
          <div className="flex gap-1.5">
            {(Object.keys(HEALTH) as Health[]).map((h) => (
              <button key={h} type="button" onClick={() => set("health", h)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] transition-colors",
                  v.health === h ? "border-ink bg-subtle font-medium text-ink" : "border-line-strong text-ink-3 hover:text-ink")}>
                <span className={cn("size-2 rounded-full", h === "on_track" ? "bg-ok" : h === "at_risk" ? "bg-warn" : "bg-bad")} />{HEALTH[h].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
