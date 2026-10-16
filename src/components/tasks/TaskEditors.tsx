"use client";
// Inline editors for the task detail page: title, description, properties sidebar, tags, dependencies, links.
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarDays, Link2, Plus, Search, X, ExternalLink } from "lucide-react";
import { Combobox, Popover, useToast, type Option } from "@/components/ui/client";
import { Avatar, Button, Dot, PriorityIcon } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HEALTH, PRIORITY, TASK_STATUS, type Health, type Priority, type TaskStatus, type Tone } from "@/lib/meta";
import { patchTask } from "@/server/tasks/actions";
import {
  addTaskDependency, addTaskLink, addTaskTag, removeTaskDependency, removeTaskLink, removeTaskTag, searchTasksForPicker, setTaskProgram, setTaskRequester,
} from "@/server/tasks/collab-actions";
import type { TaskPatch } from "@/server/tasks/core";
import { fmtDate, relDay, today } from "@/lib/dates";

type R = { ok: true } | { ok: false; error: string };
function useAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<R | { ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast((r as { error: string }).error, "error");
      else if (success) toast(success, "success");
    });
  return { pending, run };
}

/* ---------- Title ---------- */
export function TitleEditor({ id, title, readOnly }: { id: string; title: string; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(title);
  const { run } = useAction();
  useEffect(() => setVal(title), [title]);
  const save = () => {
    setEditing(false);
    if (val.trim() && val.trim() !== title) run(() => patchTask(id, { title: val.trim() }));
    else setVal(title);
  };
  if (editing)
    return (
      <textarea autoFocus value={val} rows={1} onChange={(e) => setVal(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { setVal(title); setEditing(false); } }}
        ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
        className="-mx-2 w-[calc(100%+16px)] resize-none rounded-lg bg-subtle px-2 py-1 font-serif text-[22px] leading-[1.2] tracking-[-0.01em] text-ink outline-none ring-1 ring-line-strong" />
    );
  return (
    <h1 onClick={() => !readOnly && setEditing(true)}
      className={cn("-mx-2 rounded-lg px-2 py-1 font-serif text-[22px] leading-[1.2] tracking-[-0.01em] text-ink", !readOnly && "cursor-text hover:bg-subtle/70")}>
      {val}
    </h1>
  );
}

/* ---------- Description ---------- */
export function DescriptionEditor({ id, description, readOnly }: { id: string; description: string | null; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(description ?? "");
  const { pending, run } = useAction();
  useEffect(() => setVal(description ?? ""), [description]);
  if (editing)
    return (
      <div>
        <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} rows={5} placeholder="Add context, acceptance criteria, links…"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { setEditing(false); run(() => patchTask(id, { description: val.trim() || null })); } if (e.key === "Escape") { setVal(description ?? ""); setEditing(false); } }}
          className="field min-h-28 resize-y text-[13px] leading-relaxed" />
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="mr-auto text-[11.5px] text-ink-4">⌘ Enter to save</span>
          <Button size="xs" variant="ghost" onClick={() => { setVal(description ?? ""); setEditing(false); }}>Cancel</Button>
          <Button size="xs" variant="primary" disabled={pending} onClick={() => { setEditing(false); run(() => patchTask(id, { description: val.trim() || null })); }}>Save</Button>
        </div>
      </div>
    );
  return (
    <div onClick={() => !readOnly && setEditing(true)}
      className={cn("-mx-2 whitespace-pre-wrap rounded-lg px-2 py-1.5 text-[13px] leading-relaxed", val ? "text-ink-2" : "text-ink-4", !readOnly && "cursor-text hover:bg-subtle/70")}>
      {val || (readOnly ? "No description." : "Add a description…")}
    </div>
  );
}

/* ---------- Properties ---------- */
export interface PropsTask {
  id: string; status: TaskStatus; health: Health; priority: Priority; owner_id: string | null; owner_team_id: string | null; requester_id: string | null;
  due_date: string | null; original_due_date: string | null; project_id: string | null; program_id: string | null; program_name: string | null;
  waiting_on_id: string | null; next_step: string | null; blocker: string | null;
}
export interface PickerOptions {
  people: { id: string; name: string; color: string | null; title: string | null }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; code: string | null }[];
  programs: { id: string; name: string; code: string | null }[];
}

