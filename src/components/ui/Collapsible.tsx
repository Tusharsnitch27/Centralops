"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

const KEY = "co_open_sections";
const read = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set(); } };
const write = (s: Set<string>) => { try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch {} };
const EVT = "co-sections";

/** A bar that expands to its content. Closed by default; stays open (remembered per browser) until closed. */
export function Collapsible({ id, title, sub, summary, icon, children, className }: {
  id: string; title: ReactNode; sub?: ReactNode; summary?: ReactNode; icon?: ReactNode; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(read().has(id));
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [id]);
  const toggle = () => {
    const s = read();
    if (s.has(id)) s.delete(id); else s.add(id);
    write(s);
    setOpen(s.has(id));
  };
  return (
    <div className={cn("card overflow-hidden", className)}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="bar-dark flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors md:px-5">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <ChevronRight size={15} className={cn("shrink-0 text-white/70 transition-transform", open && "rotate-90")} />
          {icon && <span className="shrink-0 text-white/70">{icon}</span>}
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-white">{title}</span>
            {sub && <span className="block truncate text-[11.5px] text-white/65">{sub}</span>}
          </span>
        </span>
        {summary && <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-[12px] md:pl-0">{summary}</span>}
      </button>
      {open && <div className="border-t border-line">{children}</div>}
    </div>
  );
}

/** Expand / collapse every Collapsible whose id is in `ids`. */
export function ExpandAll({ ids }: { ids: string[] }) {
  const set = (on: boolean) => {
    const s = read();
    for (const id of ids) if (on) s.add(id); else s.delete(id);
    write(s);
    window.dispatchEvent(new Event(EVT));
  };
  return (
    <span className="flex items-center gap-1 text-[12px]">
      <button type="button" onClick={() => set(true)} className="rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink">Expand all</button>
      <span className="text-ink-4/50">·</span>
      <button type="button" onClick={() => set(false)} className="rounded-md px-2 py-1 text-ink-3 hover:bg-subtle hover:text-ink">Collapse all</button>
    </span>
  );
}
