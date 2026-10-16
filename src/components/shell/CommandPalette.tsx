"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { openQuickAdd, type QuickKind } from "./QuickAdd";

export const openPalette = () => window.dispatchEvent(new Event("co:palette"));

interface Hit { type: string; id: string; title: string; subtitle: string | null; href: string }
const TYPE_ICON: Record<string, keyof typeof Icons> = {
  task: "CircleCheck", project: "FolderKanban", program: "Layers", meeting: "CalendarClock", decision: "Gavel", risk: "TriangleAlert", aop_item: "Target", person: "User",
};
const TYPE_LABEL: Record<string, string> = { task: "Tasks", project: "Projects", program: "Programs", meeting: "Meetings", decision: "Decisions", risk: "Risks", aop_item: "AOP lines", person: "People" };

const CREATE: { kind: QuickKind; label: string; icon: keyof typeof Icons }[] = [
  { kind: "task", label: "Add task", icon: "CirclePlus" },
  { kind: "meeting", label: "Add meeting", icon: "CalendarPlus" },
  { kind: "decision", label: "Log decision", icon: "Gavel" },
  { kind: "followup", label: "Add follow-up", icon: "Send" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const router = useRouter();
  const seq = useRef(0);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "c") { e.preventDefault(); openQuickAdd("task"); }
      if (!typing && e.key === "/") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("co:palette", onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("co:palette", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (!open) { setQuery(""); setHits([]); return; }
  }, [open]);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(term)}`).then((r) => r.json()).then((d) => { if (n === seq.current) setHits(d.hits ?? []); }), 120);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const grouped = hits.reduce<Record<string, Hit[]>>((a, h) => ((a[h.type] ??= []).push(h), a), {});
  const Ico = (n: keyof typeof Icons) => { const C = (Icons[n] ?? Icons.Circle) as React.ComponentType<{ size?: number; className?: string }>; return <C size={15} className="text-ink-3" />; };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-ink/25 backdrop-blur-[2px] animate-fade-in" onClick={() => setOpen(false)} />
      <Command label="Command palette" shouldFilter={query.trim().length < 2} loop
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-line bg-surface animate-rise" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icons.Search size={16} className="text-ink-4" />
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search tasks, projects, meetings, people… or type a command"
            className="h-12 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-4" />
        </div>
        <Command.List className="max-h-[400px] overflow-y-auto p-1.5 scroll-thin [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-ink-4">
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-ink-3">
            No results.
          </Command.Empty>
          {Object.entries(grouped).map(([type, list]) => (
            <Command.Group key={type} heading={TYPE_LABEL[type] ?? type}>
              {list.map((h) => (
                <Item key={h.type + h.id} value={`${h.type}-${h.id}-${h.title}`} onSelect={() => go(h.href)} icon={Ico(TYPE_ICON[h.type] ?? "Circle")}>
                  <span className="truncate">{h.title}</span>
                  {h.subtitle && <span className="ml-2 truncate text-[12px] text-ink-4">{h.subtitle}</span>}
                </Item>
              ))}
            </Command.Group>
          ))}
          <Command.Group heading="Create">
            {CREATE.map((c) => (
              <Item key={c.kind} value={c.label} onSelect={() => { setOpen(false); openQuickAdd(c.kind, query.trim().length >= 2 ? query : undefined); }} icon={Ico(c.icon)}>{c.label}</Item>
            ))}
          </Command.Group>
          <Command.Group heading="Go to">
            {NAV.flatMap((g) => g.items).map((it) => (
              <Item key={it.href} value={`open ${it.label}`} onSelect={() => go(it.href)} icon={Ico(it.icon as keyof typeof Icons)}>Open {it.label}</Item>
            ))}
          </Command.Group>
        </Command.List>
        <div className="flex items-center gap-3 border-t border-line bg-subtle/50 px-4 py-2 text-[11.5px] text-ink-4">
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span><span className="ml-auto">C — new task anywhere</span>
        </div>
      </Command>
    </div>
  );
}

function Item({ children, onSelect, icon, value }: { children: React.ReactNode; onSelect: () => void; icon?: React.ReactNode; value: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink-2 data-[selected=true]:bg-subtle data-[selected=true]:text-ink">
      {icon}
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
    </Command.Item>
  );
}