const ghost = "h-8 border-transparent bg-transparent px-2 py-1 text-[13px] shadow-none hover:bg-subtle focus:ring-0";
const toneDot = (t: string) => <Dot tone={t as Tone} />;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2">
      <div className="w-[92px] shrink-0 text-[12.5px] text-ink-3">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TaskProperties({ t, options, readOnly }: { t: PropsTask; options: PickerOptions; readOnly?: boolean }) {
  const { pending, run } = useAction();
  const patch = (p: TaskPatch, msg?: string) => run(() => patchTask(t.id, p), msg);
  const people: Option[] = options.people.map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined, icon: <Avatar name={p.name} color={p.color} size={18} /> }));
  const owners: Option[] = [
    ...people,
    ...options.teams.map((tm) => ({ value: `team:${tm.id}`, label: `${tm.name}`, hint: "Team", icon: <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-muted text-[9.5px] font-semibold text-ink-2">{tm.name.slice(0, 2).toUpperCase()}</span> })),
  ];
  const ownerValue = t.owner_id ?? (t.owner_team_id ? `team:${t.owner_team_id}` : null);
  const statusOpts: Option[] = (Object.keys(TASK_STATUS) as TaskStatus[]).map((k) => ({ value: k, label: TASK_STATUS[k].label, icon: toneDot(TASK_STATUS[k].tone) }));
  const healthOpts: Option[] = (Object.keys(HEALTH) as Health[]).map((k) => ({ value: k, label: HEALTH[k].label, icon: toneDot(HEALTH[k].tone) }));
  const prioOpts: Option[] = (Object.keys(PRIORITY) as Priority[]).map((k) => ({ value: k, label: PRIORITY[k].label, icon: <PriorityIcon priority={k} /> }));
  const projectOpts: Option[] = options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }));
  const programOpts: Option[] = options.programs.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }));
  const td = today();
  const slipped = t.original_due_date && t.due_date && t.due_date !== t.original_due_date;
  const dis = readOnly || pending;

  return (
    <div className={cn("space-y-0.5 transition-opacity", pending && "opacity-70")}>
      <Row label="Status">
        <Combobox size="sm" className={ghost} options={statusOpts} value={t.status} allowClear={false}
          onChange={(v) => v && !dis && patch({ status: v as TaskStatus }, `Moved to ${TASK_STATUS[v as TaskStatus].label}`)} />
      </Row>
      <Row label="Health">
        <Combobox size="sm" className={ghost} options={healthOpts} value={t.health} allowClear={false} onChange={(v) => v && !dis && patch({ health: v as Health })} />
      </Row>
      <Row label="Priority">
        <Combobox size="sm" className={ghost} options={prioOpts} value={t.priority} allowClear={false} onChange={(v) => v && !dis && patch({ priority: v as Priority })} />
      </Row>
      <Row label="Owner">
        <Combobox size="sm" className={ghost} options={owners} value={ownerValue} placeholder="Assign a person or team"
          onChange={(v) => {
            if (dis) return;
            if (!v) patch({ ownerId: null, ownerTeamId: null });
            else if (v.startsWith("team:")) patch({ ownerId: null, ownerTeamId: v.slice(5) }, "Assigned to team");
            else patch({ ownerId: v, ownerTeamId: null }, "Reassigned");
          }} />
      </Row>
      <Row label="Requester">
        <Combobox size="sm" className={ghost} options={people} value={t.requester_id} placeholder="Who asked for this?"
          onChange={(v) => !dis && run(() => setTaskRequester(t.id, v))} />
      </Row>
      <Row label="Due date">
        <DueDate value={t.due_date} min={td} disabled={dis} onChange={(d) => patch({ dueDate: d }, d ? `Due ${relDay(d).toLowerCase()}` : "Due date cleared")} />
        {slipped && <div className="px-2 pb-1 text-[11.5px] text-warn">Originally {fmtDate(t.original_due_date)}</div>}
      </Row>
      <Row label="Project">
        <Combobox size="sm" className={ghost} options={projectOpts} value={t.project_id} placeholder="No project" onChange={(v) => !dis && patch({ projectId: v })} />
      </Row>
      <Row label="Program">
        {t.project_id
          ? <div className="truncate px-2 text-[13px] text-ink-2" title={`${t.program_name ?? "No program"} — follows the project`}>{t.program_name ?? <span className="text-ink-4">—</span>}</div>
          : <Combobox size="sm" className={ghost} options={programOpts} value={t.program_id} placeholder="No program" onChange={(v) => !dis && run(() => setTaskProgram(t.id, v))} />}
      </Row>
      <Row label="Waiting on">
        <Combobox size="sm" className={ghost} options={people} value={t.waiting_on_id} placeholder="Nobody"
          onChange={(v) => !dis && patch(v ? { waitingOnId: v, ...(t.status === "not_started" || t.status === "in_progress" ? { status: "waiting" as TaskStatus } : {}) } : { waitingOnId: null })} />
      </Row>
      <div className="pt-2">
        <InlineText label="Next step" value={t.next_step} placeholder="What happens next?" disabled={dis} onSave={(v) => patch({ nextStep: v })} />
        <InlineText label="Blocker" value={t.blocker} placeholder="Nothing blocking" tone={t.blocker ? "red" : undefined} disabled={dis}
          onSave={(v) => patch(v && t.status !== "blocked" && t.status !== "completed" ? { blocker: v, status: "blocked" } : { blocker: v })} />
      </div>
    </div>
  );
}

