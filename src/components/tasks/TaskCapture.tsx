"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CornerDownLeft, Flag, Lightbulb, Link2, Plus, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { refineTask, saveCapturedTask } from "@/server/tasks/capture-actions";
import { fmtDate, today } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { Priority, TaskDraft } from "@/lib/taskDraft";
import { parseQuick } from "@/lib/quickParse";
import { findPoc } from "@/lib/pocFind";
import { extractLinks, linkLabel } from "@/lib/links";

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
  // live auto-detect while typing (instant, in the browser)
  const live = useMemo(() => {
    if (text.trim().length < 6) return null;
    const { text: noUrl, links } = extractLinks(text);
    const p = parseQuick(noUrl);
    return { due: p.due ?? null, poc: findPoc(noUrl, people), links, priority: p.priority ?? (/\b(urgent|asap|critical)\b/i.test(text) ? "urgent" : null) };
  }, [text, people]);

  const refine = () => {
    if (!text.trim() || thinking) return;
    startThink(async () => {
      const r = await refineTask(text);
      if (r.ok && r.data) setD(r.data); else if (!r.ok) toast(r.error, "error");
    });
  };
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const sharpen = () => d && startThink(async () => {
    const r = await refineTask(d.raw, { raw: d.raw, title: d.title, details: d.details, pocName: d.pocName, dueDate: d.dueDate, startDate: d.startDate, links: d.links });
    if (!r.ok || !r.data) { if (!r.ok) toast(r.error, "error"); return; }
    const n = r.data;
    // keep what the user set explicitly; take the sharper wording and suggestions
    setD((x) => x && { ...n, pocName: x.pocName, dueDate: x.dueDate, startDate: x.startDate, dueLabel: x.dueLabel, links: x.links, outcome: n.outcome || x.outcome, nextStep: n.nextStep || x.nextStep });
  });
  const reset = () => { setD(null); setText(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const save = (skip: boolean) => d && startSave(async () => {
    const r = await saveCapturedTask(skip
      ? { title: d.title, dueDate: d.dueDate, startDate: d.startDate, pocName: d.pocName, priority: d.priority, links: d.links, engine: d.engine }
      : { title: d.title, details: d.details, outcome: d.outcome, nextStep: d.nextStep, dueDate: d.dueDate, startDate: d.startDate, pocName: d.pocName, priority: d.priority, links: d.links, engine: d.engine });
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
          placeholder="Write a task — what needs to happen, by when, and with whom…"
          className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[14px] text-ink outline-none placeholder:text-ink-4 disabled:text-ink-3" />
        {!d && (
          <Button variant="primary" size="md" disabled={!text.trim() || thinking} onClick={refine}>
            {thinking ? <><Sparkles size={14} className="animate-pulse" />Thinking…</> : <>Add<CornerDownLeft size={13} className="opacity-60" /></>}
          </Button>
        )}
        {d && <button onClick={reset} title="Discard" className="rounded-md p-1.5 text-ink-4 hover:bg-subtle hover:text-ink"><X size={15} /></button>}
      </div>
      {!d && live && (live.due || live.poc || live.links.length || live.priority) && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5 px-3 pb-3 text-[11.5px] md:px-4">
          <span className="flex items-center gap-1 text-ink-4"><Sparkles size={11} />Auto-filling</span>
          {live.due && <span className="flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-ink-2"><CalendarDays size={11} />{fmtDate(live.due, { dow: true })}</span>}
          {live.poc && <span className="flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-ink-2"><User size={11} />{live.poc.name}{!live.poc.personId && <span className="text-ink-4">· outside team</span>}</span>}
          {live.priority && <span className="flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-ink-2"><Flag size={11} />{live.priority}</span>}
          {live.links.length > 0 && <span className="flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-ink-2"><Link2 size={11} />{live.links.length} link{live.links.length > 1 ? "s" : ""}</span>}
          {!live.due && <span className="text-ink-4">· add a date (e.g. “by Friday”) — it’s required</span>}
        </div>
      )}

      {/* 2 · make it precise (all optional) */}
      {d && (
        <div className="space-y-4 border-t border-line bg-subtle/40 p-3 md:p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">
            <Sparkles size={12} className="text-accent" /> {d.engine === "claude" ? "Sharpened by AI — edit anything" : "Make it precise — all optional"}
          </div>

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between">
              <span className="label mb-0">Task</span>
              <button type="button" onClick={sharpen} disabled={thinking} title="Re-write the task and details using everything entered so far"
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-60">
                <Sparkles size={12} className={thinking ? "animate-pulse" : undefined} />{thinking ? "Sharpening…" : "Sharpen"}
              </button>
            </span>
            <input className="field font-medium" value={d.title} onChange={(e) => set("title", e.target.value)} />
          </label>

          <label className="block">
            <span className="label">Additional details?</span>
            <textarea className="field min-h-[76px]" rows={Math.min(6, Math.max(3, d.details.split("\n").length))} value={d.details} onChange={(e) => set("details", e.target.value)}
              placeholder={d.questions[0] ?? "Scope, links, specifics…"} />
            {d.questions.length > 1 && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {d.questions.slice(1).map((q) => <span key={q} className="rounded-md bg-surface px-2 py-0.5 text-[11.5px] text-ink-3 ring-1 ring-line">{q}</span>)}
              </span>
            )}
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="label">Due date <span className="text-bad">*</span></span>
              <input type="date" required className={cn("field", !d.dueDate && "border-bad/50")} min={d.startDate ?? today()} value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
              <span className={cn("mt-1 block text-[11.5px]", d.dueDate ? "text-ink-4" : "text-bad")}>{d.dueDate ? fmtDate(d.dueDate, { dow: true }) : "Required — you can change it later"}</span>
            </label>
            <label className="block">
              <span className="label">Start date <span className="font-normal text-ink-4">(optional)</span></span>
              <input type="date" className="field" min={today()} max={d.dueDate ?? undefined} value={d.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
              <span className="mt-1 block text-[11.5px] text-ink-4">{d.startDate && d.startDate > today() ? `Hidden until ${fmtDate(d.startDate, { dow: true })}` : "Blank = starts now"}</span>
            </label>
            <label className="block">
              <span className="label">POC</span>
              <input className="field" list="poc-people" value={d.pocName} onChange={(e) => set("pocName", e.target.value)} placeholder="Anyone — name, team or vendor" />
              <datalist id="poc-people">{people.filter((p) => p.id !== meId).map((p) => <option key={p.id} value={p.name}>{p.title ?? ""}</option>)}</datalist>
              <span className="mt-1 block text-[11.5px] text-ink-4">{pocHint(d.pocName, people, meId)}</span>
            </label>
            <label className="block">
              <span className="label">Priority</span>
              <select className="field" value={d.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Done when {d.outcome && <AutoTag ai={d.engine === "claude"} />}</span>
              <input className="field" value={d.outcome} onChange={(e) => set("outcome", e.target.value)} placeholder="What does finished look like?" />
            </label>
            <label className="block">
              <span className="label">First step {d.nextStep && <AutoTag ai={d.engine === "claude"} />}</span>
              <input className="field" value={d.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="The very next action" />
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between"><span className="label mb-0">Links</span>
              <button type="button" onClick={() => set("links", [...d.links, { url: "", label: "" }])} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Plus size={12} />Add link</button>
            </div>
            {d.links.length ? (
              <div className="space-y-1.5">
                {d.links.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_150px_28px] gap-1.5">
                    <input className="field h-8 py-1 text-[12.5px]" placeholder="https://…" value={l.url}
                      onChange={(e) => set("links", d.links.map((x, j) => (j === i ? { url: e.target.value, label: x.label && x.label !== linkLabel(x.url) ? x.label : linkLabel(e.target.value) } : x)))} />
                    <input className="field h-8 py-1 text-[12.5px]" placeholder="Label" value={l.label} onChange={(e) => set("links", d.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <button type="button" onClick={() => set("links", d.links.filter((_, j) => j !== i))} className="flex items-center justify-center rounded-md text-ink-4 hover:bg-subtle hover:text-bad" aria-label="Remove link"><X size={13} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12px] text-ink-4">Sheets, docs, dashboards — paste URLs in the task text or add them here.</p>}
          </div>

          {d.tips.length > 0 && (
            <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4"><Lightbulb size={12} /> To make it count</div>
              <ul className="space-y-1 text-[12.5px] text-ink-2">{d.tips.map((t) => <li key={t}>· {t}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" disabled={saving || !d.dueDate} onClick={() => save(true)}>Skip details, just add</Button>
            <Button variant="primary" disabled={saving || !d.title.trim() || !d.dueDate} onClick={() => save(false)}>{saving ? "Adding…" : <>Add task <ArrowRight size={13} /></>}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Directory match shown under the POC box (same rule as the server: full name, or a first name only one person has). */
function pocHint(name: string, people: PersonOpt[], meId: string) {
  const n = name.trim().toLowerCase();
  if (!n) return "Blank = you";
  const hit = people.find((p) => p.name.toLowerCase() === n) ?? (/\s/.test(n) ? undefined : (() => { const f = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n); return f.length === 1 ? f[0] : undefined; })());
  if (hit) return hit.id === meId ? "You" : `${hit.name} — in the directory, they’ll own it`;
  return "Not in the directory — you own it, noted as POC";
}

const AutoTag = ({ ai }: { ai: boolean }) => <span className="ml-1 rounded bg-accent-soft px-1 py-px text-[10px] font-medium text-accent-ink">{ai ? "AI" : "auto"}</span>;
