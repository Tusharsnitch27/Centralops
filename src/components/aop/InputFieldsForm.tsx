"use client";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { saveInputConfig, type InputConfig } from "@/server/aop/actions";
import type { Labels } from "@/server/aop/calc";

/** Which fields owners fill in on the Inputs table. */
export function InputFieldsForm({ cycleId, config, labels: L, canEdit }: { cycleId: string; config: InputConfig; labels: Labels; canEdit: boolean }) {
  const [fields, setFields] = useState(new Set(config.fields));
  const [ownerPlan, setOwnerPlan] = useState(config.ownerCanEditPlan);
  const [pending, start] = useTransition();
  const toast = useToast();
  const opts: [string, string, string][] = [
    ["plan", L.plan, "Monthly budget per line"], ["forecast", L.forecast, "Owner's estimate before invoices land"],
    ["actual", L.actual, "Invoiced / booked amount"], ["commentary", "Remark", "Free-text note per line per month"],
  ];
  const toggle = (k: string) => setFields((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Card>
      <CardHeader title="Input fields" subtitle="Columns owners can fill on the Inputs table" />
      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {opts.map(([k, label, hint]) => (
          <button key={k} type="button" disabled={!canEdit} onClick={() => toggle(k)}
            className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors", fields.has(k) ? "border-ink-3 bg-subtle" : "border-line hover:border-line-strong")}>
            <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", fields.has(k) ? "border-ink bg-ink text-canvas" : "border-line-strong")}>{fields.has(k) && <Check size={11} strokeWidth={3} />}</span>
            <span><span className="block text-[13px] font-medium text-ink">{label}</span><span className="text-[12px] text-ink-3">{hint}</span></span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={ownerPlan} disabled={!canEdit} onChange={(e) => setOwnerPlan(e.target.checked)} className="accent-current" />
          Owners can edit {L.plan.toLowerCase()} (otherwise PM only)
        </label>
        {canEdit && <Button className="ml-auto" variant="primary" disabled={pending} onClick={() => start(async () => {
          const r = await saveInputConfig({ cycleId, config: { fields: [...fields], ownerCanEditPlan: ownerPlan, requireReasonOverThreshold: config.requireReasonOverThreshold } });
          toast(r.ok ? "Input fields saved" : r.error, r.ok ? "success" : "error");
        })}>Save</Button>}
      </div>
    </Card>
  );
}
