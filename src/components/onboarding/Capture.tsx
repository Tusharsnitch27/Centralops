"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, CalendarSync, CircleCheck, Hourglass, Plus, Repeat, Sparkles, Trash2 } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { Combobox, useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { today } from "@/lib/dates";
import { commitCapture, finishOnboarding, structureDump } from "@/server/onboarding/actions";
import type { CaptureItem, CaptureKind } from "@/server/onboarding/parse";

const KINDS: Partial<Record<CaptureKind, { label: string; icon: React.ReactNode; hint: string }>> = {
  task: { label: "Task", icon: <CircleCheck size={13} />, hint: "A concrete action" },
  review: { label: "Recurring meeting", icon: <Repeat size={13} />, hint: "A meeting you run regularly" },
  followup: { label: "Waiting on", icon: <Hourglass size={13} />, hint: "Someone owes you something" },
};

const EXAMPLE = `Get RFID wave 1 store list from Nitin by 15 Nov
Weekly S&OP review every Tuesday, Shikha writes the MoM
Waiting on Faisal for the AP ledger export
Collect Q3 projections from all function owners by 20 Oct !high
Logistics cost review weekly with Iqbal, Vaishnavi writes MoM
Chase Liza for Myntra SOR volumes tomorrow
Review North warehouse Wi-Fi coverage with Manish fri`;

interface Opt { people: { id: string; name: string; title: string | null; color: string | null }[]; teams: { id: string; name: string }[]; projects: { id: string; name: string; code: string | null }[] }

