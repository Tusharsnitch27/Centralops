"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellRing, Pencil } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { Combobox, Popover, useToast } from "@/components/ui/client";
import { changeMomOwner, nudgeMomOwner, updatePrep } from "@/server/meetings/actions";

export function MomOwnerControl({ meetingId, owner, people, canChange }: { meetingId: string; owner: { id: string; name: string; color: string | null } | null; people: { id: string; name: string; color: string | null }[]; canChange: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      {owner ? <><Avatar name={owner.name} color={owner.color} size={20} /><span className="truncate">{owner.name}</span></> : <span className="text-ink-4">Not set</span>}
      {canChange && (
        <Popover align="end" className="w-[260px] p-2" trigger={({ toggle }) => <button type="button" onClick={toggle} disabled={pending} className="ml-auto rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 hover:bg-subtle hover:text-ink">Change</button>}>
          {(close) => (
            <div>
              <div className="px-1 pb-1.5 text-[12px] text-ink-3">Who writes the MoM for this meeting?</div>
              <Combobox value={owner?.id ?? null} allowClear={false} options={people.map((p) => ({ value: p.id, label: p.name, icon: <Avatar name={p.name} color={p.color} size={18} /> }))}
                onChange={(v) => { if (!v) return; close(); start(async () => { const r = await changeMomOwner(meetingId, v); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Updated", "success"); router.refresh(); } }); }} />
            </div>
          )}
        </Popover>
      )}
    </span>
  );
}

export function NudgeButton({ meetingId, ownerName }: { meetingId: string; ownerName: string }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await nudgeMomOwner(meetingId); if (!r.ok) toast(r.error, "error"); else { toast(`Reminder sent to ${ownerName}`, "success"); router.refresh(); } })}>
      <BellRing size={13} />Nudge {ownerName}
    </Button>
  );
}

export function PrepEditor({ meetingId, agenda, prep, canEdit }: { meetingId: string; agenda: string | null; prep: string | null; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [a, setA] = useState(agenda ?? "");
  const [p, setP] = useState(prep ?? "");
  const [pending, start] = useTransition();
  if (!editing) {
    if (!agenda && !prep) {
      return canEdit ? (
        <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-left text-[13px] text-ink-3 hover:border-ink-4 hover:text-ink">
          <Pencil size={13} />Add an agenda or prep notes for attendees
        </button>
      ) : <p className="text-[13px] text-ink-4">No agenda shared.</p>;
    }
    return (
      <div className="group relative space-y-3">
        {agenda && <div><div className="eyebrow mb-1">Agenda</div><p className="whitespace-pre-line text-[13px] leading-[1.6] text-ink-2">{agenda}</p></div>}
        {prep && <div><div className="eyebrow mb-1">Prep notes</div><p className="whitespace-pre-line text-[13px] leading-[1.6] text-ink-2">{prep}</p></div>}
        {canEdit && <button type="button" onClick={() => setEditing(true)} className="absolute right-0 top-0 rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 opacity-0 transition-opacity hover:bg-subtle hover:text-ink group-hover:opacity-100">Edit</button>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div><span className="label">Agenda</span><textarea className="field min-h-[80px] resize-y" value={a} onChange={(e) => setA(e.target.value)} placeholder={"1. …\n2. …"} /></div>
      <div><span className="label">Prep notes</span><textarea className="field min-h-[64px] resize-y" value={p} onChange={(e) => setP(e.target.value)} placeholder="What attendees should look at before the meeting" /></div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={pending} onClick={() => start(async () => { const r = await updatePrep(meetingId, a, p); if (!r.ok) toast(r.error, "error"); else { setEditing(false); toast("Saved", "success"); router.refresh(); } })}>Save</Button>
      </div>
    </div>
  );
}
