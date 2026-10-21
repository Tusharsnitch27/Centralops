"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { patchTask } from "@/server/tasks/actions";
import { linkLabel, type TaskLink } from "@/lib/links";

/** Links on the task page: open, add, remove. */
export function TaskLinks({ id, links, readOnly }: { id: string; links: TaskLink[]; readOnly?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = (next: TaskLink[]) => start(async () => {
    const r = await patchTask(id, { links: next });
    if (!r.ok) return toast(r.error, "error");
    setAdding(false); setUrl(""); setLabel(""); router.refresh();
  });
  return (
    <div className="space-y-1">
      {links.map((l, i) => (
        <div key={l.url + i} className="group flex items-center gap-1.5">
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-info hover:bg-subtle hover:underline" title={l.url}>
            <ExternalLink size={12} className="shrink-0" /><span className="truncate">{l.label || linkLabel(l.url)}</span>
          </a>
          {!readOnly && <button type="button" disabled={pending} onClick={() => save(links.filter((_, j) => j !== i))} className="rounded p-1 text-ink-4 opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Remove link"><X size={12} /></button>}
        </div>
      ))}
      {!links.length && !adding && <div className="px-2 py-1 text-[12.5px] text-ink-4">No links</div>}
      {!readOnly && (adding ? (
        <div className="space-y-1.5 rounded-lg bg-subtle/60 p-2">
          <input autoFocus className="field h-8 py-1 text-[12.5px]" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="field h-8 py-1 text-[12.5px]" placeholder={url ? linkLabel(url) : "Label (optional)"} value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="flex justify-end gap-2 text-[12px]">
            <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-ink-3 hover:text-ink">Cancel</button>
            <button type="button" disabled={pending || !/^https?:\/\/\S+$/.test(url.trim())} onClick={() => save([...links, { url: url.trim(), label: label.trim() || linkLabel(url.trim()) }])} className="rounded-md bg-ink px-2.5 py-1 font-medium text-white disabled:opacity-50">Add</button>
          </div>
        </div>
      ) : <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 px-2 py-1 text-[12px] text-ink-3 hover:text-ink"><Plus size={12} />Add link</button>)}
    </div>
  );
}
