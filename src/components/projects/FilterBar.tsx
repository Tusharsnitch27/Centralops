"use client";
// URL-driven filter bar shared by Projects, Decisions and Risks. Each filter writes ?key=value and keeps the rest.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Combobox, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";

export interface FilterDef { key: string; label: string; options: Option[]; width?: number }

export function useQueryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    next.delete("focus");
    const qs = next.toString();
    start(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  };
  return { sp, set, pending };
}

export function FilterBar({ filters, search, children, className }: { filters: FilterDef[]; search?: { placeholder: string }; children?: ReactNode; className?: string }) {
  const { sp, set, pending } = useQueryNav();
  const [term, setTerm] = useState(sp.get("q") ?? "");
  useEffect(() => setTerm(sp.get("q") ?? ""), [sp]);
  useEffect(() => {
    if (!search) return;
    const cur = sp.get("q") ?? "";
    if (term === cur) return;
    const h = setTimeout(() => set({ q: term.trim() || null }), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const active = filters.filter((f) => sp.get(f.key)).length + (sp.get("q") ? 1 : 0);
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-70", className)}>
      {search && (
        <label className="relative flex h-8 w-[240px] items-center">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-4" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={search.placeholder}
            className="h-8 w-full rounded-lg border border-line-strong bg-surface pr-2 pl-8 text-[12.5px] outline-none placeholder:text-ink-4 focus:border-ink-3 focus:ring-4 focus:ring-ink/5" />
        </label>
      )}
      {filters.map((f) => (
        <div key={f.key} style={{ width: f.width ?? 168 }}>
          <Combobox size="sm" options={f.options} value={sp.get(f.key)} placeholder={f.label}
            renderValue={(o) => (o ? <span className="truncate"><span className="text-ink-3">{f.label}:</span> {o.label}</span> : <span className="text-ink-3">{f.label}</span>)}
            onChange={(v) => set({ [f.key]: v })} />
        </div>
      ))}
      {active > 0 && (
        <button type="button" onClick={() => set(Object.fromEntries([...filters.map((f) => [f.key, null]), ["q", null]]))}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink">
          <X size={13} />Clear
        </button>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** Segmented control bound to a query param. */
export function QuerySegment({ param, options, value, className }: { param: string; options: { value: string; label: ReactNode; title?: string }[]; value: string; className?: string }) {
  const { set } = useQueryNav();
  return (
    <div className={cn("inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface p-0.5", className)}>
      {options.map((o, i) => (
        <button key={o.value} type="button" title={o.title} onClick={() => set({ [param]: i === 0 ? null : o.value })}
          className={cn("flex h-full items-center gap-1 rounded-md px-2 text-[12px] transition-colors", value === o.value ? "bg-subtle font-medium text-ink" : "text-ink-3 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
