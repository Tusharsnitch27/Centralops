"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, ImagePlus, MessageSquareWarning, Plus, Send, Table2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { saveEntry, updateImage, uploadImage } from "@/server/weekly/actions";
import type { DataTable, Metric, WeeklyEntry } from "@/server/weekly/model";
import { cn } from "@/lib/cn";

/** Spreadsheet paste (tab-separated) or CSV → table. First row = headers. */
function parseGrid(text: string): DataTable | null {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes("|") ? "|" : ",";
  // markdown-style "| a | b |" rows carry empty edge cells — drop them
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim()).filter((c, i, a) => sep !== "|" || (i > 0 && i < a.length - 1) || c.length > 0));
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  return { title: "", columns: pad(rows[0]), rows: rows.slice(1).map(pad) };
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 flex items-baseline justify-between gap-2"><span className="label mb-0">{label}</span>{hint && <span className="text-[11px] text-ink-4">{hint}</span>}</span>
    {children}
  </label>
);

export function SectionEditor({ e, lastAhead }: { e: WeeklyEntry; lastAhead: string | null }) {
  const [metrics, setMetrics] = useState<Metric[]>(e.metrics);
  const [note, setNote] = useState(e.metrics_note);
  const [updates, setUpdates] = useState(e.updates);
  const [ahead, setAhead] = useState(e.ahead);
  const [blockers, setBlockers] = useState(e.blockers);
  const [tables, setTables] = useState<DataTable[]>(e.tables);
  const [paste, setPaste] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const router = useRouter();
  const touch = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); };

  const save = (submit: boolean) => start(async () => {
    const r = await saveEntry(e.id, { metrics, metrics_note: note, updates, ahead, blockers, tables }, submit);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Saved", "success"); setDirty(false); router.refresh();
  });
  const upload = (files: File[]) => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    startUpload(async () => {
      const r = await uploadImage(e.id, fd);
      if (!r.ok) return toast(r.error, "error");
      toast(r.message ?? "Added", "success"); router.refresh();
    });
  };
  const onPasteImage = (ev: React.ClipboardEvent) => {
    const files = [...ev.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) { ev.preventDefault(); upload(files); }
  };

  return (
    <div className="space-y-5 p-4 md:p-5" onPaste={onPasteImage}>
      {e.pm_comment && (
        <div className="flex gap-2 rounded-lg border border-warn/25 bg-warn-soft/60 px-3 py-2 text-[12.5px] text-ink-2">
          <MessageSquareWarning size={14} className="mt-0.5 shrink-0 text-warn" /><span><b className="font-semibold">PM feedback:</b> {e.pm_comment}</span>
        </div>
      )}

      {/* metrics */}
      <div>
        <div className="mb-1.5 flex items-center justify-between"><span className="label mb-0">Key metrics</span>
          <button type="button" onClick={() => touch(setMetrics)([...metrics, { label: "", value: "", target: "" }])} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Plus size={12} />Metric</button>
        </div>
        {metrics.length ? (
          <div className="space-y-1.5">
            {metrics.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_90px_28px] gap-1.5">
                {(["label", "value", "target"] as const).map((k) => (
                  <input key={k} className="field h-8 py-1 text-[12.5px]" placeholder={k === "label" ? "e.g. Forward NPS" : k === "value" ? "Value" : "Target"} value={m[k]}
                    onChange={(ev) => touch(setMetrics)(metrics.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)))} />
                ))}
                <button type="button" onClick={() => touch(setMetrics)(metrics.filter((_, j) => j !== i))} className="flex items-center justify-center rounded-md text-ink-4 hover:bg-subtle hover:text-bad" aria-label="Remove metric"><X size={13} /></button>
              </div>
            ))}
          </div>
        ) : <p className="text-[12px] text-ink-4">Optional — headline numbers with their targets (shown as tiles).</p>}
      </div>

      <Field label="North star summary" hint="optional"><textarea className="field min-h-[56px]" value={note} onChange={(ev) => touch(setNote)(ev.target.value)} placeholder="One paragraph on the headline numbers and how they moved WoW" /></Field>

      <Field label="Updates" hint="one point per line, start with -">
        <textarea className="field min-h-[130px]" value={updates} onChange={(ev) => touch(setUpdates)(ev.target.value)} placeholder={"- What got done this week, with numbers\n- …"} />
      </Field>

      <div>
        <Field label="Line items ahead"><textarea className="field min-h-[90px]" value={ahead} onChange={(ev) => touch(setAhead)(ev.target.value)} placeholder={"- Next week's priorities\n- …"} /></Field>
        {lastAhead && (
          <details className="mt-1.5 rounded-lg bg-subtle/60 px-3 py-2 text-[12px] text-ink-3">
            <summary className="cursor-pointer select-none font-medium text-ink-2">Last week’s line items — what happened to these?</summary>
            <pre className="mt-1.5 whitespace-pre-wrap font-sans">{lastAhead}</pre>
            <button type="button" className="mt-1.5 text-[12px] font-medium text-accent-ink hover:underline"
              onClick={() => touch(setUpdates)(`${updates ? `${updates}\n` : ""}${lastAhead.split("\n").filter((l) => l.trim()).map((l) => `${l.replace(/^\s*([-•*]|\d+[.)])\s*/, "- ")} — `).join("\n")}`)}>
              Copy into updates to report status
            </button>
          </details>
        )}
      </div>

      <Field label="Blockers / dependencies" hint="optional"><textarea className="field min-h-[56px]" value={blockers} onChange={(ev) => touch(setBlockers)(ev.target.value)} placeholder="- What you need from other teams or leadership" /></Field>

      {/* tables */}
      <div>
        <div className="mb-1.5 flex items-center justify-between"><span className="label mb-0">Tables</span>
          <span className="flex gap-3">
            <button type="button" onClick={() => setPaste("")} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><ClipboardPaste size={12} />Paste from Excel / Sheets</button>
            <button type="button" onClick={() => touch(setTables)([...tables, { title: "", columns: ["Metric", "Last week", "This week"], rows: [["", "", ""]] }])} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Table2 size={12} />Blank table</button>
          </span>
        </div>
        {paste !== null && (
          <div className="mb-2 rounded-lg border border-line bg-subtle/50 p-2.5">
            <textarea autoFocus className="field min-h-[90px] font-mono text-[12px]" value={paste} onChange={(ev) => setPaste(ev.target.value)} placeholder="Copy cells in Excel or Google Sheets (with the header row) and paste here" />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setPaste(null)}>Cancel</Button>
              <Button size="xs" variant="primary" onClick={() => { const t = parseGrid(paste); if (!t) return toast("Paste at least a header row and one data row", "error"); touch(setTables)([...tables, t]); setPaste(null); }}>Add table</Button>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {tables.map((t, ti) => {
            const upd = (fn: (x: DataTable) => DataTable) => touch(setTables)(tables.map((x, j) => (j === ti ? fn(x) : x)));
            return (
              <div key={ti} className="rounded-lg border border-line">
                <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
                  <input className="min-w-0 flex-1 bg-transparent text-[12.5px] font-medium outline-none placeholder:text-ink-4" placeholder="Table title (e.g. B2B Forward)" value={t.title} onChange={(ev) => upd((x) => ({ ...x, title: ev.target.value }))} />
                  <button type="button" onClick={() => upd((x) => ({ ...x, columns: [...x.columns, ""], rows: x.rows.map((r) => [...r, ""]) }))} className="text-[11.5px] text-ink-3 hover:text-ink">+ col</button>
                  <button type="button" onClick={() => upd((x) => ({ ...x, rows: [...x.rows, x.columns.map(() => "")] }))} className="text-[11.5px] text-ink-3 hover:text-ink">+ row</button>
                  <button type="button" onClick={() => touch(setTables)(tables.filter((_, j) => j !== ti))} className="text-ink-4 hover:text-bad" aria-label="Remove table"><Trash2 size={13} /></button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead><tr>{t.columns.map((c, ci) => <th key={ci} className="border-b border-line bg-head p-0"><input className="w-full min-w-[90px] bg-transparent px-2 py-1.5 font-semibold outline-none" value={c} onChange={(ev) => upd((x) => ({ ...x, columns: x.columns.map((y, k) => (k === ci ? ev.target.value : y)) }))} /></th>)}</tr></thead>
                    <tbody>{t.rows.map((r, ri) => (
                      <tr key={ri} className="border-b border-line/60 last:border-0">
                        {r.map((c, ci) => <td key={ci} className="p-0"><input className="w-full min-w-[90px] bg-transparent px-2 py-1.5 tabular outline-none focus:bg-info-soft/40" value={c} onChange={(ev) => upd((x) => ({ ...x, rows: x.rows.map((y, k) => (k === ri ? y.map((z, m) => (m === ci ? ev.target.value : z)) : y)) }))} /></td>)}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* screenshots */}
      <div>
        <div className="mb-1.5 flex items-center justify-between"><span className="label mb-0">Screenshots</span>
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"><ImagePlus size={12} />{uploading ? "Uploading…" : "Add image"}</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(ev) => { upload([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
        </div>
        {e.images.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {e.images.map((img) => <ImageCard key={img.id} id={img.id} caption={img.caption} />)}
          </div>
        ) : <p className="text-[12px] text-ink-4">Paste a screenshot anywhere in this section (⌘V) or add an image file.</p>}
      </div>

      <div className="sticky bottom-[72px] z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2 backdrop-blur lg:bottom-3">
        <span className={cn("mr-auto text-[12px]", dirty ? "text-warn" : "text-ink-4")}>{dirty ? "Unsaved changes" : e.status === "submitted" ? "Submitted — edits update the submission" : "Saved as draft"}</span>
        <Button disabled={pending} onClick={() => save(false)}>Save draft</Button>
        <Button variant="primary" disabled={pending} onClick={() => save(true)}><Send size={13} />{e.status === "submitted" ? "Update submission" : "Submit"}</Button>
      </div>
    </div>
  );
}

function ImageCard({ id, caption }: { id: string; caption: string }) {
  const [c, setC] = useState(caption);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const act = (v: string | null) => start(async () => { const r = await updateImage(id, v); if (!r.ok) toast(r.error, "error"); else router.refresh(); });
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line", pending && "opacity-60")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/weekly/image/${id}`} alt={c || "Screenshot"} className="max-h-56 w-full bg-subtle object-contain" />
      <div className="flex items-center gap-1.5 border-t border-line px-2 py-1">
        <input className="min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none placeholder:text-ink-4" placeholder="Caption" value={c} onChange={(ev) => setC(ev.target.value)} onBlur={() => c !== caption && act(c)} />
        <button type="button" onClick={() => act(null)} className="rounded p-1 text-ink-4 hover:text-bad" aria-label="Remove screenshot"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}
