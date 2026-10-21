"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { deleteLibraryItem, saveLibraryItem } from "@/server/library/actions";
import type { LibraryItem, LibraryKind } from "@/server/library/queries";
import { linkLabel } from "@/lib/links";
import { cn } from "@/lib/cn";
import { Importer } from "./Importer";

/** Searchable, filterable list of library links. `layout` table for SOPs, cards for dashboards/tools. */
export function LibraryList({ kind, items, manage, label, layout = "table" }: { kind: LibraryKind; items: LibraryItem[]; manage: boolean; label: string; layout?: "table" | "cards" }) {
  const [qy, setQy] = useState("");
  const [cat, setCat] = useState("");
  const [edit, setEdit] = useState<LibraryItem | "new" | null>(null);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category || i.function_name).filter(Boolean))].sort(), [items]);
  const shown = items.filter((i) => (!cat || i.category === cat || i.function_name === cat)
    && (!qy || `${i.title} ${i.description} ${i.owner} ${i.category} ${i.function_name} ${Object.values(i.extra).join(" ")}`.toLowerCase().includes(qy.toLowerCase())));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-[320px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input className="field h-9 pl-8" placeholder={`Search ${label.toLowerCase()}…`} value={qy} onChange={(e) => setQy(e.target.value)} />
        </label>
        {cats.length > 1 && (
          <select className="field h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        {manage && <span className="ml-auto flex gap-2"><Importer kind={kind} label={label} /><Button size="sm" variant="primary" onClick={() => setEdit("new")}><Plus size={13} />Add</Button></span>}
      </div>

      {!shown.length ? <div className="card"><EmptyState title={items.length ? "Nothing matches" : `No ${label.toLowerCase()} yet`} body={items.length ? "Try another search." : manage ? "Import them from the source sheet or add one by hand." : undefined} /></div>
        : layout === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((i) => (
              <div key={i.id} className="card group flex flex-col p-4">
                <div className="flex items-start gap-2">
                  <a href={i.url ?? undefined} target="_blank" rel="noopener noreferrer" className={cn("min-w-0 flex-1 text-[13.5px] font-semibold text-ink", i.url && "hover:underline")}>{i.title}</a>
                  {i.pinned && <Pin size={12} className="mt-1 shrink-0 text-ink-4" />}
                  {manage && <RowActions i={i} onEdit={() => setEdit(i)} />}
                </div>
                {i.description && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-3">{i.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[11.5px] text-ink-4">
                  {(i.category || i.function_name) && <span className="rounded-md bg-subtle px-1.5 py-0.5">{i.category || i.function_name}</span>}
                  {i.owner && <span>{i.owner}</span>}
                  {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-info hover:underline">{linkLabel(i.url)}<ExternalLink size={11} /></a>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="table-base">
              <thead><tr><th>Title</th><th className="hidden md:table-cell">Category</th><th className="hidden md:table-cell">Function</th><th className="hidden lg:table-cell">Owner</th><th className="hidden lg:table-cell">Updated</th><th className="w-10" /></tr></thead>
              <tbody>{shown.map((i) => (
                <tr key={i.id} className="group">
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      {i.pinned && <Pin size={11} className="shrink-0 text-ink-4" />}
                      {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-info hover:underline">{i.title}</a> : <span className="font-medium">{i.title}</span>}
                      {i.url && <ExternalLink size={11} className="shrink-0 text-ink-4" />}
                    </div>
                    {i.description && <div className="line-clamp-1 text-[12px] text-ink-4">{i.description}</div>}
                    <div className="text-[11.5px] text-ink-4 md:hidden">{[i.category, i.function_name, i.owner].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="hidden text-ink-3 md:table-cell">{i.category}</td>
                  <td className="hidden text-ink-3 md:table-cell">{i.function_name}</td>
                  <td className="hidden text-ink-3 lg:table-cell">{i.owner}</td>
                  <td className="hidden whitespace-nowrap text-ink-4 lg:table-cell">{i.updated_on}</td>
                  <td>{manage && <RowActions i={i} onEdit={() => setEdit(i)} />}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      <p className="mt-2 px-1 text-[11.5px] text-ink-4">{shown.length} of {items.length}</p>
      {edit && <EditModal kind={kind} item={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RowActions({ i, onEdit }: { i: LibraryItem; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button onClick={onEdit} className="rounded p-1 text-ink-4 hover:bg-subtle hover:text-ink" aria-label="Edit"><Pencil size={12} /></button>
      <button disabled={pending} onClick={() => confirm(`Remove “${i.title}”?`) && start(async () => { const r = await deleteLibraryItem(i.id); if (!r.ok) toast(r.error, "error"); else router.refresh(); })}
        className="rounded p-1 text-ink-4 hover:bg-subtle hover:text-bad" aria-label="Remove"><Trash2 size={12} /></button>
    </span>
  );
}

function EditModal({ kind, item, onClose }: { kind: LibraryKind; item: LibraryItem | null; onClose: () => void }) {
  const [f, setF] = useState({ title: item?.title ?? "", url: item?.url ?? "", category: item?.category ?? "", function_name: item?.function_name ?? "", owner: item?.owner ?? "", description: item?.description ?? "", pinned: item?.pinned ?? false });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const field = (k: keyof typeof f, label: string, ph = "") => (
    <label className="block"><span className="label">{label}</span><input className="field" value={String(f[k])} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <Modal open onClose={onClose} title={item ? "Edit" : "Add to library"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await saveLibraryItem(kind, item?.id ?? null, f); if (!r.ok) return toast(r.error, "error"); onClose(); router.refresh(); })}>Save</Button></>}>
      <div className="space-y-3">
        {field("title", "Title")}
        {field("url", "Link", "https://docs.google.com/…")}
        <div className="grid grid-cols-2 gap-3">{field("category", "Category")}{field("function_name", "Function")}</div>
        {field("owner", "Owner")}
        <label className="block"><span className="label">Description</span><textarea className="field min-h-16" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />Pin to top</label>
      </div>
    </Modal>
  );
}
