"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import { submitInputs, type InputLine } from "@/server/aop/actions";
import { impactOf, parseUnit, varianceWord, type Direction, type Labels } from "@/server/aop/calc";

export interface InputRow {
  id: string; name: string; path: string; fnId: string; plan: number | null; forecast: number | null; actual: number | null; prevActual: number | null;
  direction: Direction; commentary: string | null; reason: string | null; corrective: string | null; confidence: "high" | "medium" | "low" | null;
}
type Draft = { actual: string; forecast: string; commentary: string; reason: string; corrective: string; confidence: "" | "high" | "medium" | "low" };
const g = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const show = (v: number | null) => (v == null ? "" : g.format(v));

export function InputsForm({ cycleId, period, kind, ownerId, rows, labels: L, threshold, canActual, prevLabel }: {
  cycleId: string; period: string; kind: "actuals" | "projections"; ownerId: string; rows: InputRow[]; labels: Labels; threshold: number; canActual: boolean; prevLabel: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const init = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, { actual: show(r.actual), forecast: show(r.forecast), commentary: "", reason: "", corrective: "", confidence: r.confidence ?? "" } as Draft])), [rows]);
  const [d, setD] = useState<Record<string, Draft>>(init);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (id: string, k: keyof Draft, v: string) => setD((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const num = (s: string) => { const n = parseUnit(s, "inr"); return n == null || Number.isNaN(n) ? null : n; };

  const groups = useMemo(() => {
    const out = new Map<string, InputRow[]>();
    for (const r of rows) out.set(r.path, [...(out.get(r.path) ?? []), r]);
    return [...out.entries()];
  }, [rows]);
  const filled = rows.filter((r) => (kind === "actuals" ? num(d[r.id].actual) != null : num(d[r.id].forecast) != null)).length;

  const save = (final: boolean) => start(async () => {
    const lines: InputLine[] = [];
    for (const r of rows) {
      const x = d[r.id];
      const bad = [x.actual, x.forecast].some((s) => s.trim() && Number.isNaN(parseUnit(s, "inr")));
      if (bad) return toast(`Check the numbers on ${r.name}`, "error");
      const l: InputLine = { itemId: r.id };
      if (canActual && x.actual !== init[r.id].actual) l.actual = num(x.actual);
      if (x.forecast !== init[r.id].forecast) l.forecast = num(x.forecast);
      if (x.commentary.trim()) l.commentary = x.commentary;
      if (x.reason.trim()) l.reason = x.reason;
      if (x.corrective.trim()) l.corrective = x.corrective;
      if (x.confidence && x.confidence !== (r.confidence ?? "")) l.confidence = x.confidence;
      if (Object.keys(l).length > 1 || final) lines.push(l);
    }
    const res = await submitInputs({ cycleId, period, kind, ownerId, lines, final });
    if (!res.ok) return toast(res.error, "error");
    toast(final ? `Submitted · ${res.data?.changed ?? 0} changes` : `Draft saved · ${res.data?.changed ?? 0} changes`, "success");
    router.refresh();
    if (final) router.push(`/aop/inputs?period=${period}&kind=${kind}`);
  });

  return (
    <div>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.6fr)_110px_130px_130px_120px_28px] items-center gap-3 border-b border-line bg-subtle/50 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">
          <span>Line</span><span className="text-right">{L.plan}</span><span className="text-right">{L.forecast}</span><span className="text-right">{L.actual}</span><span className="text-right">Variance</span><span />
        </div>
        {groups.map(([path, list]) => (
          <div key={path}>
            <div className="border-b border-line bg-subtle/30 px-4 py-1.5 text-[12px] font-medium text-ink-2">{path}</div>
            {list.map((r) => {
              const x = d[r.id];
              const a = num(x.actual), f = num(x.forecast);
              const basis = kind === "actuals" ? a : f;
              const imp = basis != null && r.plan ? impactOf(r.direction, r.plan, basis) / Math.abs(r.plan) : null;
              const off = imp != null && imp < -threshold;
              const isOpen = open.has(r.id) || off;
              const needsReason = off && !x.reason.trim() && !r.reason;
              return (
                <div key={r.id} className="border-b border-line/70 last:border-0">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_110px_130px_130px_120px_28px] items-center gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">{r.name}</div>
                      {prevLabel && r.prevActual != null && <div className="text-[11px] text-ink-4">{prevLabel} {L.actual.toLowerCase()} {inr(r.prevActual)}</div>}
                    </div>
                    <span className="text-right text-[12.5px] tabular text-ink-3">{r.plan == null ? "—" : g.format(r.plan)}</span>
                    <input value={x.forecast} onChange={(e) => set(r.id, "forecast", e.target.value)} inputMode="decimal" placeholder="—"
                      className="field h-8 py-1 text-right text-[12.5px] tabular" />
                    <input value={x.actual} disabled={!canActual} onChange={(e) => set(r.id, "actual", e.target.value)} inputMode="decimal" placeholder={canActual ? "Enter" : "—"}
                      className={cn("field h-8 py-1 text-right text-[12.5px] tabular", kind === "actuals" && canActual && !x.actual && "border-warn/40 bg-warn-soft/30")} />
                    <span className={cn("text-right text-[12.5px] tabular", imp == null ? "text-ink-4" : off ? "text-bad" : "text-ink-2")}>
                      {imp == null ? "—" : <>{inr((basis ?? 0) - (r.plan ?? 0), { sign: true })}<span className="ml-1 text-[11px] opacity-75">{pct(((basis ?? 0) - (r.plan ?? 0)) / Math.abs(r.plan!), 0, true)}</span></>}
                    </span>
                    <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                      className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-subtle" aria-label="Notes">
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="grid gap-2 bg-subtle/30 px-4 pb-3 pt-1 md:grid-cols-3">
                      <Note label="Commentary" value={x.commentary} prior={r.commentary} onChange={(v) => set(r.id, "commentary", v)} />
                      <Note label={`Reason for variance${needsReason ? " · needed" : ""}`} warn={needsReason} value={x.reason} prior={r.reason} onChange={(v) => set(r.id, "reason", v)}
                        placeholder={off ? `${varianceWord(r.direction, L, false)} — why? (invoice timing, arrears, volume…)` : "Optional"} />
                      <div>
                        <Note label="Corrective action" value={x.corrective} prior={r.corrective} onChange={(v) => set(r.id, "corrective", v)} placeholder="What, who, by when" />
                        <div className="mt-1.5 flex items-center gap-1">
                          <span className="mr-1 text-[11.5px] text-ink-3">Confidence</span>
                          {(["high", "medium", "low"] as const).map((c) => (
                            <button key={c} type="button" onClick={() => set(r.id, "confidence", x.confidence === c ? "" : c)}
                              className={cn("h-6 rounded-md px-2 text-[11.5px] capitalize ring-1 ring-inset", x.confidence === c ? "bg-ink text-canvas ring-ink" : "text-ink-2 ring-line-strong hover:bg-surface")}>{c}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 mt-4 flex items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur" style={{ boxShadow: "var(--shadow-card)" }}>
        <CheckCircle2 size={16} className={filled === rows.length ? "text-ok" : "text-ink-4"} />
        <span className="text-[13px] text-ink-2"><b className="tabular font-semibold text-ink">{filled}</b> of {rows.length} lines have {kind === "actuals" ? L.actual.toLowerCase() : L.forecast.toLowerCase()}</span>
        <span className="hidden text-[12px] text-ink-4 md:inline">Values in ₹ — “12.5L” and “1.2Cr” also work</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => save(false)}>Save draft</Button>
          <Button variant="primary" disabled={pending} onClick={() => save(true)}>{pending ? "Saving…" : "Submit inputs"}</Button>
        </div>
      </div>
    </div>
  );
}

function Note({ label, value, prior, onChange, placeholder, warn }: { label: string; value: string; prior: string | null; onChange: (v: string) => void; placeholder?: string; warn?: boolean }) {
  return (
    <label className="block">
      <span className={cn("mb-1 block text-[11.5px] font-medium", warn ? "text-bad" : "text-ink-3")}>{label}</span>
      <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={prior ? `Last: ${prior}` : placeholder ?? "Optional"}
        className={cn("w-full resize-none rounded-lg border bg-surface px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-ink-3", warn ? "border-bad/30" : "border-line")} />
    </label>
  );
}