function DueDate({ value, min, onChange, disabled }: { value: string | null; min: string; onChange: (v: string | null) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const overdue = value && value < min;
  return (
    <div className="relative flex items-center">
      <button type="button" disabled={disabled} onClick={() => { const el = ref.current; if (el) { try { el.showPicker(); } catch { el.focus(); } } }}
        className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-subtle", overdue ? "font-medium text-bad" : value ? "text-ink" : "text-ink-4")}>
        <CalendarDays size={14} className="text-ink-4" />
        {value ? <>{fmtDate(value, { dow: true })}<span className="text-[11.5px] font-normal text-ink-4">· {relDay(value)}</span></> : "No due date"}
      </button>
      <input ref={ref} type="date" min={min} value={value ?? ""} tabIndex={-1} aria-label="Due date"
        onChange={(e) => { const v = e.target.value || null; if (v !== value) onChange(v); }}
        className="pointer-events-none absolute inset-0 opacity-0" />
      {value && !disabled && <button type="button" onClick={() => onChange(null)} className="absolute right-1.5 rounded p-0.5 text-ink-4 hover:text-ink" aria-label="Clear due date"><X size={12} /></button>}
    </div>
  );
}

function InlineText({ label, value, placeholder, onSave, tone, disabled }: { label: string; value: string | null; placeholder: string; onSave: (v: string | null) => void; tone?: "red"; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  useEffect(() => setVal(value ?? ""), [value]);
  const save = () => { setEditing(false); const v = val.trim() || null; if (v !== (value ?? null)) onSave(v); };
  return (
    <div className="py-1">
      <div className="mb-0.5 px-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">{label}</div>
      {editing ? (
        <textarea autoFocus value={val} rows={2} onChange={(e) => setVal(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") { setVal(value ?? ""); setEditing(false); } }}
          className="field resize-none px-2 py-1.5 text-[13px]" />
      ) : (
        <button type="button" disabled={disabled} onClick={() => setEditing(true)}
          className={cn("w-full rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug hover:bg-subtle",
            tone === "red" ? "bg-bad-soft/60 text-bad hover:bg-bad-soft" : val ? "text-ink" : "text-ink-4")}>
          {val || placeholder}
        </button>
      )}
    </div>
  );
}

/* ---------- Tags ---------- */
export function TagEditor({ id, tags, suggestions, readOnly }: { id: string; tags: string[]; suggestions: string[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const { pending, run } = useAction();
  const add = (tag: string) => { if (tag.trim()) run(() => addTaskTag(id, tag)); setVal(""); setAdding(false); };
  const sugg = suggestions.filter((s) => !tags.includes(s) && s.includes(val.toLowerCase())).slice(0, 6);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-70")}>
      {tags.map((tag) => (
        <span key={tag} className="group/tag inline-flex h-6 items-center gap-1 rounded-md bg-subtle pl-2 pr-1 text-[12px] text-ink-2 ring-1 ring-inset ring-line">
          <Link href={`/tasks?view=all&tag=${encodeURIComponent(tag)}`} className="hover:text-ink">#{tag}</Link>
          {!readOnly && <button type="button" onClick={() => run(() => removeTaskTag(id, tag))} className="rounded p-0.5 text-ink-4 opacity-0 hover:text-ink group-hover/tag:opacity-100" aria-label={`Remove ${tag}`}><X size={10} /></button>}
        </span>
      ))}
      {!readOnly && (adding ? (
        <span className="relative">
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="tag" onBlur={() => setTimeout(() => { if (val.trim()) add(val); else setAdding(false); }, 120)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(val); } if (e.key === "Escape") { setVal(""); setAdding(false); } }}
            className="h-6 w-28 rounded-md border border-line-strong bg-surface px-2 text-[12px] outline-none focus:border-ink-3" />
          {sugg.length > 0 && (
            <span className="absolute left-0 top-7 z-30 flex w-40 flex-col rounded-lg border border-line bg-surface p-1 animate-rise" style={{ boxShadow: "var(--shadow-pop)" }}>
              {sugg.map((s) => <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); add(s); }} className="rounded-md px-2 py-1 text-left text-[12px] text-ink-2 hover:bg-subtle">#{s}</button>)}
            </span>
          )}
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-line-strong px-2 text-[12px] text-ink-3 hover:border-ink-4 hover:text-ink">
          <Plus size={11} /> Tag
        </button>
      ))}
      {readOnly && !tags.length && <span className="text-[12.5px] text-ink-4">No tags</span>}
    </div>
  );
}

/* ---------- Dependencies ---------- */
type DepTask = { id: string; number: number; title: string; status: TaskStatus; due_date: string | null; owner_name: string | null };
export function DependencyEditor({ id, blockedBy, blocking, readOnly }: { id: string; blockedBy: DepTask[]; blocking: DepTask[]; readOnly?: boolean }) {
  const { pending, run } = useAction();
  const openBlockers = blockedBy.filter((d) => d.status !== "completed" && d.status !== "cancelled").length;
  const list = (items: DepTask[], kind: "blocked_by" | "blocking") => items.map((d) => {
    const done = d.status === "completed" || d.status === "cancelled";
    return (
      <div key={d.id} className="group/dep flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle">
        <Dot tone={done ? "green" : (TASK_STATUS[d.status].tone as Tone)} />
        <Link href={`/tasks/${d.id}`} className={cn("min-w-0 flex-1 truncate text-[12.5px]", done ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}>
          <span className="mr-1.5 font-mono text-[10.5px] text-ink-4">CO-{d.number}</span>{d.title}
        </Link>
        {!readOnly && <button type="button" onClick={() => run(() => removeTaskDependency(id, d.id, kind))} className="rounded p-0.5 text-ink-4 opacity-0 hover:text-ink group-hover/dep:opacity-100" aria-label="Remove dependency"><X size={12} /></button>}
      </div>
    );
  });
  return (
    <div className={cn("space-y-3", pending && "opacity-70")}>
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">Blocked by{openBlockers > 0 && <span className="ml-1.5 normal-case tracking-normal text-bad">{openBlockers} open</span>}</span>
          {!readOnly && <TaskPicker exclude={id} label="Add blocker" onPick={(o) => run(() => addTaskDependency(id, o, "blocked_by"), "Dependency added")} />}
        </div>
        {blockedBy.length ? list(blockedBy, "blocked_by") : <div className="px-2 text-[12.5px] text-ink-4">Nothing</div>}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-4">Blocking</span>
          {!readOnly && <TaskPicker exclude={id} label="Add blocked task" onPick={(o) => run(() => addTaskDependency(id, o, "blocking"), "Dependency added")} />}
        </div>
        {blocking.length ? list(blocking, "blocking") : <div className="px-2 text-[12.5px] text-ink-4">Nothing</div>}
      </div>
    </div>
  );
}

function TaskPicker({ exclude, label, onPick }: { exclude: string; label: string; onPick: (id: string) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; number: number; title: string; status: TaskStatus }[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const h = setTimeout(async () => { setResults(await searchTasksForPicker(term, exclude)); setLoading(false); }, 200);
    return () => clearTimeout(h);
  }, [term, exclude]);
  return (
    <Popover align="end" className="w-80" trigger={({ toggle }) => (
      <button type="button" onClick={toggle} title={label} aria-label={label} className="rounded-md p-1 text-ink-4 hover:bg-subtle hover:text-ink"><Plus size={13} /></button>
    )}>
      {(close) => (
        <div>
          <div className="relative mb-1">
            <Search size={13} className="absolute left-2.5 top-2 text-ink-4" />
            <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search tasks or CO-123…"
              className="w-full rounded-lg border-0 bg-subtle py-1.5 pl-8 pr-2.5 text-[13px] outline-none placeholder:text-ink-4" />
          </div>
          <div className="max-h-64 overflow-y-auto scroll-thin">
            {results.map((r) => (
              <button key={r.id} type="button" onClick={() => { onPick(r.id); setTerm(""); close(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-subtle hover:text-ink">
                <Dot tone={TASK_STATUS[r.status].tone as Tone} />
                <span className="font-mono text-[10.5px] text-ink-4">CO-{r.number}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
              </button>
            ))}
            {term.trim().length >= 2 && !loading && !results.length && <div className="px-2 py-3 text-center text-[12.5px] text-ink-4">No matching tasks</div>}
            {term.trim().length < 2 && <div className="px-2 py-3 text-center text-[12px] text-ink-4">Type at least 2 characters</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}

/* ---------- Links (attachments) ---------- */
export function LinkList({ id, links, readOnly }: { id: string; links: { id: string; name: string; url: string | null; uploaded_by_name: string | null }[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const { pending, run } = useAction();
  const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
  return (
    <div className={cn(pending && "opacity-70")}>
      {links.map((l) => (
        <div key={l.id} className="group/link flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-3"><Link2 size={12} /></span>
          <a href={l.url ?? "#"} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] text-ink group-hover/link:underline">{l.name}</div>
            <div className="truncate text-[11px] text-ink-4">{host(l.url)}{l.uploaded_by_name && ` · ${l.uploaded_by_name}`}</div>
          </a>
          <ExternalLink size={12} className="text-ink-4 opacity-0 group-hover/link:opacity-100" />
          {!readOnly && <button type="button" onClick={() => run(() => removeTaskLink(id, l.id))} className="rounded p-0.5 text-ink-4 opacity-0 hover:text-ink group-hover/link:opacity-100" aria-label="Remove link"><X size={12} /></button>}
        </div>
      ))}
      {!links.length && !adding && <div className="px-2 text-[12.5px] text-ink-4">No links yet — add the sheet, doc or deck this task depends on.</div>}
      {!readOnly && (adding ? (
        <form className="mt-2 space-y-1.5 px-2" onSubmit={(e) => { e.preventDefault(); run(() => addTaskLink(id, name, url), "Link added"); setName(""); setUrl(""); setAdding(false); }}>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/…" className="field h-8 py-1 text-[12.5px]" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="field h-8 py-1 text-[12.5px]" />
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="xs" variant="primary" type="submit" disabled={!url.trim()}>Add link</Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink">
          <Plus size={12} /> Add link
        </button>
      ))}
    </div>
  );
}

