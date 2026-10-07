"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Avatar, Button, Field } from "@/components/ui";
import { Combobox, Modal, useToast } from "@/components/ui/client";
import { today } from "@/lib/dates";
import { createMeeting } from "@/server/meetings/actions";

export interface MeetingOptions {
  people: { id: string; name: string; color: string | null; title?: string | null }[];
  reviews: { id: string; name: string; mom_owner_id: string | null; project_id: string | null; program_id: string | null }[];
  projects: { id: string; name: string; code: string | null; program_id: string | null }[];
  programs: { id: string; name: string; code: string | null }[];
}

/** Multi-select built on Combobox: chips + "add person". */
export function PeoplePicker({ people, value, onChange, placeholder = "Add people…" }: { people: MeetingOptions["people"]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [k, setK] = useState(0);
  const chosen = value.map((id) => people.find((p) => p.id === id)).filter(Boolean) as MeetingOptions["people"];
  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((p) => (
            <span key={p.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-subtle pl-1 pr-1.5 text-[12.5px] text-ink-2">
              <Avatar name={p.name} color={p.color} size={20} />{p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((v) => v !== p.id))} className="rounded-full p-0.5 text-ink-4 hover:bg-muted hover:text-ink"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <Combobox key={k} value={null} allowClear={false} placeholder={placeholder}
        options={people.filter((p) => !value.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined, icon: <Avatar name={p.name} color={p.color} size={18} /> }))}
        onChange={(v) => { if (v) onChange([...value, v]); setK((x) => x + 1); }} />
    </div>
  );
}

export function NewMeetingButton({ options, me, joinedAt, variant = "primary" }: { options: MeetingOptions; me: string; joinedAt: string; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}><Plus size={14} />New meeting</Button>
      {open && <NewMeetingModal options={options} me={me} joinedAt={joinedAt} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewMeetingModal({ options, me, joinedAt, onClose }: { options: MeetingOptions; me: string; joinedAt: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [startT, setStartT] = useState(() => { const h = Math.min(20, new Date().getHours() + 1); return `${String(h).padStart(2, "0")}:00`; });
  const [endT, setEndT] = useState(() => { const h = Math.min(21, new Date().getHours() + 1); return `${String(h).padStart(2, "0")}:30`; });
  const [attendees, setAttendees] = useState<string[]>([me]);
  const [momOwner, setMomOwner] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [agenda, setAgenda] = useState("");
  const review = options.reviews.find((r) => r.id === reviewId);
  const effectiveOwner = momOwner ?? review?.mom_owner_id ?? me;
  const ownerName = options.people.find((p) => p.id === effectiveOwner)?.name;
  const peopleOpts = useMemo(() => options.people.map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined, icon: <Avatar name={p.name} color={p.color} size={18} /> })), [options.people]);

  const submit = () => start(async () => {
    const r = await createMeeting({ title, date, start: startT, end: endT, attendeeIds: attendees, momOwnerId: momOwner, reviewId, projectId, programId, agenda: agenda || null });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Meeting created", "success");
    onClose();
    router.push(`/meetings/${r.data!.id}`);
  });

  return (
    <Modal open onClose={onClose} title="New meeting" description="For meetings that aren't on your calendar. The MoM owner writes the minutes afterwards." width={600}
      footer={<>
        <span className="mr-auto text-[12px] text-ink-3">MoM by <span className="font-medium text-ink-2">{ownerName ?? "—"}</span></span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={pending || !title.trim()}>{pending ? "Creating…" : "Create meeting"}</Button>
      </>}>
      <div className="space-y-4 [&_div.inline-block]:block">
        <Field label="Title">
          <input autoFocus className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Packaging vendor review" onKeyDown={(e) => e.key === "Enter" && title.trim() && submit()} />
        </Field>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
          <Field label="Date"><input type="date" className="field" min={joinedAt} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Starts"><input type="time" className="field" value={startT} onChange={(e) => setStartT(e.target.value)} /></Field>
          <Field label="Ends"><input type="time" className="field" value={endT} onChange={(e) => setEndT(e.target.value)} /></Field>
        </div>
        <div>
          <span className="label">Attendees</span>
          <PeoplePicker people={options.people} value={attendees} onChange={setAttendees} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">Review series</span>
            <Combobox value={reviewId} placeholder="Not part of a review" onChange={(v) => {
              setReviewId(v);
              const r = options.reviews.find((x) => x.id === v);
              if (r?.project_id && !projectId) setProjectId(r.project_id);
              if (r?.program_id && !programId) setProgramId(r.program_id);
            }} options={options.reviews.map((r) => ({ value: r.id, label: r.name }))} />
          </div>
          <div>
            <span className="label">MoM owner</span>
            <Combobox value={momOwner} placeholder={review?.mom_owner_id ? `${ownerName} (review default)` : "You"} onChange={setMomOwner} options={peopleOpts} />
          </div>
          <div>
            <span className="label">Project</span>
            <Combobox value={projectId} placeholder="None" onChange={(v) => { setProjectId(v); const p = options.projects.find((x) => x.id === v); if (p?.program_id) setProgramId(p.program_id); }}
              options={options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} />
          </div>
          <div>
            <span className="label">Program</span>
            <Combobox value={programId} placeholder="None" onChange={setProgramId} options={options.programs.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} />
          </div>
        </div>
        <Field label="Agenda" hint="Shown to attendees as the pre-read.">
          <textarea className="field min-h-[84px] resize-y" value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder={"1. Where we are\n2. What's blocked\n3. Decisions needed"} />
        </Field>
      </div>
    </Modal>
  );
}
