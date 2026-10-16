"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, ListPlus, MessageSquare, X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { ago, fmtDate, today } from "@/lib/dates";
import { inr, pct } from "@/lib/format";
import { addComment } from "@/server/aop/actions";
import { monLabel, STATUS_META, varianceWord, type UnitMode } from "@/server/aop/calc";
import type { ItemDetail } from "@/server/aop/queries";
import { MonthlyChart } from "./Charts";
import { CreateTaskModal, RequestUpdateButton } from "./Actions";

const KIND_LABEL = { commentary: "Commentary", variance_reason: "Reason for variance", corrective_action: "Corrective action" } as const;
type Kind = keyof typeof KIND_LABEL;

export function LineDrawer({ itemId, onClose, cycleId, userId }: { itemId: string | null; onClose: () => void; unit: UnitMode; userId: string; cycleId: string }) {
  const [d, setD] = useState<ItemDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const load = useCallback(() => {
    if (!itemId) return;
    fetch(`/api/aop/items/${itemId}`).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error ?? "Couldn't load"); return r.json(); })
      .then((x: ItemDetail) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [itemId]);
  useEffect(() => { setD(null); setErr(null); load(); }, [load]);
  useEffect(() => {
    if (!itemId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !taskOpen) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, onClose, taskOpen]);
  if (!itemId || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/10 animate-fade-in" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[540px] flex-col border-l border-line bg-surface animate-rise" style={{ boxShadow: "var(--shadow-pop)" }}>
        {!d ? (
          <div className="p-6">
            <div className="mb-4 flex justify-end"><button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-subtle" aria-label="Close"><X size={16} /></button></div>
            {err ? <p className="text-[13px] text-bad">{err}</p> : <div className="space-y-3"><div className="skeleton h-5 w-2/3" /><div className="skeleton h-24" /><div className="skeleton h-40" /></div>}
          </div>
        ) : <Body d={d} onClose={onClose} reload={load} openTask={() => setTaskOpen(true)} cycleId={cycleId} userId={userId} />}
      </aside>
      {d && <CreateTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} itemId={d.item.id} ownerId={d.item.owner_id} onCreated={load}
        defaultTitle={`${d.item.m.impact < 0 ? "Bring" : "Review"} ${d.item.name} ${d.item.m.impact < 0 ? `back within ${d.labels.plan.toLowerCase()}` : d.labels.forecast.toLowerCase()}`}
        context={`${d.item.functionName}${d.item.groupName ? ` › ${d.item.groupName}` : ""} · ${d.item.name}`} />}
    </div>,
    document.body,
  );
}

