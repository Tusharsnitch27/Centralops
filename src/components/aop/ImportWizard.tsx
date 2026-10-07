"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Save, Upload, Wand2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Field } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { saveImportTemplate } from "@/server/aop/actions";
import { cycleMonths, monLabel, type Measure } from "@/server/aop/calc";
import { columnLabels, detectHeader, extractRecords, FIELD_LABEL, str, suggestColumns, type Cell, type ColumnMap, type Field as F, type ImportMapping } from "@/server/aop/importParse";

interface CycleOpt { id: string; name: string; fy_start: string; kind: string }
interface Template { id: string; name: string; header_rows: number; mapping: unknown }
interface Parsed { token: string; fileName: string; sheets: { name: string; rows: number; cols: number }[] }

const FIELDS: F[] = ["ignore", "function", "group", "line", "owner", "metric", "unit", "annual", "period", "month", "value"];
const MEAS: [Measure, string][] = [["plan", "Plan / Budget"], ["forecast", "Forecast / Provision"], ["actual", "Actual"]];

export function ImportWizard({ cycles, templates, defaultCycle, functions }: { cycles: CycleOpt[]; templates: Template[]; defaultCycle: string | null; functions: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [target, setTarget] = useState<string>(defaultCycle ?? "new");
  const [nc, setNc] = useState({ name: "", kind: "cost" as "cost" | "revenue" | "mixed", fy_start: "2026-04" });
  const fyStart = target === "new" ? `${nc.fy_start}-01` : cycles.find((c) => c.id === target)?.fy_start ?? "2026-04-01";
  const [mp, setMp] = useState<ImportMapping | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplId, setTplId] = useState<string | null>(null);
  const [result, setResult] = useState<{ cycleId: string; lines: number; values: number; createdSections: number; createdItems: number; skipped: number } | null>(null);

  const upload = async (f: File) => {
    setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/aop/import", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setParsed(d);
      const best = (d.sheets as Parsed["sheets"]).find((s) => /logistic|saas|plan|budget|aop|cost/i.test(s.name) && s.rows > 3) ?? d.sheets[0];
      await pickSheet(d.token, best.name);
    } catch (e) { toast(e instanceof Error ? e.message : "Upload failed", "error"); }
    setBusy(false);
  };
  const pickSheet = async (token: string, name: string) => {
    setSheet(name); setRows(null); setMp(null);
    const r = await fetch(`/api/aop/import?token=${encodeURIComponent(token)}&sheet=${encodeURIComponent(name)}`);
    const d = await r.json();
    if (!r.ok) { toast(d.error, "error"); return; }
    setRows(d.rows);
    const h = detectHeader(d.rows, fyStart);
    setMp({ ...h, columns: suggestColumns(d.rows, h.headerRow, h.groupRow, fyStart), defaults: { function: guessFn(name, functions) }, skipTotals: true, carryDown: true });
  };
  const reHeader = (headerRow: number, groupRow: number | null) => {
    if (!rows || !mp) return;
    setMp({ ...mp, headerRow, groupRow, columns: suggestColumns(rows, headerRow, groupRow, fyStart) });
  };
  const setCol = (index: number, patch: Partial<ColumnMap>) => mp && setMp({ ...mp, columns: mp.columns.map((c) => (c.index === index ? { ...c, ...patch } : c)) });
  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t || !rows) return;
    const m = t.mapping as ImportMapping;
    setTplId(id); setTplName(t.name);
    setMp({ ...m, columns: m.columns.filter((c) => c.index < (rows[0]?.length ?? 0)) });
  };

  const labels = useMemo(() => (rows && mp ? columnLabels(rows, mp.headerRow, mp.groupRow) : []), [rows, mp]);
  const preview = useMemo(() => (rows && mp ? extractRecords(rows, mp, fyStart) : null), [rows, mp, fyStart]);
  const months = useMemo(() => cycleMonths(fyStart, 15).slice(0, 15), [fyStart]);
  const dataStart = mp ? Math.max(mp.headerRow, mp.groupRow ?? -1) + 1 : 0;
  const width = rows?.[0]?.length ?? 0;
  const usedCols = mp ? mp.columns.filter((c) => (rows ?? []).slice(0, 60).some((r) => str(r[c.index]))) : [];

  const runImport = () => start(async () => {
    if (!parsed || !mp) return;
    const r = await fetch("/api/aop/import", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: parsed.token, sheet, mapping: mp, target: target === "new" ? { newCycle: { ...nc, fy_start: `${nc.fy_start}-01` } } : { cycleId: target }, templateId: tplId }) });
    const d = await r.json();
    if (!r.ok) return toast(d.error ?? "Import failed", "error");
    setResult(d); toast(`Imported ${d.lines} lines`, "success"); router.refresh();
  });
  const saveTpl = () => start(async () => {
    if (!mp) return;
    const r = await saveImportTemplate({ id: tplId, name: tplName || `${sheet} layout`, headerRows: mp.groupRow != null ? 2 : 1, mapping: mp });
    if (!r.ok) return toast(r.error, "error");
    setTplId(r.data!.id); toast("Template saved", "success"); router.refresh();
  });

  return (
    <div className="space-y-5">
      {/* 1 · file */}
      <Card>
        <CardHeader title="1 · File" subtitle="Excel (.xlsx/.xls) or CSV — parsed on the server, nothing is imported until you confirm" icon={<FileSpreadsheet size={15} />} />
        <div className="flex flex-wrap items-center gap-3 p-4">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant={parsed ? "secondary" : "primary"} onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} />{busy ? "Reading…" : parsed ? "Choose another file" : "Choose file"}</Button>
          {parsed && <span className="text-[13px] text-ink-2">{parsed.fileName} · {parsed.sheets.length} sheets</span>}
          {parsed && (
            <select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={sheet} onChange={(e) => pickSheet(parsed.token, e.target.value)}>
              {parsed.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>)}
            </select>
          )}
          {parsed && templates.length > 0 && (
            <select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={tplId ?? ""} onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
              <option value="">Apply saved template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
      </Card>

      {rows && mp && (
        <>
          {/* 2 · header + columns */}
          <Card className="min-w-0">
            <CardHeader title="2 · Map columns" icon={<Wand2 size={15} />}
              subtitle="Auto-suggested from header text (months, Budget / Provision / Actual, Function, Owner…). Adjust anything that's off." />
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
              <Field label="Header row"><select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={mp.headerRow} onChange={(e) => reHeader(Number(e.target.value), mp.groupRow != null && mp.groupRow < Number(e.target.value) ? mp.groupRow : null)}>
                {rows.slice(0, 20).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.map(str).filter(Boolean).slice(0, 4).join(" | ").slice(0, 50) || "(empty)"}</option>)}</select></Field>
              <Field label="Header rows"><select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={mp.groupRow == null ? "1" : String(mp.groupRow)}
                onChange={(e) => reHeader(mp.headerRow, e.target.value === "1" ? null : Number(e.target.value))}>
                <option value="1">1 row</option>
                {Array.from({ length: mp.headerRow }, (_, i) => i).reverse().slice(0, 4).map((i) => <option key={i} value={i}>2 rows · labels from row {i + 1}</option>)}
              </select></Field>
              <Field label="Default function"><input className="field h-8 py-1 text-[12.5px]" list="imp-fns" value={mp.defaults.function ?? ""} onChange={(e) => setMp({ ...mp, defaults: { ...mp.defaults, function: e.target.value } })} />
                <datalist id="imp-fns">{functions.map((f) => <option key={f} value={f} />)}</datalist></Field>
              <Field label="Direction"><select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={mp.defaults.direction ?? ""} onChange={(e) => setMp({ ...mp, defaults: { ...mp.defaults, direction: (e.target.value || undefined) as never } })}>
                <option value="">From cycle kind</option><option value="lower_better">Lower is better (cost)</option><option value="higher_better">Higher is better (revenue)</option></select></Field>
              <label className="flex h-8 items-center gap-1.5 text-[12.5px] text-ink-2"><input type="checkbox" checked={mp.carryDown} onChange={(e) => setMp({ ...mp, carryDown: e.target.checked })} />Block headers carry down</label>
              <label className="flex h-8 items-center gap-1.5 text-[12.5px] text-ink-2"><input type="checkbox" checked={mp.skipTotals} onChange={(e) => setMp({ ...mp, skipTotals: e.target.checked })} />Skip total rows</label>
            </div>
            <div className="scroll-thin max-h-[420px] overflow-auto">
              <table className="table-base">
                <thead className="sticky top-0 z-10 bg-surface"><tr><th>Col</th><th>Header</th><th>Sample</th><th className="w-[170px]">Field</th><th className="w-[260px]">Month · measure</th></tr></thead>
                <tbody>
                  {usedCols.map((c) => {
                    const l = labels[c.index];
                    const sample = rows.slice(dataStart, dataStart + 40).map((r) => str(r[c.index])).filter(Boolean).slice(0, 3);
                    return (
                      <tr key={c.index} className={cn(c.field === "ignore" && "opacity-60")}>
                        <td className="font-mono text-[11px] text-ink-4">{colName(c.index)}</td>
                        <td className="max-w-[220px] truncate text-ink">{l?.label || <span className="text-ink-4">—</span>}</td>
                        <td className="max-w-[220px] truncate text-[12px] text-ink-3">{sample.join(" · ")}</td>
                        <td>
                          <select className="field h-8 py-1 text-[12.5px]" value={c.field} onChange={(e) => setCol(c.index, { field: e.target.value as F, measure: c.measure ?? "plan" })}>
                            {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                          </select>
                        </td>
                        <td>
                          {(c.field === "period" || c.field === "value") && (
                            <div className="flex gap-1.5">
                              {c.field === "period" && (
                                <select className="field h-8 py-1 text-[12.5px]" value={c.period ?? ""} onChange={(e) => setCol(c.index, { period: e.target.value })}>
                                  <option value="">Month…</option>{months.map((p) => <option key={p} value={p}>{monLabel(p)}</option>)}
                                </select>
                              )}
                              <select className="field h-8 py-1 text-[12.5px]" value={c.measure ?? "plan"} onChange={(e) => setCol(c.index, { measure: e.target.value as Measure })}>
                                {MEAS.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                              </select>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">{usedCols.length} of {width} columns have data · data starts at row {dataStart + 1}</div>
          </Card>

          {/* 3 · preview + target */}
          <Card className="min-w-0">
            <CardHeader title="3 · Preview & import" subtitle={preview ? `${preview.records.length} lines · ${preview.records.reduce((a, r) => a + r.values.length, 0)} values · ${preview.skipped} rows skipped` : ""} />
            {preview?.warnings.map((w) => <div key={w} className="border-b border-line bg-warn-soft/50 px-4 py-2 text-[12.5px] text-warn">{w}</div>)}
            <div className="scroll-thin max-h-[340px] overflow-auto">
              <table className="table-base">
                <thead className="sticky top-0 z-10 bg-surface"><tr><th>Function</th><th>Group</th><th>Line</th><th>Owner</th><th className="text-right">Months</th><th className="text-right">Plan total</th><th className="text-right">Actual total</th></tr></thead>
                <tbody>
                  {preview?.records.slice(0, 60).map((r) => (
                    <tr key={`${r.row}${r.line}`}>
                      <td className="text-ink-2">{r.fn}</td><td className="text-ink-3">{r.group ?? "—"}</td><td className="text-ink">{r.line}</td><td className="text-ink-3">{r.owner ?? ""}</td>
                      <td className="text-right tabular text-ink-3">{new Set(r.values.map((v) => v.period)).size}</td>
                      <td className="text-right tabular">{inr(r.values.filter((v) => v.measure === "plan").reduce((a, v) => a + v.value, 0) || r.annual)}</td>
                      <td className="text-right tabular">{inr(r.values.filter((v) => v.measure === "actual").reduce((a, v) => a + v.value, 0) || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3">
              <Field label="Import into">
                <select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="new">+ New cycle…</option>
                </select>
              </Field>
              {target === "new" && <>
                <Field label="Cycle name"><input className="field h-8 py-1 text-[12.5px]" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="Revenue plan · FY 27-28" /></Field>
                <Field label="Kind"><select className="field h-8 w-auto py-1 pr-7 text-[12.5px]" value={nc.kind} onChange={(e) => setNc({ ...nc, kind: e.target.value as typeof nc.kind })}><option value="cost">Cost</option><option value="revenue">Revenue / target</option><option value="mixed">Mixed</option></select></Field>
                <Field label="First month"><input type="month" className="field h-8 py-1 text-[12.5px]" value={nc.fy_start} onChange={(e) => setNc({ ...nc, fy_start: e.target.value })} /></Field>
              </>}
              <div className="ml-auto flex items-end gap-2">
                <input className="field h-8 w-[180px] py-1 text-[12.5px]" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
                <Button variant="secondary" disabled={pending} onClick={saveTpl}><Save size={13} />{tplId ? "Update template" : "Save template"}</Button>
                <Button variant="primary" disabled={pending || !preview?.records.length} onClick={runImport}>{pending ? "Importing…" : `Import ${preview?.records.length ?? 0} lines`}</Button>
              </div>
            </div>
          </Card>
        </>
      )}

      {result && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <CheckCircle2 size={18} className="text-ok" />
          <span className="text-[13.5px] text-ink">Imported {result.lines} lines and {result.values} values</span>
          <Badge tone="muted">{result.createdItems} new lines</Badge><Badge tone="muted">{result.createdSections} new sections</Badge>
          <ButtonLink className="ml-auto" variant="primary" href={`/aop/plan?cycle=${result.cycleId}`}>Open plan</ButtonLink>
        </Card>
      )}
    </div>
  );
}

const colName = (i: number) => { let s = "", n = i + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
function guessFn(sheet: string, fns: string[]) {
  const s = sheet.toLowerCase().replace(/[_-]/g, " ");
  return fns.find((f) => s.includes(f.toLowerCase().split(/[\s&]/)[0])) ?? fns.find((f) => f.toLowerCase().split(/[\s&]/)[0] && s.split(" ").some((w) => w && f.toLowerCase().startsWith(w))) ?? sheet.replace(/_/g, " ").trim();
}
