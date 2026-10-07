"use client";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Check, ChevronRight, CircleDot } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { monLabel, monShort, parseUnit } from "@/server/aop/calc";
import { saveMonthInputs, type MonthCell } from "@/server/aop/actions";
import type { LineNode, SummaryTree } from "@/server/aop/summaryData";
import { aggLines, fnLines } from "./summaryMath";

type F = "plan" | "forecast" | "actual";
const g = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const show = (v: number | null | undefined) => (v == null ? "" : g.format(v));

/** Tabular month inputs: function rows (totals) → expand to editable line items. */
export function InputsTable({ tree, period, fields, editable, canEditPlan, submitted, statusBy }: {
  tree: SummaryTree; period: string; fields: string[]; editable: string[]; canEditPlan: boolean;
  submitted: string[]; statusBy: Record<string, { updated: number; total: number; due: string | null; late: boolean }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const editSet = useMemo(() => new Set(editable), [editable]);
  const cols = (["plan", "forecast", "actual"] as F[]).filter((f) => fields.includes(f));
  const withRemark = fields.includes("commentary");
  const futureActual = tree.currentMonth < period;
  const [draft, setDraft] = useState<Record<string, Partial<Record<F | "remark", string>>>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.functions.filter((f) => fnLines(f).some((l) => editSet.has(l.id))).slice(0, 1).map((f) => f.id)));
  const [submit, setSubmit] = useState<Set<string>>(new Set());
  const L = tree.labels;
  const dirtyCount = Object.values(draft).reduce((a, d) => a + Object.keys(d).length, 0);

  const val = (l: LineNode, f: F) => draft[l.id]?.[f] ?? show(l.vals[period]?.[f]);
  const set = (id: string, k: F | "remark", v: string) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));
  const canField = (l: LineNode, f: F) => editSet.has(l.id) && (f !== "plan" || canEditPlan) && !(f === "actual" && futureActual);

  const save = () => start(async () => {
    const cells: MonthCell[] = [];
    for (const [itemId, d] of Object.entries(draft)) {
      const c: MonthCell = { itemId };
      for (const f of cols) if (d[f] !== undefined) {
        const n = parseUnit(d[f]!, "inr");
        if (n != null && Number.isNaN(n)) return toast("Check the highlighted numbers", "error");
        c[f] = n;
      }
      if (d.remark?.trim()) c.remark = d.remark;
      cells.push(c);
    }
    const r = await saveMonthInputs({ cycleId: tree.cycleId, period, cells, submitSectionIds: [...submit] });
    if (!r.ok) return toast(r.error, "error");
    toast(`Saved · ${r.data?.changed ?? 0} change${r.data?.changed === 1 ? "" : "s"}${submit.size ? ` · ${submit.size} submitted` : ""}`, "success");
    setDraft({}); setSubmit(new Set());
    router.refresh();
  });

  const gridCols = `minmax(260px,1.6fr) ${cols.map(() => "132px").join(" ")} ${withRemark ? "minmax(200px,1fr)" : ""}`;

  return (
    <div>
      <div className="card overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid items-center gap-3 thead-hl border-b border-line px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ gridTemplateColumns: gridCols }}>
            <span>Function · line · {monLabel(period)}</span>
            {cols.map((f) => <span key={f} className="text-right">{L[f]}</span>)}
            {withRemark && <span>Remark</span>}
          </div>
          {tree.functions.map((f) => {
            const lines = fnLines(f);
            const a = aggLines(lines, period);
            const st = statusBy[f.id];
            const isOpen = open.has(f.id);
            const mine = lines.some((l) => editSet.has(l.id));
            const isSubmitted = submitted.includes(f.id);
            const groups = [{ name: null as string | null, lines: f.lines }, ...f.groups.map((gr) => ({ name: gr.name, lines: gr.lines }))].filter((x) => x.lines.length);
            return (
              <div key={f.id} className="border-b border-line last:border-0">
                <div className="grid cursor-pointer items-center gap-3 px-4 py-3 hover:bg-subtle/50" style={{ gridTemplateColumns: gridCols }}
                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
                  <div className="flex min-w-0 items-center gap-2">
                    <ChevronRight size={14} className={cn("shrink-0 text-ink-3 transition-transform", isOpen && "rotate-90")} />
                    <span className="truncate font-semibold text-ink">{f.name}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-3"><Avatar name={f.owner} size={16} />{f.owner}</span>
                    {isSubmitted ? <Badge tone="green" dot>Submitted</Badge> : st && st.total > 0 ? (
                      <Badge tone={st.late ? "red" : st.updated === st.total ? "green" : "amber"}>{st.updated}/{st.total}{st.late ? " · late" : ""}</Badge>
                    ) : null}
                  </div>
                  {cols.map((c) => <span key={c} className="text-right font-medium tabular text-ink">{(c === "plan" ? a.hasPlan : c === "forecast" ? a.hasForecast : a.hasActual) ? inr(a[c]) : "—"}</span>)}
                  {withRemark && (
                    <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      {mine && !isSubmitted && (
                        <button onClick={() => setSubmit((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                          className={cn("flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] ring-1 ring-inset", submit.has(f.id) ? "bg-ok-soft text-ok ring-ok/30" : "text-ink-3 ring-line-strong hover:text-ink")}>
                          {submit.has(f.id) ? <Check size={12} /> : <CircleDot size={12} />} Mark submitted
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {isOpen && groups.map((gr, gi) => (
                  <Fragment key={gi}>
                    {gr.name && <div className="bg-subtle/30 px-4 py-1.5 pl-10 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-4">{gr.name}</div>}
                    {gr.lines.map((l) => (
                      <div key={l.id} className="grid items-center gap-3 border-t border-line/50 px-4 py-1.5 pl-10" style={{ gridTemplateColumns: gridCols }}>
                        <span className="truncate text-[13px] text-ink-2" title={l.name}>{l.name}</span>
                        {cols.map((c) => {
                          const v = val(l, c), dirty = draft[l.id]?.[c] !== undefined, bad = !!v && Number.isNaN(parseUnit(v, "inr") ?? 0);
                          return canField(l, c) ? (
                            <input key={c} value={v} onChange={(e) => set(l.id, c, e.target.value)} inputMode="decimal" placeholder="—"
                              className={cn("field h-8 py-1 text-right text-[12.5px] tabular", dirty && "border-info/50 bg-info-soft/40", bad && "border-bad")} />
                          ) : <span key={c} className="pr-3 text-right text-[12.5px] tabular text-ink-3">{v || "—"}</span>;
                        })}
                        {withRemark && (editSet.has(l.id)
                          ? <input value={draft[l.id]?.remark ?? ""} onChange={(e) => set(l.id, "remark", e.target.value)} placeholder={(l.remarks[period]?.[0]?.body ?? "Add a remark") as string}
                              className="field h-8 py-1 text-[12.5px]" />
                          : <span className="truncate text-[12px] text-ink-3">{l.remarks[period]?.[0]?.body ?? ""}</span>)}
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sticky bottom-3 z-10 mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur" style={{ boxShadow: "var(--shadow-pop)" }}>
        <span className="text-[13px] text-ink-2">{dirtyCount ? <><b className="font-semibold text-ink">{dirtyCount}</b> unsaved change{dirtyCount === 1 ? "" : "s"}</> : `Editing ${monShort(period)} — values in ₹ (12.5L, 1.2Cr also work)`}</span>
        {futureActual && cols.includes("actual") && <span className="text-[12px] text-ink-4">{L.actual} open once the month starts</span>}
        <div className="ml-auto flex gap-2">
          {dirtyCount > 0 && <Button variant="ghost" onClick={() => setDraft({})} disabled={pending}>Discard</Button>}
          <Button variant="primary" onClick={save} disabled={pending || (!dirtyCount && !submit.size)}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
