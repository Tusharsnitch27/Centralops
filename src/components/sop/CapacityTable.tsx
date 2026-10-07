"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { addCapacityDepartment, saveCapacity } from "@/server/sop/actions";
import { CreateActionButton, useSopAction, type PersonOpt } from "./actions";

export interface CapCell { required: number | null; available: number | null; remarks: string | null }
export interface CapLine { department: string; South: CapCell; North: CapCell }
type WH = "South" | "North";

const parse = (s: string) => { const t = s.replace(/[, ]/g, "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

function NumCell({ value, onSave, disabled, className }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean; className?: string }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value == null ? "" : String(value));
  if (!edit || disabled)
    return (
      <button type="button" disabled={disabled} onClick={() => { setV(value == null ? "" : String(value)); setEdit(true); }}
        className={cn("w-full rounded px-1.5 py-1 text-right tabular transition hover:bg-subtle disabled:hover:bg-transparent", value == null && "text-ink-4", className)} title={disabled ? undefined : "Click to edit"}>
        {value == null ? "—" : num(value)}
      </button>
    );
  const commit = () => { setEdit(false); const n = parse(v); if (Number.isNaN(n) || n === value) return; onSave(n); };
  return <input autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(false); }}
    className="h-7 w-full rounded border border-ink-3 bg-surface px-1.5 text-right text-[13px] tabular outline-none ring-4 ring-ink/5" />;
}

function RemarkCell({ value, onSave, disabled }: { value: string | null; onSave: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(value ?? "");
  return <input disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? "") && onSave(v)}
    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="Add remark…"
    className="h-7 w-full min-w-[120px] rounded border border-transparent bg-transparent px-1.5 text-[12px] text-ink-2 outline-none placeholder:text-ink-4 hover:border-line focus:border-ink-3 focus:bg-surface" />;
}

export function CapacityTable({ period, periodLabel, lines, people, canEdit, defaultOwnerId, threshold }: {
  period: string; periodLabel: string; lines: CapLine[]; people: PersonOpt[]; canEdit: boolean; defaultOwnerId: string | null; threshold: number;
}) {
  const { pending, run } = useSopAction();
  const [newDept, setNewDept] = useState("");
  const save = (department: string, warehouse: WH, patch: Partial<CapCell>) => run(() => saveCapacity({ period, department, warehouse, ...patch }));
  const gap = (c: CapCell) => (c.required != null && c.available != null ? c.available - c.required : null);
  const breach = (c: CapCell) => c.required != null && c.available != null && c.required - c.available > threshold * (c.available || 1);
  const tot = (wh: WH, k: "required" | "available") => lines.reduce((a, l) => a + (l[wh][k] ?? 0), 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr className="[&>th]:h-7 [&>th]:border-b-0">
              <th />
              <th colSpan={3} className="border-l border-line text-center">South · BLR</th>
              <th colSpan={3} className="border-l border-line text-center">North · GGN</th>
              <th colSpan={2} className="border-l border-line" />
            </tr>
            <tr>
              <th className="min-w-[200px]">Department</th>
              {(["South", "North"] as const).map((wh) => (
                <th key={wh} colSpan={3} className="border-l border-line p-0">
                  <div className="grid grid-cols-3 text-right [&>span]:px-3"><span>Required</span><span>Available</span><span>Δ</span></div>
                </th>
              ))}
              <th className="border-l border-line">Remarks (S / N)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const breaches = (["South", "North"] as const).filter((wh) => breach(l[wh]));
              return (
                <tr key={l.department} className={cn(breaches.length && "bg-bad-soft/30")}>
                  <td className="font-medium text-ink">{l.department}</td>
                  {(["South", "North"] as const).map((wh) => {
                    const g = gap(l[wh]);
                    return [
                      <td key={`${wh}r`} className="w-24 border-l border-line px-1.5"><NumCell value={l[wh].required} disabled={!canEdit} onSave={(v) => save(l.department, wh, { required: v })} /></td>,
                      <td key={`${wh}a`} className="w-24 px-1.5"><NumCell value={l[wh].available} disabled={!canEdit} onSave={(v) => save(l.department, wh, { available: v })} /></td>,
                      <td key={`${wh}d`} className={cn("w-20 text-right tabular", g == null ? "text-ink-4" : breach(l[wh]) ? "font-medium text-bad" : g < 0 ? "text-warn" : "text-ink-3")}>{g == null ? "—" : num(g, { sign: true })}</td>,
                    ];
                  })}
                  <td className="border-l border-line py-1">
                    <RemarkCell value={l.South.remarks} disabled={!canEdit} onSave={(v) => save(l.department, "South", { remarks: v })} />
                    <RemarkCell value={l.North.remarks} disabled={!canEdit} onSave={(v) => save(l.department, "North", { remarks: v })} />
                  </td>
                  <td className="text-right">
                    {breaches.length > 0 && (
                      <CreateActionButton people={people} label="Action" variant="ghost"
                        defaults={{
                          title: `Close ${l.department} capacity gap — ${breaches.join(" & ")} · ${periodLabel}`,
                          description: breaches.map((wh) => `${wh}: needs ${num(l[wh].required)}/day vs ${num(l[wh].available)} available (${num((l[wh].required ?? 0) - (l[wh].available ?? 0))} short).`).join("\n") + "\nOptions: temp manpower, OT / second shift, shift volume to the other warehouse.",
                          ownerId: defaultOwnerId,
                        }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="[&>td]:h-10 [&>td]:border-t [&>td]:border-line [&>td]:px-3 [&>td]:text-[12.5px] [&>td]:font-medium">
              <td className="text-ink-2">Total</td>
              {(["South", "North"] as const).map((wh) => [
                <td key={`${wh}r`} className="border-l border-line text-right tabular">{num(tot(wh, "required"))}</td>,
                <td key={`${wh}a`} className="text-right tabular">{num(tot(wh, "available"))}</td>,
                <td key={`${wh}d`} className={cn("text-right tabular", tot(wh, "available") - tot(wh, "required") < 0 ? "text-bad" : "text-ink-3")}>{num(tot(wh, "available") - tot(wh, "required"), { sign: true })}</td>,
              ])}
              <td className="border-l border-line" /><td />
            </tr>
          </tfoot>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <input className="field h-8 max-w-xs py-1 text-[12.5px]" value={newDept} onChange={(e) => setNewDept(e.target.value)} placeholder="Add department, e.g. B2B-Retail Store Return" />
          <Button size="sm" disabled={pending || !newDept.trim()} onClick={() => run(() => addCapacityDepartment(period, newDept), (r) => r.ok && setNewDept(""))}><Plus size={13} />Add</Button>
          <span className="ml-auto text-[11.5px] text-ink-4">Units per day · click a number to edit · Enter to save</span>
        </div>
      )}
    </div>
  );
}
