"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { importLibrary, type LibraryRow } from "@/server/library/actions";
import type { LibraryKind } from "@/server/library/queries";

type Cell = { text: string; href: string | null };
const FIELDS: { key: keyof LibraryRow; label: string; guess: RegExp }[] = [
  { key: "title", label: "Title", guess: /^(sop|title|name|document|doc|dashboard|tool|process|sop name|topic)/i },
  { key: "url", label: "Link", guess: /(link|url|doc link|sop link|dashboard link)/i },
  { key: "category", label: "Category", guess: /(category|type|module|area|pod|vertical)/i },
  { key: "function_name", label: "Function", guess: /(function|team|department|dept)/i },
  { key: "owner", label: "Owner", guess: /(owner|poc|author|spoc|maintained|responsible)/i },
  { key: "description", label: "Description", guess: /(desc|purpose|summary|about|scope|use)/i },
  { key: "status", label: "Status", guess: /(status|stage|state)/i },
  { key: "updated_on", label: "Updated", guess: /(updated|date|last|version|revised)/i },
];

/** Google Sheets puts an HTML table on the clipboard — keep each cell's hyperlink. Falls back to tab-separated text. */
function parseClipboard(html: string, text: string): Cell[][] {
  if (html.includes("<table")) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("td,th")].map((td) => ({
      text: (td.textContent ?? "").replace(/\s+/g, " ").trim(), href: td.querySelector("a")?.getAttribute("href") ?? null,
    }))).filter((r) => r.some((c) => c.text));
  }
  return text.replace(/\r/g, "").split("\n").filter((l) => l.trim()).map((l) => l.split("\t").map((t) => ({ text: t.trim(), href: /^https?:\/\//.test(t.trim()) ? t.trim() : null })));
}

export function Importer({ kind, label }: { kind: LibraryKind; label: string }) {
  const [open, setOpen] = useState(false);
  const [grid, setGrid] = useState<Cell[][] | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const head = grid?.[0] ?? [];
  const body = useMemo(() => grid?.slice(1) ?? [], [grid]);
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const g = parseClipboard(e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain"));
    if (g.length < 2) return toast("Copy the header row and at least one row from the sheet", "error");
    const m: Record<string, number> = {};
    for (const f of FIELDS) { const i = g[0].findIndex((c, j) => f.guess.test(c.text) && !Object.values(m).includes(j)); if (i >= 0) m[f.key] = i; }
    if (m.title === undefined) m.title = 0;
    setGrid(g); setMap(m);
  };
  const rows: LibraryRow[] = body.map((r) => {
    const get = (k: string) => (map[k] !== undefined ? r[map[k]] : undefined);
    const titleCell = get("title");
    const link = get("url")?.href ?? (get("url")?.text && /^https?:\/\//.test(get("url")!.text) ? get("url")!.text : null) ?? titleCell?.href ?? r.find((c) => c.href)?.href ?? null;
    const used = new Set(Object.values(map));
    const extra = Object.fromEntries(head.flatMap((h, i) => (!used.has(i) && h.text && r[i]?.text ? [[h.text, r[i].text]] : [])));
    return { title: titleCell?.text ?? "", url: link, category: get("category")?.text, function_name: get("function_name")?.text, owner: get("owner")?.text, description: get("description")?.text, status: get("status")?.text, updated_on: get("updated_on")?.text, extra };
  }).filter((r) => r.title);
  const close = () => { setOpen(false); setGrid(null); };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><ClipboardPaste size={13} />Import from sheet</Button>
      <Modal open={open} onClose={close} width={820} title={`Import ${label}`} description="In Google Sheets select the header row and all rows (⌘A on the tab works), copy, then paste below. Hyperlinks in cells are kept."
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={pending || !rows.length} onClick={() => start(async () => {
          const r = await importLibrary(kind, rows);
          if (!r.ok) return toast(r.error, "error");
          toast(r.message ?? "Imported", "success"); close(); router.refresh();
        })}>{pending ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}</Button></>}>
        {!grid ? (
          <div tabIndex={0} onPaste={onPaste} className="flex h-40 cursor-text items-center justify-center rounded-lg border-2 border-dashed border-line-strong bg-subtle/50 text-center text-[13px] text-ink-3 outline-none focus:border-accent">
            Click here and paste (⌘V)
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="label">{f.label}</span>
                  <select className="field h-8 py-1 text-[12.5px]" value={map[f.key] ?? -1} onChange={(e) => { const v = Number(e.target.value); setMap((m) => { const n = { ...m }; if (v < 0) delete n[f.key]; else n[f.key] = v; return n; }); }}>
                    <option value={-1}>—</option>
                    {head.map((h, i) => <option key={i} value={i}>{h.text || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="table-base">
                <thead><tr><th>Title</th><th>Link</th><th>Category</th><th>Function</th><th>Owner</th></tr></thead>
                <tbody>{rows.slice(0, 8).map((r, i) => (
                  <tr key={i}><td className="max-w-[240px] truncate">{r.title}</td><td className="max-w-[160px] truncate text-info">{r.url ?? <span className="text-ink-4">none</span>}</td><td>{r.category}</td><td>{r.function_name}</td><td>{r.owner}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-[12px] text-ink-4">{rows.length} rows · {rows.filter((r) => r.url).length} with links · other columns are kept as extra details. <button className="underline" onClick={() => setGrid(null)}>Paste again</button></p>
          </div>
        )}
      </Modal>
    </>
  );
}
