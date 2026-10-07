"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Combobox } from "@/components/ui/client";
import { cn } from "@/lib/cn";

type Opt = { id: string; name: string; code?: string | null };

/** URL-driven filter bar (review / program / project). */
export function MeetingFilters({ reviews, programs, projects }: { reviews: Opt[]; programs: Opt[]; projects: Opt[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    start(() => router.replace(`${path}?${p.toString()}`, { scroll: false }));
  };
  const any = sp.get("review") || sp.get("program") || sp.get("project");
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <Combobox size="sm" className="w-[190px]" value={sp.get("review")} placeholder="All reviews" onChange={(v) => set("review", v)} options={reviews.map((r) => ({ value: r.id, label: r.name }))} />
      <Combobox size="sm" className="w-[190px]" value={sp.get("program")} placeholder="All programs" onChange={(v) => set("program", v)} options={programs.map((r) => ({ value: r.id, label: r.name, hint: r.code ?? undefined }))} />
      <Combobox size="sm" className="w-[190px]" value={sp.get("project")} placeholder="All projects" onChange={(v) => set("project", v)} options={projects.map((r) => ({ value: r.id, label: r.name, hint: r.code ?? undefined }))} />
      {any && (
        <button type="button" onClick={() => { const p = new URLSearchParams(sp.toString()); ["review", "program", "project"].forEach((k) => p.delete(k)); start(() => router.replace(`${path}?${p}`, { scroll: false })); }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-ink-3 hover:bg-subtle hover:text-ink"><X size={13} />Clear</button>
      )}
    </div>
  );
}
