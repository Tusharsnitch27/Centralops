"use client";
import { useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { MenuItem, Modal, Popover } from "@/components/ui/client";
import { HEALTH, type Health, type Tone } from "@/lib/meta";
import { PROJECT_STATUS, type ProjectStatus } from "@/server/projects/metrics";
import { requestProjectUpdate, updateProject } from "@/server/projects/actions";
import { TextArea, useAction } from "./form";

/** Inline health / status editors for the project header. */
export function HealthPicker({ projectId, health, disabled }: { projectId: string; health: Health; disabled?: boolean }) {
  const [pending, run] = useAction();
  const m = HEALTH[health];
  if (disabled) return <Badge tone={m.tone as Tone} dot>{m.label}</Badge>;
  return (
    <Popover trigger={({ toggle }) => (
      <button type="button" onClick={toggle} disabled={pending} className="group inline-flex items-center gap-0.5 rounded-md" title="Change health">
        <Badge tone={m.tone as Tone} dot>{m.label}<ChevronDown size={11} className="opacity-50 group-hover:opacity-100" /></Badge>
      </button>
    )}>
      {(close) => (Object.keys(HEALTH) as Health[]).map((h) => (
        <MenuItem key={h} active={h === health} onClick={() => { close(); if (h !== health) run(() => updateProject(projectId, { health: h }), { success: `Health set to ${HEALTH[h].label}` }); }}
          icon={<span className={`block size-2 rounded-full ${h === "on_track" ? "bg-ok" : h === "at_risk" ? "bg-warn" : "bg-bad"}`} />}>
          {HEALTH[h].label}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function StatusPicker({ projectId, status, disabled }: { projectId: string; status: ProjectStatus; disabled?: boolean }) {
  const [pending, run] = useAction();
  const m = PROJECT_STATUS[status];
  if (disabled) return <Badge tone={m.tone as Tone}>{m.label}</Badge>;
  return (
    <Popover trigger={({ toggle }) => (
      <button type="button" onClick={toggle} disabled={pending} className="group inline-flex items-center rounded-md" title="Change status">
        <Badge tone={m.tone as Tone}>{m.label}<ChevronDown size={11} className="opacity-50 group-hover:opacity-100" /></Badge>
      </button>
    )}>
      {(close) => (Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => (
        <MenuItem key={s} active={s === status} onClick={() => { close(); if (s !== status) run(() => updateProject(projectId, { status: s }), { success: `Status set to ${PROJECT_STATUS[s].label}` }); }}>
          {PROJECT_STATUS[s].label}
        </MenuItem>
      ))}
    </Popover>
  );
}

export function RequestUpdateButton({ projectId, ownerName, openRequests, size = "sm", variant = "secondary" }: {
  projectId: string; ownerName: string | null; openRequests?: number; size?: "xs" | "sm"; variant?: "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, run] = useAction();
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} disabled={!ownerName}>
        <Send size={13} />Request update{openRequests ? <span className="ml-0.5 rounded-full bg-warn-soft px-1.5 text-[10.5px] text-warn">{openRequests} open</span> : null}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} width={460} title={`Ask ${ownerName ?? "the owner"} for an update`}
        description="Logged as a follow-up, sent as a notification and added to their inbox. It closes automatically when they post an update."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => run(() => requestProjectUpdate(projectId, msg), { onOk: () => { setOpen(false); setMsg(""); } })}>{pending ? "Sending…" : "Send request"}</Button></>}>
        <TextArea value={msg} onChange={setMsg} rows={3} autoFocus placeholder="Optional note — e.g. Need the revised tunnel date before Friday's review." />
      </Modal>
    </>
  );
}
