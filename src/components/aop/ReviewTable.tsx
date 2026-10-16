"use client";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Check, ChevronRight, MessageSquareText } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { ago } from "@/lib/dates";
import { monLabel } from "@/server/aop/calc";
import { saveDeviationRemark } from "@/server/aop/actions";
import type { SummaryTree } from "@/server/aop/summaryData";
import { aggLines, deviationsFor, fnLines, hasReason, type Deviation } from "./summaryMath";

const FLAG: Record<Deviation["kind"], { label: string; tone: "red" | "green" | "amber" | "info" | "muted" }> = {
  over: { label: "Over budget", tone: "red" }, under: { label: "Under budget", tone: "green" }, provision: { label: "Provision miss", tone: "info" },
  mom_up: { label: "MoM ▲", tone: "amber" }, mom_down: { label: "MoM ▼", tone: "muted" }, missing: { label: "No actual", tone: "amber" },
};

/** Function → flagged lines for one month; owners explain each deviation with a guided remark. */
export function ReviewTable({ tree, period, editable, onlyMine }: { tree: SummaryTree; period: string; editable: string[]; onlyMine: boolean }) {
  const editSet = useMemo(() => new Set(editable), [editable]);
  const devs = useMemo(() => deviationsFor(tree, period), [tree, period]);
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const byLine = useMemo(() => {
    const m = new Map<string, Deviation[]>();
    for (const d of devs) if (!onlyMine || editSet.has(d.line.id)) m.set(d.line.id, [...(m.get(d.line.id) ?? []), d]);
    return m;
  }, [devs, onlyMine, editSet]);
  const needs = (id: string) => { const ds = byLine.get(id)!; return !hasReason(ds[0].line, period) && ds.some((d) => d.kind !== "under" && d.kind !== "mom_down"); };
  const visible = (id: string) => filter === "all" || needs(id);
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.functions.map((f) => f.id)));
  const L = tree.labels;
  const todo = [...byLine.keys()].filter(needs).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="seg">
          {([["todo", `Needs remark · ${todo}`], ["all", `All deviations · ${byLine.size}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} data-on={filter === k} className="seg-item">{l}</button>
          ))}
        </div>
        <span className="text-[12px] text-ink-3">Flags: over/under {L.plan.toLowerCase()} by {pct(tree.threshold, 0)}+, {L.forecast.toLowerCase()} miss 15%+, month-on-month swing 25%+, or no {L.actual.toLowerCase()} (₹25K+)</span>
      </div>
      <div className="card overflow-x-auto">
        <div className="min-w-[960px]">
        <div className="grid grid-cols-[minmax(200px,1.2fr)_92px_92px_92px_132px_minmax(260px,1.5fr)] items-center gap-3 thead-hl border-b border-line px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em]">
          <span>Function · line · {monLabel(period)}</span><span className="text-right">{L.plan}</span><span className="text-right">{L.forecast}</span><span className="text-right">{L.actual}</span><span>Flags</span><span>Remark</span>
        </div>
        {tree.functions.map((f) => {
          const lines = fnLines(f).filter((l) => byLine.has(l.id) && visible(l.id));
          const a = aggLines(fnLines(f), period);
          const fTodo = fnLines(f).filter((l) => byLine.has(l.id) && needs(l.id)).length;
          const isOpen = open.has(f.id);
          return (
            <div key={f.id} className="border-b border-line last:border-0">
              <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                className="grid w-full grid-cols-[minmax(200px,1.2fr)_92px_92px_92px_132px_minmax(260px,1.5fr)] items-center gap-3 px-4 py-3 text-left hover:bg-subtle/50">
                <span className="flex min-w-0 items-center gap-2">
                  <ChevronRight size={14} className={cn("shrink-0 text-ink-3 transition-transform", isOpen && "rotate-90")} />
                  <span className="truncate font-semibold text-ink">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-3"><Avatar name={f.owner} size={16} />{f.owner}</span>
                </span>
                <span className="text-right font-medium tabular">{a.hasPlan ? inr(a.plan) : "—"}</span>
                <span className="text-right font-medium tabular">{a.hasForecast ? inr(a.forecast) : "—"}</span>
                <span className="text-right font-medium tabular">{a.hasActual ? inr(a.actual) : "—"}</span>
                <span>{fTodo ? <Badge tone="amber">{fTodo} to explain</Badge> : <Badge tone="green" dot>Explained</Badge>}</span>
                <span className="text-[12px] text-ink-4">{lines.length ? `${lines.length} line${lines.length === 1 ? "" : "s"} shown` : "No deviations to show"}</span>
              </button>
              {isOpen && lines.map((l) => <ReviewLine key={l.id} devs={byLine.get(l.id)!} period={period} canEdit={editSet.has(l.id)} labels={L} />)}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function ReviewLine({ devs, period, canEdit, labels: L }: { devs: Deviation[]; period: string; canEdit: boolean; labels: SummaryTree["labels"] }) {
  const l = devs[0].line;
  const v = l.vals[period] ?? { plan: null, forecast: null, actual: null };
  const existing = (l.remarks[period] ?? []).filter((r) => r.kind === "variance_reason" || r.kind === "commentary");
  const lead = devs.find((d) => d.kind === "over" || d.kind === "missing") ?? devs[0];
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const chips = [...new Set(devs.flatMap((d) => d.chips))].slice(0, 6);
  const save = () => start(async () => {
    const r = await saveDeviationRemark({ itemId: l.id, period, body: text });
    if (!r.ok) return toast(r.error, "error");
    setSaved(true); setText(""); toast("Remark saved", "success"); router.refresh();
  });
  return (
    <div className="grid grid-cols-[minmax(200px,1.2fr)_92px_92px_92px_132px_minmax(260px,1.5fr)] items-start gap-3 border-t border-line/50 px-4 py-3 pl-10">
      <div className="min-w-0 pt-1">
        <div className="truncate text-[13px] text-ink">{l.name}</div>
        <div className="truncate text-[11.5px] text-ink-4">{devs[0].path}</div>
      </div>
      <span className="pt-1 text-right text-[12.5px] tabular text-ink-2">{inr(v.plan)}</span>
      <span className="pt-1 text-right text-[12.5px] tabular text-ink-2">{inr(v.forecast)}</span>
      <span className="pt-1 text-right text-[12.5px] tabular text-ink">{inr(v.actual)}</span>
      <div className="flex flex-wrap gap-1 pt-0.5">
        {devs.map((d) => (
          <Badge key={d.key} tone={FLAG[d.kind].tone}>{FLAG[d.kind].label}{d.pct != null && d.kind !== "missing" ? ` ${pct(Math.abs(d.pct), 0)}` : ""}</Badge>
        ))}
      </div>
      <div className="min-w-0">
        {existing.length > 0 && (
          <div className="mb-1.5 rounded-lg bg-subtle px-2.5 py-1.5 text-[12.5px] text-ink-2">
            <span className="flex items-center gap-1 text-[10.5px] uppercase tracking-[0.04em] text-ink-4"><MessageSquareText size={11} />{existing[0].author ?? "—"} · {ago(existing[0].at)}</span>
            {existing[0].body}
          </div>
        )}
        {canEdit ? (
          <>
            <div className="mb-1 text-[12px] text-ink-3">{lead.prompt}</div>
            <div className="flex gap-1.5">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={existing.length ? "Add to the remark…" : "Type the reason…"}
                className="field min-h-8 flex-1 resize-y py-1.5 text-[12.5px]" />
              <Button variant={saved ? "subtle" : "primary"} size="sm" disabled={!text.trim() || pending} onClick={save}>{saved && !text ? <Check size={13} /> : "Save"}</Button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {chips.map((c) => (
                <button key={c} type="button" onClick={() => setText((t) => (t ? `${t}; ${c}` : c))}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 ring-1 ring-inset ring-line hover:bg-subtle hover:text-ink">{c}</button>
              ))}
            </div>
          </>
        ) : !existing.length && <span className="text-[12px] text-ink-4">Waiting on {l.owner ?? "the owner"}</span>}
      </div>
    </div>
  );
}

export { Fragment };