function Body({ d, onClose, reload, openTask }: { d: ItemDetail; onClose: () => void; reload: () => void; openTask: () => void; cycleId: string; userId: string }) {
  const { item: it, labels: L } = d;
  const m = it.m;
  const st = STATUS_META[m.status];
  const chart = d.months.map((p) => ({ ...p, label: monLabel(p.period).slice(0, 3), closed: !!d.lastClosed && p.period <= d.lastClosed }));
  const vpct = m.ytdPlanReported ? m.variance / Math.abs(m.ytdPlanReported) : null;
  const tone = (imp: number, base: number) => (!base || Math.abs(imp) / Math.abs(base) < 0.005 ? "text-ink" : imp < 0 ? "text-bad" : "text-ok");
  const td = today();
  return (
    <>
      <div className="border-b border-line px-5 pb-4 pt-4">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0 text-[12px] text-ink-3">{it.functionName}{it.groupName ? ` › ${it.groupName}` : ""}</div>
          <button onClick={onClose} className="-mr-1 -mt-1 rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Close"><X size={16} /></button>
        </div>
        <h2 className="font-serif text-[20px] leading-tight text-ink">{it.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          <Badge tone={st.tone} dot>{st.label}</Badge>
          <span className="flex items-center gap-1.5"><Avatar name={it.owner_name} size={18} />{it.owner_name ?? "No owner"}</span>
          {it.confidence && <Badge tone={it.confidence === "low" ? "amber" : "muted"}>{it.confidence} confidence</Badge>}
          {it.reference && <span className="text-ink-3">· {it.reference}</span>}
        </div>
        {it.note && <p className="mt-2 text-[12.5px] text-ink-3">{it.note}</p>}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="grid grid-cols-4 gap-3 border-b border-line px-5 py-4">
          <Mini label={`FY ${L.plan.toLowerCase()}`} value={inr(m.fyPlan)} />
          <Mini label={`YTD ${L.actual.toLowerCase()}`} value={inr(m.ytdActual)} hint={`of ${inr(m.ytdPlanReported)}`} />
          <Mini label="Variance" value={<span className={tone(m.impact, m.ytdPlanReported)}>{inr(m.variance, { sign: true })}</span>} hint={vpct == null ? undefined : `${pct(vpct, 1, true)} · ${varianceWord(it.direction, L, m.impact >= 0).toLowerCase()}`} />
          <Mini label="FY projection" value={inr(m.projection)} hint={<span className={tone(m.gapImpact, m.fyPlan)}>{inr(m.gap, { sign: true })} gap</span>} />
        </div>
        <div className="border-b border-line px-5 py-4">
          <MonthlyChart data={chart} labels={L} height={150} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {d.can.task && <Button size="sm" variant="primary" onClick={openTask}><ListPlus size={14} />Create corrective task</Button>}
          {d.can.task && it.owner_id && <RequestUpdateButton itemId={it.id} size="sm" variant="secondary" />}
        </div>

        {d.tasks.length > 0 && (
          <Section title="Linked tasks" count={d.tasks.length}>
            {d.tasks.map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-subtle">
                <span className="w-14 shrink-0 font-mono text-[11px] text-ink-4">CO-{t.number}</span>
                <span className={cn("min-w-0 flex-1 truncate", t.status === "completed" ? "text-ink-3 line-through" : "text-ink")}>{t.title}</span>
                <span className="text-[11.5px] text-ink-3">{t.owner_name ?? ""}</span>
                <span className={cn("w-16 text-right text-[11.5px] tabular", t.due_date && t.due_date < td && t.status !== "completed" ? "text-bad" : "text-ink-3")}>{t.due_date ? fmtDate(t.due_date) : ""}</span>
              </Link>
            ))}
          </Section>
        )}

        <Section title="Commentary" count={d.comments.length} icon={<MessageSquare size={13} />}>
          {d.can.comment && <Composer itemId={it.id} months={d.months.map((x) => x.period)} lastClosed={d.lastClosed} onDone={reload} labels={L} />}
          <div className="mt-2 space-y-3">
            {d.comments.map((c) => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar name={c.author} color={c.author_color} size={22} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                    <span className="font-medium text-ink-2">{c.author ?? "Someone"}</span>
                    <Badge tone={c.kind === "corrective_action" ? "info" : c.kind === "variance_reason" ? "amber" : "muted"}>{KIND_LABEL[c.kind as Kind] ?? c.kind}</Badge>
                    {c.period && <span>{monLabel(c.period)}</span>}
                    {c.confidence && <span>· {c.confidence} confidence</span>}
                    <span className="ml-auto">{ago(c.created_at)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{c.body}</p>
                </div>
              </div>
            ))}
            {!d.comments.length && <p className="py-2 text-[12.5px] text-ink-4">No commentary yet.</p>}
          </div>
        </Section>

        <Section title="Value history" count={d.history.length} icon={<History size={13} />}>
          {d.history.length ? (
            <ol className="space-y-1.5">
              {d.history.map((h) => (
                <li key={h.id} className="flex gap-2 text-[12.5px] text-ink-2">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" />
                  <span className="min-w-0 flex-1">
                    <b className="font-medium text-ink">{h.author ?? "Import"}</b> changed {h.period ? `${monLabel(h.period)} ` : ""}{fieldLabel(h.field, L)}{" "}
                    {h.field === "owner" ? "" : <span className="tabular">{fmtV(h.old_value)} → {fmtV(h.new_value)}</span>}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-4">{ago(h.created_at)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-[12.5px] text-ink-4">No changes recorded since the plan was loaded.</p>}
        </Section>
      </div>
    </>
  );
}

const fmtV = (v: string | null) => (v == null || v === "" ? "—" : Number.isFinite(Number(v)) ? inr(Number(v)) : v);
const fieldLabel = (f: string, L: ItemDetail["labels"]) => (f === "plan" || f === "forecast" || f === "actual" ? L[f].toLowerCase() : f.replace("_", " "));

function Mini({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1 truncate text-[10.5px]">{label}</div>
      <div className="truncate font-serif text-[16px] leading-none tabular text-ink">{value}</div>
      {hint && <div className="mt-1 truncate text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}
function Section({ title, count, icon, children }: { title: string; count?: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4 last:border-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {icon}{title}{count != null && count > 0 && <span className="rounded-full bg-muted px-1.5 text-[10.5px] tracking-normal text-ink-2">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Composer({ itemId, months, lastClosed, onDone, labels }: { itemId: string; months: string[]; lastClosed: string | null; onDone: () => void; labels: ItemDetail["labels"] }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<Kind>("commentary");
  const [body, setBody] = useState("");
  const [period, setPeriod] = useState(lastClosed ?? "");
  const [conf, setConf] = useState<"" | "high" | "medium" | "low">("");
  const post = () => start(async () => {
    const r = await addComment({ itemId, kind, body, period: period || null, confidence: conf || null });
    if (!r.ok) return toast(r.error, "error");
    setBody(""); toast("Posted", "success"); onDone(); router.refresh();
  });
  return (
    <div className="rounded-xl border border-line bg-subtle/40 p-2.5">
      <div className="mb-2 flex flex-wrap gap-1">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={cn("h-7 rounded-md px-2 text-[12px] transition-colors", kind === k ? "bg-surface font-medium text-ink ring-1 ring-line-strong" : "text-ink-3 hover:text-ink")}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2}
        placeholder={kind === "variance_reason" ? `Why is ${labels.actual.toLowerCase()} off ${labels.plan.toLowerCase()}? (invoice timing, arrears, volume…)` : kind === "corrective_action" ? "What will be done, by whom, by when?" : "Add context for the review"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) post(); }}
        className="w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-4 focus:border-ink-3" />
      <div className="mt-2 flex items-center gap-2">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="field h-7 w-auto py-0 pr-7 text-[12px]">
          <option value="">No month</option>
          {months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
        </select>
        <select value={conf} onChange={(e) => setConf(e.target.value as typeof conf)} className="field h-7 w-auto py-0 pr-7 text-[12px]">
          <option value="">Confidence</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <Button size="xs" variant="primary" className="ml-auto" disabled={pending || !body.trim()} onClick={post}>{pending ? "Posting…" : "Post"}</Button>
      </div>
    </div>
  );
}
