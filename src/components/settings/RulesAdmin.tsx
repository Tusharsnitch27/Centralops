"use client";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { updateInsightRule } from "@/server/settings/actions";
import type { InsightRuleAdmin } from "@/server/settings/queries";
import { Toggle, useAction } from "./bits";

const MODULE_LABEL: Record<string, string> = { tasks: "Tasks", projects: "Projects", aop: "AOP", sop: "S&OP" };
const SEV_DOT: Record<string, string> = { info: "bg-info", warning: "bg-warn", critical: "bg-bad" };
const DAY_RULES = new Set(["tasks.no_update", "projects.milestone_slip"]);

/** Editable fields: thresholds (shown as % for ratios, days for day rules) and periods. Everything else is read-only. */
export function RulesAdmin({ rules, canEdit }: { rules: InsightRuleAdmin[]; canEdit: boolean }) {
  return (
    <div className="card overflow-hidden">
      <table className="table-base">
        <thead><tr><th className="w-12">On</th><th>Rule</th><th>Module</th><th>Threshold</th><th>Severity</th><th /></tr></thead>
        <tbody>{rules.map((r) => <RuleRow key={r.id} r={r} canEdit={canEdit} />)}</tbody>
      </table>
    </div>
  );
}

function RuleRow({ r, canEdit }: { r: InsightRuleAdmin; canEdit: boolean }) {
  const isDays = DAY_RULES.has(r.key ?? "");
  const thr = typeof r.rule.threshold === "number" ? (r.rule.threshold as number) : null;
  const per = typeof r.rule.periods === "number" ? (r.rule.periods as number) : null;
  const [threshold, setThreshold] = useState(thr == null ? "" : String(isDays ? thr : Math.round(thr * 1000) / 10));
  const [periods, setPeriods] = useState(per == null ? "" : String(per));
  const [severity, setSeverity] = useState(r.severity);
  const { pending, run } = useAction();
  const dirty = (thr != null && threshold !== String(isDays ? thr : Math.round(thr * 1000) / 10)) || (per != null && periods !== String(per)) || severity !== r.severity;
  const save = () => {
    const values: Record<string, number> = {};
    if (thr != null) values.threshold = isDays ? Number(threshold) : Number(threshold) / 100;
    if (per != null) values.periods = Number(periods);
    run(() => updateInsightRule(r.id, { values, severity }));
  };
  return (
    <tr className={cn(!r.enabled && "opacity-60")}>
      <td><Toggle checked={r.enabled} disabled={!canEdit || pending} label={r.name} onChange={(v) => run(() => updateInsightRule(r.id, { enabled: v }))} /></td>
      <td className="max-w-[420px] py-2.5">
        <div className="font-medium text-ink">{r.name}</div>
        {r.description && <div className="text-[12px] leading-snug text-ink-3">{r.description}</div>}
      </td>
      <td><Badge>{MODULE_LABEL[r.module] ?? r.module}</Badge></td>
      <td>
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          {thr != null ? (
            <span className="inline-flex items-center gap-1">
              <input type="number" min={0} max={isDays ? 100 : 100} step={isDays ? 1 : 0.5} value={threshold} disabled={!canEdit} onChange={(e) => setThreshold(e.target.value)} className="field h-7 w-[72px] px-2 py-0 text-right text-[12.5px] tabular" />
              {isDays ? "days" : "%"}
            </span>
          ) : <span className="text-ink-4">—</span>}
          {per != null && (
            <span className="inline-flex items-center gap-1">×<input type="number" min={1} max={12} value={periods} disabled={!canEdit} onChange={(e) => setPeriods(e.target.value)} className="field h-7 w-[56px] px-2 py-0 text-right text-[12.5px] tabular" />months</span>
          )}
        </div>
      </td>
      <td>
        <span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", SEV_DOT[severity] ?? "bg-ink-4")} />
        <select value={severity} disabled={!canEdit} onChange={(e) => setSeverity(e.target.value)} className="field h-7 w-auto py-0 pr-7 text-[12.5px]">
          {(["info", "warning", "critical"] as const).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
      </td>
      <td className="text-right">{canEdit && dirty && <Button size="xs" variant="primary" disabled={pending} onClick={save}>Save</Button>}</td>
    </tr>
  );
}
