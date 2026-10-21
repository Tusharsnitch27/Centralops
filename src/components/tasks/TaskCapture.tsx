"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Lightbulb, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Combobox, useToast } from "@/components/ui/client";
import { refineTask, saveCapturedTask } from "@/server/tasks/capture-actions";
import { fmtDate, today } from "@/lib/dates";
import type { Priority, TaskDraft } from "@/lib/taskDraft";

interface PersonOpt { id: string; name: string; title: string | null }

/** Write a task in plain words → get a sharper version with prompts for the missing details → add it (or skip the details). */
export function TaskCapture({ people, meId }: { people: PersonOpt[]; meId: string }) {
  const [text, setText] = useState("");
  const [d, setD] = useState<TaskDraft | null>(null);
  const [thinking, startThink] = useTransition();
  const [saving, startSave] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refine = () => {
    if (!text.trim() || thinking) return;
    startThink(async () => {
      const r = await refineTask(text);
      if (r.ok && r.data) setD(r.data); else if (!r.ok) toast(r.error, "error");
    });
  };
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const reset = () => { setD(null); setText(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const save = (skip: boolean) => d && startSave(async () => {
    const r = await saveCapturedTask(skip
      ? { title: d.title, dueDate: d.dueDate, ownerId: d.ownerId, priority: d.priority, engine: d.engine }
      : { title: d.title, details: d.details, outcome: d.outcome, nextStep: d.nextStep, dueDate: d.dueDate, ownerId: d.ownerId, priority: d.priority, engine: d.engine });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(skip ? "Task added" : "Task added with details", "success");
    reset();
    router.refresh();
  });

  return (
    <div className="card overflow-hidden">
      {/* 1 · write it the way you think it */}
      <div className="flex items-start gap-2 p-3 md:p-4">
        <textarea ref={inputRef} value={text} rows={1} disabled={!!d}
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); refine(); } }}
          placeholder="Write a task… e.g. Freebie addition of perfumes into catalog by end of this week"
          className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[14px] text-ink outline-none placeholder:text-ink-4 disabled:text-ink-3" />
        {!d && (
          <Button variant="primary" size="md" disabled={!text.trim() || thinking} onClick={refine}>
            {thinking ? <><Sparkles size={14} className="animate-pulse" />Thinking…</> : <>Add<CornerDownLeft size={13} className="opacity-60" /></>}
          </Button>
        )}
        {d && <button onClick={reset} title="Discard" className="rounded-md p-1.5 text-ink-4 hover:bg-subtle hover:text-ink"><X size={15} /></button>}
      </div>

      {/* 2 · make it precise (all optional) */}
      {d && (
        <div className="space-y-4 border-t border-line bg-subtle/40 p-3 md:p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
            <Sparkles size={12} className="text-accent" /> {d.engine === "claude" ? "Sharpened by AI — edit anything" : "Make it precise — all optional"}
          </div>

          <label className="block">
            <span className="label">Task</span>
            <input className="field font-medium" value={d.title} onChange={(e) => set("title", e.target.value)} />
          </label>

          <label className="block">
            <span className="label">Additional details?</span>
            <textarea className="field min-h-[64px]" value={d.details} onChange={(e) => set("details", e.target.value)}
              placeholder={d.questions[0] ?? "Scope, links, specifics…"} />
            {d.questions.length > 1 && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {d.questions.slice(1).map((q) => <span key={q} className="rounded-md bg-surface px-2 py-0.5 text-[11.5px] text-ink-3 ring-1 ring-line">{q}</span>)}
              </span>
            )}
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Due date?</span>
              <input type="date" className="field" min={today()} value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
              {d.dueDate && <span className="mt-1 block text-[11.5px] text-ink-4">{fmtDate(d.dueDate, { dow: true })}</span>}
            </label>
            <div>
              <span className="label">POC</span>
              <Combobox value={d.ownerId ?? meId} onChange={(v) => set("ownerId", v)} allowClear={false}
                options={people.map((p) => ({ value: p.id, label: p.id === meId ? `${p.name} (me)` : p.name, hint: p.title ?? undefined }))} />
              {!d.ownerId && d.ownerName && <span className="mt-1 block text-[11.5px] text-warn">“{d.ownerName}” isn’t in the directory</span>}
            </div>
            <label className="block">
              <span className="label">Priority</span>
              <select className="field" value={d.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Done when</span>
              <input className="field" value={d.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="What does finished look like?" />
            </label>
            <label className="block">
              <span className="label">First step</span>
              <input className="field" value={d.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="The very next action" />
            </label>
          </div>

          {d.tips.length > 0 && (
            <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4"><Lightbulb size={12} /> To make it count</div>
              <ul className="space-y-1 text-[12.5px] text-ink-2">{d.tips.map((t) => <li key={t}>· {t}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => save(true)}>Skip details, just add</Button>
            <Button variant="primary" disabled={saving || !d.title.trim()} onClick={() => save(false)}>{saving ? "Adding…" : <>Add task <ArrowRight size={13} /></>}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
