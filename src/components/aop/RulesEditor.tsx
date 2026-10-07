"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Field } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { deleteRule, saveRule, toggleRule } from "@/server/aop/actions";
import type { InsightRule, Severity } from "@/server/aop/insights";

type MetricKinds = Record<string, { label: string; hasThreshold: boolean; hasPeriods: boolean }>;
interface Draft { id: string | null; name: string; description: string; metric: string; threshold: string; periods: string; min_amount: string; severity: Severity; enabled: boolean }
const SEV_DOT: Record<Severity, string> = { critical: "bg-bad", warning: "bg-warn", info: "bg-info" };

export function RulesEditor({ rules, metrics, canEdit }: { rules: InsightRule[]; metrics: MetricKinds; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const open = (r?: InsightRule) => setDraft(r ? {
    id: r.id, name: r.name, description: r.description ?? "", metric: r.rule.metric, severity: r.severity, enabled: r.enabled,
    threshold: r.rule.threshold != null ? String(+(r.rule.threshold * 100).toFixed(2)) : "", periods: r.rule.periods != null ? String(r.rule.periods) : "",
    min_amount: r.rule.min_amount != null ? String(r.rule.min_amount) : "",
  } : { id: null, name: "", description: "", metric: "actual_vs_plan", threshold: "10", periods: "1", min_amount: "", severity: "warning", enabled: true });
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error ?? "Failed", "error");
    toast(r.message ?? "Saved", "success"); setDraft(null); router.refresh();
  });
  const mk = draft ? metrics[draft.metric] : null;

  return (
    <Card>
      <CardHeader title="Rules" subtitle={canEdit ? "Enable, tune or add rules" : "Configured by the PM"} icon={<SlidersHorizontal size={15} />}
        action={canEdit ? <Button size="xs" variant="ghost" onClick={() => open()}><Plus size={13} />New</Button> : null} />
      {rules.map((r) => (
        <div key={r.id} className={cn("flex items-start gap-3 border-b border-line/70 px-4 py-3 last:border-0", !r.enabled && "opacity-60")}>
          <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", SEV_DOT[r.severity])} />
          <button type="button" disabled={!canEdit} onClick={() => open(r)} className="min-w-0 flex-1 text-left">
            <div className="text-[13px] font-medium text-ink">{r.name}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-3">
              {[r.rule.threshold != null && `> ${+(r.rule.threshold * 100).toFixed(1)}%`, r.rule.periods != null && `${r.rule.periods} ${r.rule.periods === 1 ? "month" : "months"}`, r.severity].filter(Boolean).join(" · ")}
            </div>
          </button>
          {canEdit && (
            <button type="button" role="switch" aria-checked={r.enabled} disabled={pending} onClick={() => run(() => toggleRule(r.id, !r.enabled))}
              className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", r.enabled ? "bg-ink" : "bg-muted ring-1 ring-inset ring-line-strong")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", r.enabled ? "left-[18px]" : "left-0.5")} />
            </button>
          )}
        </div>
      ))}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit rule" : "New rule"} width={480}
        footer={draft && <>
          {draft.id && !rules.find((r) => r.id === draft.id)?.builtin && <Button variant="danger" className="mr-auto" onClick={() => run(() => deleteRule(draft.id!))}><Trash2 size={13} />Remove</Button>}
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => run(() => saveRule({
            id: draft.id, name: draft.name, description: draft.description || null, metric: draft.metric, severity: draft.severity, enabled: draft.enabled,
            threshold: mk?.hasThreshold && draft.threshold !== "" ? Number(draft.threshold) / 100 : null,
            periods: mk?.hasPeriods && draft.periods !== "" ? Math.max(1, Math.round(Number(draft.periods))) : null,
            min_amount: draft.min_amount !== "" ? Number(draft.min_amount) : null,
          }))}>Save rule</Button>
        </>}>
        {draft && (
          <div className="space-y-3 pt-1">
            <Field label="Name"><input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Checks">
              <select className="field" value={draft.metric} disabled={!!draft.id && !!rules.find((r) => r.id === draft.id)?.builtin} onChange={(e) => setDraft({ ...draft, metric: e.target.value })}>
                {Object.entries(metrics).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {mk?.hasThreshold && <Field label="Threshold %"><input className="field tabular" inputMode="decimal" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} /></Field>}
              {mk?.hasPeriods && <Field label="Months" hint={draft.metric === "actual_vs_plan" ? "≥2 = consecutive" : "look-back"}><input className="field tabular" inputMode="numeric" value={draft.periods} onChange={(e) => setDraft({ ...draft, periods: e.target.value })} /></Field>}
              <Field label="Min ₹" hint="materiality"><input className="field tabular" inputMode="numeric" placeholder="auto" value={draft.min_amount} onChange={(e) => setDraft({ ...draft, min_amount: e.target.value })} /></Field>
            </div>
            <Field label="Severity">
              <div className="flex gap-1.5">
                {(["critical", "warning", "info"] as Severity[]).map((s) => (
                  <button key={s} type="button" onClick={() => setDraft({ ...draft, severity: s })}
                    className={cn("flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] capitalize ring-1 ring-inset", draft.severity === s ? "bg-ink text-canvas ring-ink" : "text-ink-2 ring-line-strong hover:bg-subtle")}>
                    <span className={cn("size-1.5 rounded-full", SEV_DOT[s])} />{s}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Description"><textarea className="field resize-none" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
