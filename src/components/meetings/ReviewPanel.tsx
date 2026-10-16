"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, CircleCheck, Gavel, Hourglass, MessageSquareText, Plus, RotateCcw, Send, Sparkles, TriangleAlert, Undo2, Users, X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { Combobox, useToast, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { today } from "@/lib/dates";
import { PRIORITY, RISK_LEVEL, type Priority } from "@/lib/meta";
import { addSuggestion, distributeMom, reExtract, saveSuggestion } from "@/server/meetings/actions";
import type { SuggestionKind, SuggestionPayload } from "@/server/meetings/extract";

export interface ReviewItem { id: string; kind: SuggestionKind; payload: SuggestionPayload; status: "pending" | "accepted" | "ignored"; feedback: string | null }
interface Opts {
  people: { id: string; name: string; color: string | null; team_name?: string | null }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; code: string | null }[];
}

const KIND: Record<SuggestionKind, { label: string; icon: React.ReactNode }> = {
  action: { label: "Action", icon: <CircleCheck size={13} /> },
  followup: { label: "Follow-up", icon: <Hourglass size={13} /> },
  decision: { label: "Decision", icon: <Gavel size={13} /> },
  risk: { label: "Risk", icon: <TriangleAlert size={13} /> },
};

/** PM review of AI-suggested items: edit inline, assign to a person or team, add a note for the owner, accept / ignore, distribute. */
export function ReviewPanel({ meetingId, items: initial, opts, engine, ownerName, defaultFeedback }: { meetingId: string; items: ReviewItem[]; opts: Opts; engine: string | null; ownerName: string | null; defaultFeedback?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState<ReviewItem[]>(initial);
  const [pmFeedback, setPmFeedback] = useState(defaultFeedback ?? "");
  // merge newly added / re-extracted items from the server
  useEffect(() => {
    setItems((cur) => {
      const ids = new Set(initial.map((i) => i.id));
      const kept = cur.filter((c) => ids.has(c.id));
      const added = initial.filter((i) => !kept.some((k) => k.id === i.id));
      return [...kept, ...added];
    });
  }, [initial]);

  const patch = (id: string, f: (i: ReviewItem) => ReviewItem) => setItems((xs) => xs.map((x) => (x.id === id ? f(x) : x)));
  const decide = (id: string, status: ReviewItem["status"]) => {
    const it = items.find((i) => i.id === id)!;
    if (status === "accepted" && !it.payload.title?.trim()) { toast("Give it a title first", "error"); return; }
    patch(id, (i) => ({ ...i, status }));
    start(async () => { const r = await saveSuggestion(id, { payload: it.payload, feedback: it.feedback, status }); if (!r.ok) { toast(r.error, "error"); patch(id, (i) => ({ ...i, status: it.status })); } });
  };
  const acceptAll = () => {
    const untitled = items.filter((i) => i.status === "pending" && !i.payload.title?.trim());
    setItems((xs) => xs.map((x) => (x.status === "pending" && x.payload.title?.trim() ? { ...x, status: "accepted" } : x)));
    if (untitled.length) toast(`${untitled.length} item without a title was left undecided`);
  };
  const counts = useMemo(() => ({
    accepted: items.filter((i) => i.status === "accepted").length,
    pending: items.filter((i) => i.status === "pending").length,
    ignored: items.filter((i) => i.status === "ignored").length,
    unowned: items.filter((i) => i.status === "accepted" && i.kind === "action" && !i.payload.owner_id && !i.payload.team_id).length,
  }), [items]);

  const distribute = () => start(async () => {
    const r = await distributeMom(meetingId, { pmFeedback: pmFeedback || null, items: items.map((i) => ({ id: i.id, payload: i.payload, feedback: i.feedback, status: i.status })) });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(r.message ?? "Distributed", "success");
    router.refresh();
  });
  const add = (kind: SuggestionKind) => start(async () => { const r = await addSuggestion(meetingId, kind); if (!r.ok) toast(r.error, "error"); else router.refresh(); });
  const reread = () => start(async () => { const r = await reExtract(meetingId); if (!r.ok) toast(r.error, "error"); else { toast(r.message ?? "Done"); router.refresh(); } });

  const people: Option[] = useMemo(() => opts.people.map((p) => ({ value: p.id, label: p.name, hint: p.team_name ?? undefined, icon: <Avatar name={p.name} color={p.color} size={18} /> })), [opts.people]);
  const assignees: Option[] = useMemo(() => [
    ...opts.people.map((p) => ({ value: `u:${p.id}`, label: p.name, hint: p.team_name ?? undefined, icon: <Avatar name={p.name} color={p.color} size={18} /> })),
    ...opts.teams.map((t) => ({ value: `t:${t.id}`, label: t.name, hint: "Team", icon: <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-muted text-ink-3"><Users size={11} /></span> })),
  ], [opts.people, opts.teams]);
  const projects: Option[] = useMemo(() => opts.projects.map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined })), [opts.projects]);

  const groups: SuggestionKind[] = ["action", "followup", "decision", "risk"];
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Sparkles size={15} className="text-ink-3" />Suggested actions</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            From {ownerName ? `${ownerName}’s` : "the"} MoM · {engine === "claude" ? "read by Claude" : "rule-based extraction"} · edit anything, then accept or ignore. Nothing goes out until you distribute.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reread} disabled={pending} title="Re-run extraction on the latest MoM (replaces undistributed suggestions)"><RotateCcw size={13} />Re-read MoM</Button>
          <Button size="sm" onClick={acceptAll} disabled={pending || !counts.pending}><Check size={13} />Accept all</Button>
        </div>
      </div>

      {!items.length && <div className="px-5 py-10 text-center text-[13px] text-ink-3">No actions were found in this MoM. Add items below, or distribute with feedback only.</div>}

      {groups.map((k) => {
        const list = items.filter((i) => i.kind === k);
        if (!list.length) return null;
        return (
          <div key={k} className="border-b border-line/70 last:border-0">
            <div className="flex items-center gap-2 px-5 pb-1 pt-3.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {KIND[k].icon}{k === "followup" ? "Follow-ups" : `${KIND[k].label}s`}<span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tracking-normal text-ink-2">{list.length}</span>
            </div>
            <div className="space-y-2 px-3 pb-3 pt-1.5">
              {list.map((it) => (
                <Card key={it.id} it={it} patch={(f) => patch(it.id, f)} decide={(s) => decide(it.id, s)} people={people} assignees={assignees} projects={projects}
                  actions={items.filter((x) => x.kind === "action" && x.id !== it.id && x.status !== "ignored")} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-2.5">
        <span className="mr-1 text-[12px] text-ink-4">Missed something?</span>
        {(["action", "decision", "risk"] as const).map((k) => <Button key={k} variant="ghost" size="xs" onClick={() => add(k)} disabled={pending}><Plus size={12} />{KIND[k].label}</Button>)}
      </div>

      <div className="border-t border-line bg-subtle/50 px-5 py-4">
        <label className="label flex items-center gap-1.5"><MessageSquareText size={13} />Your feedback to the owners</label>
        <textarea value={pmFeedback} onChange={(e) => setPmFeedback(e.target.value)} rows={2} className="field resize-y bg-surface"
          placeholder="e.g. Good MoM. Tunnel slip needs a recovery date by Friday — flag early if the vendor can't commit." />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <Badge tone="green">{counts.accepted} accepted</Badge>
            {counts.pending > 0 && <span>{counts.pending} undecided will be ignored</span>}
            {counts.ignored > 0 && <span>{counts.ignored} ignored</span>}
            {counts.unowned > 0 && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle size={12} />{counts.unowned} without an owner</span>}
          </div>
          <Button variant="primary" size="md" className="ml-auto" onClick={distribute} disabled={pending}>
            <Send size={14} />{pending ? "Distributing…" : counts.accepted ? `Distribute ${counts.accepted} item${counts.accepted === 1 ? "" : "s"}` : "Close review"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Card({ it, patch, decide, people, assignees, projects, actions }: {
  it: ReviewItem; patch: (f: (i: ReviewItem) => ReviewItem) => void; decide: (s: ReviewItem["status"]) => void;
  people: Option[]; assignees: Option[]; projects: Option[]; actions: ReviewItem[];
}) {
  const p = it.payload;
  const setP = (q: Partial<SuggestionPayload>) => patch((i) => ({ ...i, payload: { ...i.payload, ...q } }));
  const [showNote, setShowNote] = useState(Boolean(it.feedback));
  if (it.status === "ignored") {
    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-4">
        <X size={13} /><span className="min-w-0 flex-1 truncate line-through decoration-ink-4/60">{p.title || "Untitled"}</span>
        <button type="button" onClick={() => decide("pending")} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Undo2 size={12} />Undo</button>
      </div>
    );
  }
  const accepted = it.status === "accepted";
  const assignee = p.owner_id ? `u:${p.owner_id}` : p.team_id ? `t:${p.team_id}` : null;
  const tinyLabel = "mb-1 block text-[11px] font-medium text-ink-4";
  return (
    <div className={cn("rounded-xl border bg-surface px-3.5 py-3 transition-[border-color,box-shadow]", accepted ? "border-ok/35 shadow-[0_0_0_3px_rgb(21_128_61/0.06)]" : "border-line hover:border-line-strong")}>
      <div className="flex items-start gap-3">
        <input value={p.title ?? ""} onChange={(e) => setP({ title: e.target.value })} placeholder={`Describe the ${KIND[it.kind].label.toLowerCase()}…`}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[13px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-4 hover:bg-subtle focus:bg-subtle" />
        <div className="flex shrink-0 items-center gap-1">
          {accepted ? (
            <button type="button" onClick={() => decide("pending")} className="inline-flex h-7 items-center gap-1 rounded-lg bg-ok-soft px-2 text-[12px] font-medium text-ok ring-1 ring-inset ring-ok/20 hover:bg-ok-soft/70"><Check size={13} strokeWidth={2.5} />Accepted</button>
          ) : (
            <>
              <Button size="xs" variant="ghost" onClick={() => decide("ignored")}>Ignore</Button>
              <Button size="xs" onClick={() => decide("accepted")}><Check size={12} />Accept</Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5 px-1 md:grid-cols-4 [&_div.inline-block]:block">
        {(it.kind === "action" || it.kind === "followup") && (
          <>
            <div className="col-span-2 md:col-span-1">
              <span className={tinyLabel}>{it.kind === "followup" ? "Who follows up" : "Owner — person or team"}</span>
              <Combobox size="sm" value={it.kind === "followup" ? (p.owner_id ? `u:${p.owner_id}` : null) : assignee} options={it.kind === "followup" ? assignees.filter((a) => a.value.startsWith("u:")) : assignees}
                placeholder={p.owner_name ? `${p.owner_name}?` : p.team_name ? `${p.team_name}?` : "Assign…"}
                onChange={(v) => {
                  const o = assignees.find((a) => a.value === v);
                  if (!v) setP({ owner_id: null, owner_name: null, team_id: null, team_name: null });
                  else if (v.startsWith("u:")) setP({ owner_id: v.slice(2), owner_name: o?.label ?? null, team_id: null, team_name: null });
                  else setP({ team_id: v.slice(2), team_name: o?.label ?? null, owner_id: null, owner_name: null });
                }} />
            </div>
            {it.kind === "followup" && (
              <div>
                <span className={tinyLabel}>Waiting on</span>
                <Combobox size="sm" value={p.waiting_on_id ?? null} options={people} placeholder={p.waiting_on_name ? `${p.waiting_on_name}?` : "Person…"}
                  onChange={(v) => setP({ waiting_on_id: v, waiting_on_name: people.find((x) => x.value === v)?.label ?? null })} />
              </div>
            )}
            <div>
              <span className={tinyLabel}>Due</span>
              <input type="date" min={today()} value={p.due_date ?? ""} onChange={(e) => setP({ due_date: e.target.value || null, due_note: null })}
                className={cn("field h-8 py-1 text-[12.5px]", !p.due_date && "text-ink-4")} />
            </div>
            <div>
              <span className={tinyLabel}>Priority</span>
              <div className="flex h-8 items-center gap-0.5 rounded-lg border border-line-strong p-0.5">
                {(["urgent", "high", "medium", "low"] as Priority[]).map((pr) => (
                  <button key={pr} type="button" title={PRIORITY[pr].label} onClick={() => setP({ priority: pr })}
                    className={cn("h-full flex-1 rounded-md text-[11.5px] capitalize transition-colors", (p.priority ?? "medium") === pr ? pr === "urgent" ? "bg-bad-soft font-medium text-bad" : "bg-subtle font-medium text-ink" : "text-ink-4 hover:text-ink-2")}>
                    {pr === "medium" ? "Med" : pr === "urgent" ? "Urg" : pr}
                  </button>
                ))}
              </div>
            </div>
            {it.kind === "action" && (
              <>
                <div className="col-span-2 md:col-span-2">
                  <span className={tinyLabel}>Project</span>
                  <Combobox size="sm" value={p.project_id ?? null} options={projects} placeholder="No project" onChange={(v) => setP({ project_id: v })} />
                </div>
                <div className="col-span-2 md:col-span-2">
                  <span className={tinyLabel}>Depends on</span>
                  <Combobox size="sm" value={p.depends_on ?? null} placeholder={p.dependency ? `“${p.dependency}”` : "Nothing"} onChange={(v) => setP({ depends_on: v })}
                    options={actions.map((a) => ({ value: a.id, label: a.payload.title || "Untitled action" }))} />
                </div>
              </>
            )}
          </>
        )}
        {it.kind === "decision" && (
          <>
            <div>
              <span className={tinyLabel}>Decided by</span>
              <Combobox size="sm" value={p.decision_maker_id ?? null} options={people} placeholder={p.decision_maker ? `${p.decision_maker}?` : "You"} onChange={(v) => setP({ decision_maker_id: v, decision_maker: people.find((x) => x.value === v)?.label ?? null })} />
            </div>
            <div className="col-span-2 md:col-span-3">
              <span className={tinyLabel}>Context / why</span>
              <input value={p.context ?? ""} onChange={(e) => setP({ context: e.target.value })} placeholder="Why this was decided" className="field h-8 py-1 text-[12.5px]" />
            </div>
          </>
        )}
        {it.kind === "risk" && (
          <>
            <div>
              <span className={tinyLabel}>Owner</span>
              <Combobox size="sm" value={p.owner_id ?? null} options={people} placeholder={p.owner_name ? `${p.owner_name}?` : "Assign…"} onChange={(v) => setP({ owner_id: v, owner_name: people.find((x) => x.value === v)?.label ?? null })} />
            </div>
            <Scale label="Probability" value={p.probability ?? 3} onChange={(v) => setP({ probability: v })} />
            <Scale label="Impact" value={p.impact ?? 3} onChange={(v) => setP({ impact: v })} />
            <div>
              <span className={tinyLabel}>Level</span>
              <div className="flex h-8 items-center"><Badge tone={RISK_LEVEL((p.probability ?? 3) * (p.impact ?? 3)).tone} dot>{RISK_LEVEL((p.probability ?? 3) * (p.impact ?? 3)).label} · {(p.probability ?? 3) * (p.impact ?? 3)}</Badge></div>
            </div>
            <div className="col-span-2 md:col-span-4">
              <span className={tinyLabel}>Mitigation</span>
              <input value={p.mitigation ?? ""} onChange={(e) => setP({ mitigation: e.target.value })} placeholder="What we'll do about it" className="field h-8 py-1 text-[12.5px]" />
            </div>
          </>
        )}
      </div>

      {p.due_note && <p className="mt-2 flex items-center gap-1.5 px-1 text-[11.5px] text-warn"><AlertTriangle size={11} />{p.due_note}</p>}

      <div className="mt-2 px-1">
        {showNote ? (
          <div className="flex items-center gap-2">
            <MessageSquareText size={13} className="shrink-0 text-ink-4" />
            <input autoFocus={!it.feedback} value={it.feedback ?? ""} onChange={(e) => patch((i) => ({ ...i, feedback: e.target.value }))} placeholder="Note to the owner — sent with the task"
              className="min-w-0 flex-1 rounded-md bg-subtle px-2 py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-4" />
          </div>
        ) : (
          <button type="button" onClick={() => setShowNote(true)} className="inline-flex items-center gap-1 text-[12px] text-ink-4 hover:text-ink-2"><MessageSquareText size={12} />Add a note for the owner</button>
        )}
      </div>
    </div>
  );
}

function Scale({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-ink-4">{label}</span>
      <div className="flex h-8 items-center gap-0.5 rounded-lg border border-line-strong p-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} className={cn("h-full flex-1 rounded-md text-[11.5px] tabular", value === n ? "bg-subtle font-medium text-ink" : "text-ink-4 hover:text-ink-2")}>{n}</button>
        ))}
      </div>
    </div>
  );
}