export function Capture({ options, name }: { options: Opt; name: string }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<CaptureItem[] | null>(null);
  const [engine, setEngine] = useState<string>("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const structure = () => start(async () => {
    const r = await structureDump(text);
    if (!r.ok) return toast(r.error, "error");
    setItems(r.data!.items); setEngine(r.data!.engine);
  });
  const commit = () => start(async () => {
    const r = await commitCapture(items ?? []);
    if (!r.ok) return toast(r.error, "error");
    const c = r.data!.created;
    toast(`Added ${c.task} tasks, ${c.project} projects, ${c.review} reviews, ${c.followup} follow-ups`, "success");
    router.push("/");
  });
  const upd = (key: string, patch: Partial<CaptureItem>) => setItems((xs) => xs!.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const ownerOptions = [
    ...options.people.map((p) => ({ value: `u:${p.id}`, label: p.name, hint: p.title ?? undefined, icon: <Avatar name={p.name} color={p.color} size={16} /> })),
    ...options.teams.map((t) => ({ value: `t:${t.id}`, label: t.name, hint: "Team" })),
  ];

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="mb-8 text-center animate-rise">
        <div className="eyebrow mb-3">Welcome to Central Ops</div>
        <h1 className="font-serif text-[40px] leading-[1.05] tracking-[-0.015em]">What are you working on, {name}?</h1>
        <p className="mx-auto mt-3 max-w-[560px] text-[14px] text-ink-3">
          Dump everything in your head — open actions, recurring meetings and the people you’re waiting on. Central Ops will structure it and start tracking from today. Nothing before your joining date is back-filled.
        </p>
      </div>

      {!items && (
        <div className="card overflow-hidden animate-rise">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={11} autoFocus
            placeholder={EXAMPLE}
            className="block w-full resize-none bg-transparent px-6 py-5 font-[450] text-[14.5px] leading-[1.7] outline-none placeholder:text-ink-4/80" />
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-subtle/50 px-5 py-3">
            <div className="flex flex-wrap gap-1.5 text-[11.5px] text-ink-3">
              {Object.values(KINDS).map((k) => k && <span key={k.label} className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 ring-1 ring-inset ring-line">{k.icon}{k.label}</span>)}
              <span className="self-center">· one item per line · @owner · dates like “Friday” or “15 Nov”</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {!text && <Button variant="ghost" onClick={() => setText(EXAMPLE)}>Use example</Button>}
              <Button variant="primary" size="md" disabled={!text.trim() || pending} onClick={structure}>
                <Sparkles size={14} /> {pending ? "Structuring…" : "Structure it"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {items && (
        <div className="animate-rise">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[14px] font-semibold">Review {items.length} items</h2>
            <Badge tone={engine === "claude" ? "violet" : "neutral"}>{engine === "claude" ? "Structured by Claude" : "Structured by rules"}</Badge>
            <button onClick={() => setItems(null)} className="ml-auto text-[12.5px] text-ink-3 hover:text-ink">← Edit text</button>
          </div>
          <div className="card divide-y divide-line/70">
            {items.map((it) => (
              <div key={it.key} className="grid grid-cols-12 items-center gap-2 px-3 py-2.5">
                <select value={it.kind} onChange={(e) => upd(it.key, { kind: e.target.value as CaptureKind, cadence: e.target.value === "review" ? it.cadence ?? "weekly" : null })}
                  className="field col-span-12 h-8 py-1 text-[12.5px] sm:col-span-2">
                  {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v!.label}</option>)}
                </select>
                <input value={it.title} onChange={(e) => upd(it.key, { title: e.target.value })} className="field col-span-12 h-8 py-1 sm:col-span-4" />
                <div className="col-span-6 sm:col-span-2">
                  <Combobox size="sm" placeholder={it.kind === "followup" ? "Waiting on" : it.owner_label ? `${it.owner_label}?` : "Owner"} options={ownerOptions}
                    value={it.owner_id ? `u:${it.owner_id}` : it.owner_team_id ? `t:${it.owner_team_id}` : null}
                    onChange={(v) => upd(it.key, { owner_id: v?.startsWith("u:") ? v.slice(2) : null, owner_team_id: v?.startsWith("t:") ? v.slice(2) : null })} />
                </div>
                {it.kind === "review" ? (
                  <div className="col-span-6 grid grid-cols-2 gap-2 sm:col-span-3">
                    <select value={it.cadence ?? "weekly"} onChange={(e) => upd(it.key, { cadence: e.target.value as CaptureItem["cadence"] })} className="field h-8 py-1 text-[12.5px]">
                      {["daily", "weekly", "fortnightly", "monthly"].map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <Combobox size="sm" placeholder="MoM by" value={it.mom_owner_id} onChange={(v) => upd(it.key, { mom_owner_id: v })}
                      options={options.people.map((p) => ({ value: p.id, label: p.name }))} />
                  </div>
                ) : (
                  <div className="col-span-6 grid grid-cols-2 gap-2 sm:col-span-3">
                    <input type="date" min={today()} value={it.due_date ?? ""} onChange={(e) => upd(it.key, { due_date: e.target.value || null })} className="field h-8 py-1 text-[12.5px]" />
                    {it.kind === "project" ? <span /> : (
                      <Combobox size="sm" placeholder="Project" value={it.project_id} onChange={(v) => upd(it.key, { project_id: v })}
                        options={options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} />
                    )}
                  </div>
                )}
                <button onClick={() => setItems((xs) => xs!.filter((x) => x.key !== it.key))} className="col-span-12 flex justify-end text-ink-4 hover:text-bad sm:col-span-1"><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={() => setItems((xs) => [...xs!, { key: `n${Date.now()}`, kind: "task", title: "", owner_id: null, owner_team_id: null, owner_label: null, due_date: null, priority: "medium", cadence: null, mom_owner_id: null, project_id: null, notes: null }])}
              className="flex w-full items-center gap-1.5 px-4 py-2.5 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink"><Plus size={14} /> Add item</button>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3"><CalendarSync size={13} /> Recurring reviews will match your calendar meetings once Google Calendar is connected.</p>
            <Button variant="primary" size="md" disabled={pending || !items.some((i) => i.title.trim())} onClick={commit}>
              {pending ? "Adding…" : <>Add to Central Ops <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      )}

      <div className={cn("mt-8 text-center", items && "hidden")}>
        <button onClick={() => start(async () => { await finishOnboarding(); router.push("/"); })} className="text-[12.5px] text-ink-4 hover:text-ink-2">
          I’ll add things as I go — skip for now
        </button>
      </div>
    </div>
  );
}
