"use client";
import { Fragment, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { saveActuals, submitProjections } from "@/server/sop/actions";
import { metricLabel, weekShort } from "@/server/sop/model";
import { useSopAction } from "./actions";

export interface FormLine { id: string; name: string; metric: string | null }
export interface FormCell { projection: number | null; revised: number | null; actual: number | null; demo: boolean }

const key = (lineId: string, label: string, dim: string) => `${lineId}|${label}|${dim}`;
const parse = (s: string) => { const t = s.replace(/[, ]/g, "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

/**
 * Grid editor for one stream × month. mode 'projection' writes projections (revisions once the month has started);
 * mode 'actual' writes manual actuals.
 */
export function ValuesForm({ mode, streamId, period, periodLabel, lines, labels, dims, cells, prev, started, disabled, disabledReason, submitLabel }: {
  mode: "projection" | "actual";
  streamId: string; period: string; periodLabel: string;
  lines: FormLine[]; labels: string[]; dims: string[];
  cells: Record<string, FormCell>;
  prev?: Record<string, number | null>;   // previous month total per line|dim (projection mode, monthly)
  started?: boolean; disabled?: boolean; disabledReason?: string; submitLabel?: string;
}) {
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of lines) for (const lb of labels) for (const d of dims) {
      const c = cells[key(l.id, lb, d)];
      const v = mode === "actual" ? c?.actual : c ? c.revised ?? c.projection : null;
      m[key(l.id, lb, d)] = v == null ? "" : String(Math.round(v * 100) / 100);
    }
    return m;
  }, [lines, labels, dims, cells, mode]);
  const [vals, setVals] = useState(initial);
  const [note, setNote] = useState("");
  const { pending, run } = useSopAction();
  const dirty = Object.keys(vals).filter((k) => vals[k] !== initial[k]);
  const invalid = Object.values(vals).some((v) => Number.isNaN(parse(v)));
  const weekly = labels.length > 1 || labels[0] !== "";
  const showPrev = mode === "projection" && !weekly && !!prev;
  const cols = dims.length ? dims : [""];

  const total = (lineId: string, label?: string) => cols.reduce((a, d) => a + (parse(vals[key(lineId, label ?? "", d)] ?? "") || 0), 0);

  const submit = () => {
    const entries = Object.keys(vals).filter((k) => mode === "projection" ? vals[k] !== "" || initial[k] !== "" : vals[k] !== initial[k]).map((k) => {
      const [lineId, label, dimension] = k.split("|");
      return { lineId: lineId!, label: label!, dimension: dimension!, value: parse(vals[k]!) };
    });
    run(() => mode === "projection"
      ? submitProjections({ streamId, period, entries, note })
      : saveActuals({ streamId, period, entries }), (r) => { if (r.ok) setNote(""); });
  };

  const input = (k: string, c: FormCell | undefined) => (
    <div className="relative">
      <input inputMode="decimal" disabled={disabled} value={vals[k] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
        className={cn("h-8 w-full rounded-md border bg-surface px-2 text-right text-[13px] tabular outline-none transition focus:border-ink-3 focus:ring-4 focus:ring-ink/5 disabled:bg-subtle disabled:text-ink-3",
          Number.isNaN(parse(vals[k] ?? "")) ? "border-bad" : vals[k] !== initial[k] ? "border-info/50 bg-info-soft/40" : "border-line")} />
      {mode === "projection" && started && c?.projection != null && (c.revised != null || vals[k] !== initial[k]) && (
        <div className="mt-0.5 text-right text-[10.5px] text-ink-4">baseline {num(c.projection)}</div>
      )}
      {mode === "actual" && c && (c.revised ?? c.projection) != null && <div className="mt-0.5 text-right text-[10.5px] text-ink-4">proj {num(c.revised ?? c.projection)}{c.demo ? " · demo" : ""}</div>}
    </div>
  );

  return (
    <div>
      {mode === "projection" && started && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
          <Lock size={13} className="text-ink-3" />{periodLabel} has started — changes are stored as revisions; the locked projection stays as the baseline for accuracy.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="table-base">
          <thead className="bg-subtle/50">
            <tr>
              <th className="w-[38%]">Line</th>
              {weekly && <th>Week</th>}
              {showPrev && <th className="text-right">Prev month</th>}
              {cols.map((d) => <th key={d} className="w-36 text-right">{d || (mode === "actual" ? "Actual" : "Projection")}</th>)}
              {dims.length > 1 && <th className="w-28 text-right">Total</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Fragment key={l.id}>
                {labels.map((lb, i) => (
                  <tr key={lb} className={cn(weekly && i > 0 && "[&>td]:border-t-0")}>
                    <td className={cn(weekly && i > 0 && "text-transparent")}>
                      {i === 0 && <><span className="text-ink">{l.name}</span> <span className="ml-1 text-[11.5px] text-ink-4">{metricLabel(l.metric)}</span></>}
                    </td>
                    {weekly && <td className="text-[12.5px] text-ink-3" title={lb}>{weekShort(lb)}</td>}
                    {showPrev && <td className="text-right tabular text-ink-3">{num(cols.reduce((a, d) => a + (prev![`${l.id}|${d}`] ?? 0), 0) || null)}</td>}
                    {cols.map((d) => <td key={d} className="py-1.5">{input(key(l.id, lb, d), cells[key(l.id, lb, d)])}</td>)}
                    {dims.length > 1 && <td className="text-right tabular text-ink-2">{num(total(l.id, lb) || null)}</td>}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {mode === "projection" && (
          <label className="min-w-[260px] flex-1"><span className="label">Commentary (optional)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Events, assumptions, % BAU uplift…" disabled={disabled} />
          </label>
        )}
        <div className="ml-auto flex items-center gap-3">
          {disabled && disabledReason && <span className="text-[12px] text-ink-3">{disabledReason}</span>}
          {!disabled && <span className="text-[12px] text-ink-3">{dirty.length ? `${dirty.length} change${dirty.length === 1 ? "" : "s"}` : mode === "projection" ? "Submitting confirms the values as they are" : "No changes"}</span>}
          <Button variant="primary" size="md" disabled={disabled || pending || invalid || (mode === "actual" && !dirty.length)} onClick={submit}>
            {pending ? "Saving…" : submitLabel ?? (mode === "projection" ? `Submit ${periodLabel}` : "Save actuals")}
          </Button>
        </div>
      </div>
    </div>
  );
}
