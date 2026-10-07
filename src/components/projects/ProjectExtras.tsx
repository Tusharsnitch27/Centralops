"use client";
import { useState } from "react";
import { ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Combobox, Modal, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { PRIORITY, type Priority } from "@/lib/meta";
import { addAttachmentLink, addProjectTask, removeAttachment } from "@/server/projects/actions";
import { DateInput, FieldRow, useAction } from "./form";

/** Add a task to a project (goes through the task core → journey, notifications). */
export function AddProjectTask({ projectId, people, teams, milestones, variant = "secondary" }: { projectId: string; people: Option[]; teams: Option[]; milestones: Option[]; variant?: "primary" | "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: "", owner: null as string | null, team: null as string | null, due: "", priority: "medium" as Priority, milestone: null as string | null });
  const [pending, run] = useAction();
  const close = () => { setOpen(false); setV({ title: "", owner: null, team: null, due: "", priority: "medium", milestone: null }); };
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}><Plus size={14} />Add task</Button>
      <Modal open={open} onClose={close} width={520} title="Add task to project"
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={pending || !v.title.trim()} onClick={() => run(() => addProjectTask(projectId, { title: v.title, ownerId: v.owner, ownerTeamId: v.team, dueDate: v.due || null, priority: v.priority, milestoneId: v.milestone }), { onOk: close })}>
            {pending ? "Adding…" : "Add task"}</Button></>}>
        <div className="space-y-3.5">
          <Field label="Task"><input autoFocus className="field" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Raise PO for 3 additional RFID handhelds" /></Field>
          <FieldRow>
            <Field label="Owner"><Combobox options={people} value={v.owner} onChange={(x) => setV({ ...v, owner: x, team: x ? null : v.team })} placeholder="Person" /></Field>
            <Field label="…or team"><Combobox options={teams} value={v.team} onChange={(x) => setV({ ...v, team: x, owner: x ? null : v.owner })} placeholder="Team" /></Field>
          </FieldRow>
          <FieldRow>
            <Field label="Due"><DateInput value={v.due} onChange={(x) => setV({ ...v, due: x })} /></Field>
            <Field label="Priority">
              <select className="field" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as Priority })}>
                {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
              </select>
            </Field>
          </FieldRow>
          {milestones.length > 0 && <Field label="Milestone"><Combobox options={milestones} value={v.milestone} onChange={(x) => setV({ ...v, milestone: x })} placeholder="Not linked" /></Field>}
        </div>
      </Modal>
    </>
  );
}

export interface FileLink { id: string; name: string; url: string | null; created_at: string; uploaded_by_name: string | null }

/** Files as links (Drive / SharePoint / Sheets). */
export function FileLinks({ entityType, entityId, files, editable }: { entityType: "project" | "program"; entityId: string; files: FileLink[]; editable: boolean }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pending, run] = useAction();
  const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
  return (
    <div>
      {files.length ? (
        <ul className="divide-y divide-line/70">
          {files.map((f) => (
            <li key={f.id} className="group flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-3"><Link2 size={14} /></span>
              <div className="min-w-0 flex-1">
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[13.5px] font-medium text-ink hover:underline">{f.name}<ExternalLink size={11} className="text-ink-4" /></a>
                <div className="text-[12px] text-ink-3">{host(f.url)}{f.uploaded_by_name ? ` · added by ${f.uploaded_by_name}` : ""}</div>
              </div>
              {editable && <button type="button" onClick={() => run(() => removeAttachment(f.id))} className="rounded p-1 text-ink-4 opacity-0 hover:bg-bad-soft hover:text-bad group-hover:opacity-100" aria-label="Remove link"><Trash2 size={13} /></button>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-subtle text-ink-3"><Link2 size={17} /></div>
          <div className="text-[14px] font-medium text-ink">No files linked</div>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-3">Link the plan, trackers and vendor documents so the project has one source of truth.</p>
        </div>
      )}
      {editable && (
        <form className={cn("flex flex-wrap items-center gap-2 border-t border-line px-4 py-3")} onSubmit={(e) => { e.preventDefault(); run(() => addAttachmentLink(entityType, entityId, name, url), { onOk: () => { setName(""); setUrl(""); } }); }}>
          <input className="field h-8 w-[200px] py-1 text-[12.5px]" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="field h-8 min-w-[240px] flex-1 py-1 text-[12.5px]" placeholder="https://docs.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="submit" size="sm" disabled={pending || !url.trim()}>Add link</Button>
        </form>
      )}
    </div>
  );
}
