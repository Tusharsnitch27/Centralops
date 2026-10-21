"use client";
import { Fragment, useMemo, useRef, useState } from "react";
import { Download, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { saveActuals, submitProjections } from "@/server/sop/actions";
import { isDayLabel, metricLabel, weekShort } from "@/server/sop/model";
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
  const daily = labels.length > 1 && isDayLabel(labels[0]!);
  const weekly = !daily && (labels.length > 1 || labels[0] !== "");
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
      {daily ? <DailyGrid lines={lines} labels={labels} cols={cols} vals={vals} initial={initial} disabled={disabled} periodLabel={periodLabel}
        onChange={(k, v) => setVals((x) => ({ ...x, [k]: v }))} onBulk={(m) => setVals((x) => ({ ...x, ...m }))} /> : (
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
      </div>)}
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

const colName = (l: FormLine, d: string) => `${l.name}${d ? ` — ${d}` : ""}`;
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

/** Day-wise entry: one row per date, one column per line × warehouse. Template download / upload round-trips the same layout as Excel. */
function DailyGrid({ lines, labels, cols, vals, initial, disabled, periodLabel, onChange, onBulk }: {
  lines: FormLine[]; labels: string[]; cols: string[]; vals: Record<string, string>; initial: Record<string, string>; disabled?: boolean; periodLabel: string;
  onChange: (k: string, v: string) => void; onBulk: (m: Record<string, string>) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const colTotal = (lineId: string, d: string) => labels.reduce((a, lb) => a + (parse(vals[key(lineId, lb, d)] ?? "") || 0), 0);

  async function download() {
    const XLSX = await import("xlsx");
    const header = ["Date", "Day", ...lines.flatMap((l) => cols.map((d) => colName(l, d)))];
    const rows = labels.map((lb) => [lb, dayName(lb), ...lines.flatMap((l) => cols.map((d) => { const v = parse(vals[key(l.id, lb, d)] ?? ""); return v == null || Number.isNaN(v) ? null : v; }))]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = header.map((h, i) => ({ wch: i < 2 ? 11 : Math.max(10, Math.min(28, h.length + 2)) }));
    ws["!freeze"] = { xSplit: 2, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Day-wise");
    XLSX.writeFile(wb, `S&OP inputs - ${periodLabel}.xlsx`);
  }

  async function upload(f: File) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: null });
      const head = (aoa[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
      const byCol = new Map<number, { lineId: string; d: string }>();
      for (const l of lines) for (const d of cols) { const i = head.indexOf(colName(l, d).toLowerCase()); if (i >= 0) byCol.set(i, { lineId: l.id, d }); }
      const dateCol = head.indexOf("date");
      if (dateCol < 0 || !byCol.size) throw new Error("This doesn't look like the template — keep the header row as downloaded.");
      const want = new Set(labels);
      const next: Record<string, string> = {};
      let n = 0, skipped = 0;
      for (const row of aoa.slice(1)) {
        const raw = row[dateCol];
        const iso = raw instanceof Date ? new Date(raw.getTime() - raw.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(raw ?? "").trim().slice(0, 10);
        if (!want.has(iso)) { if (raw != null && raw !== "") skipped++; continue; }
        for (const [i, c] of byCol) {
          const v = row[i];
          if (v == null || v === "") continue;
          next[key(c.lineId, iso, c.d)] = String(typeof v === "number" ? Math.round(v * 100) / 100 : v).trim();
          n++;
        }
      }
      onBulk(next);
      setMsg({ ok: true, text: `${n} values filled from ${f.name}${skipped ? ` · ${skipped} rows outside ${periodLabel} ignored` : ""}. Review, then submit.` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't read that file" }); }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-3">Day-wise · {labels.length} days · {cols.filter(Boolean).join(" / ") || "total"}</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={download}><Download size={13} />Template</Button>
          <Button size="sm" disabled={disabled} onClick={() => file.current?.click()}><Upload size={13} />Upload filled</Button>
          <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </span>
      </div>
      {msg && <p className={cn("mb-2 rounded-md px-3 py-1.5 text-[12px]", msg.ok ? "bg-info-soft text-info" : "bg-bad-soft text-bad")}>{msg.text}</p>}
      <div className="max-h-[560px] overflow-auto rounded-lg border border-line">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th rowSpan={cols.length > 1 ? 2 : 1} className="sticky left-0 z-20 border-b border-r border-line bg-surface px-3 py-2 text-left font-medium text-ink-3">Date</th>
              {lines.map((l) => <th key={l.id} colSpan={cols.length} className="border-b border-l border-line px-2 py-1.5 text-center font-medium text-ink-2">{l.name} <span className="font-normal text-ink-4">{metricLabel(l.metric)}</span></th>)}
            </tr>
            {cols.length > 1 && <tr>{lines.map((l) => cols.map((d, i) => <th key={l.id + d} className={cn("border-b border-line px-2 py-1 text-right text-[11px] font-normal text-ink-4", i === 0 && "border-l")}>{d}</th>))}</tr>}
          </thead>
          <tbody>
            {labels.map((lb) => {
              const we = ["Sat", "Sun"].includes(dayName(lb));
              return (
                <tr key={lb} className={cn(lb === today && "[&>td]:bg-info-soft/40", we && "[&>td]:bg-subtle/40")}>
                  <td className="sticky left-0 z-[1] whitespace-nowrap border-r border-line bg-surface px-3 py-1 tabular text-ink-2">{Number(lb.slice(8))} <span className="text-[11px] text-ink-4">{dayName(lb)}</span></td>
                  {lines.map((l) => cols.map((d, i) => {
                    const k = key(l.id, lb, d);
                    return (
                      <td key={k} className={cn("px-1 py-0.5", i === 0 && "border-l border-line")}>
                        <input inputMode="decimal" disabled={disabled} value={vals[k] ?? ""} onChange={(e) => onChange(k, e.target.value)} aria-label={`${colName(l, d)} ${lb}`}
                          className={cn("h-7 w-[88px] rounded border bg-surface px-1.5 text-right tabular outline-none focus:border-ink-3 disabled:bg-subtle disabled:text-ink-3",
                            Number.isNaN(parse(vals[k] ?? "")) ? "border-bad" : vals[k] !== initial[k] ? "border-info/50 bg-info-soft/40" : "border-transparent hover:border-line")} />
                      </td>
                    );
                  }))}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-surface">
            <tr>
              <td className="sticky left-0 z-[1] border-r border-t border-line bg-surface px-3 py-1.5 font-medium">Month</td>
              {lines.map((l) => cols.map((d, i) => <td key={l.id + d} className={cn("border-t border-line px-2 py-1.5 text-right font-semibold tabular", i === 0 && "border-l")}>{num(colTotal(l.id, d) || null)}</td>))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
