"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, GripVertical, Lock, Search } from "lucide-react";
import { Avatar } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { setOrgLevel, setReportsTo } from "@/server/org/actions";
import type { OrgLevel, OrgPerson } from "@/server/org/queries";
import { cn } from "@/lib/cn";

const LEVELS: { key: OrgLevel; label: string; tone: string }[] = [
  { key: "manager", label: "Manager", tone: "bg-ink text-white" },
  { key: "program_manager", label: "Program Manager", tone: "bg-accent text-white" },
  { key: "dept_manager", label: "Dept. Manager", tone: "bg-info-soft text-info" },
  { key: "lead", label: "Lead", tone: "bg-violet-soft text-violet" },
  { key: "member", label: "Member", tone: "bg-subtle text-ink-3" },
];
const ROLE_NOTE: Record<string, string> = { admin: "All control", pm: "All work · no settings", owner: "Own tasks + reports", viewer: "View only", leadership: "View only" };

/** Admin-only org chart: drag a person onto their manager (or onto Top level). Drives task visibility and reporting. */
export function OrgChart({ people }: { people: OrgPerson[] }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [qy, setQy] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const kids = useMemo(() => {
    const m = new Map<string | null, OrgPerson[]>();
    const ids = new Set(people.map((p) => p.id));
    for (const p of people) { const k = p.reports_to && ids.has(p.reports_to) ? p.reports_to : null; m.set(k, [...(m.get(k) ?? []), p]); }
    const rank = (p: OrgPerson) => LEVELS.findIndex((l) => l.key === p.org_level);
    for (const [k, v] of m) m.set(k, v.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)));
    return m;
  }, [people]);
  const count = (id: string): number => (kids.get(id) ?? []).reduce((a, c) => a + 1 + count(c.id), 0);
  const isBelow = (id: string, ancestor: string): boolean => (kids.get(ancestor) ?? []).some((c) => c.id === id || isBelow(id, c.id));
  const move = (userId: string, managerId: string | null) => {
    if (userId === managerId || (managerId && isBelow(managerId, userId))) return toast("Can't move someone under their own report", "error");
    start(async () => { const r = await setReportsTo(userId, managerId); if (!r.ok) toast(r.error, "error"); else { toast("Moved", "success"); router.refresh(); } });
  };
  const level = (id: string, l: OrgLevel) => start(async () => { const r = await setOrgLevel(id, l); if (!r.ok) toast(r.error, "error"); else router.refresh(); });
  const match = (p: OrgPerson) => !qy || `${p.name} ${p.title ?? ""} ${p.org_function ?? ""}`.toLowerCase().includes(qy.toLowerCase());
  const visible = (p: OrgPerson): boolean => match(p) || (kids.get(p.id) ?? []).some(visible);

  const Node = ({ p, depth }: { p: OrgPerson; depth: number }) => {
    const ch = (kids.get(p.id) ?? []).filter(visible);
    const open = !closed.has(p.id) || !!qy;
    const lv = LEVELS.find((l) => l.key === p.org_level) ?? LEVELS[4];
    return (
      <li className="relative">
        {depth > 0 && <span className="absolute -left-4 top-0 h-6 w-4 rounded-bl-lg border-b border-l border-line-strong" />}
        <div draggable onDragStart={(e) => { setDrag(p.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { if (drag && drag !== p.id) { e.preventDefault(); setOver(p.id); } }} onDragLeave={() => over === p.id && setOver(null)}
          onDrop={(e) => { e.preventDefault(); if (drag) move(drag, p.id); setOver(null); }}
          className={cn("group flex flex-wrap items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 transition-colors", over === p.id ? "border-accent bg-accent-soft/50 ring-2 ring-accent/20" : "border-line", drag === p.id && "opacity-40", pending && "pointer-events-none")}>
          <GripVertical size={14} className="cursor-grab text-ink-4" />
          {ch.length > 0 || (kids.get(p.id) ?? []).length > 0
            ? <button type="button" onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} className="text-ink-4 hover:text-ink" aria-label="Expand"><ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} /></button>
            : <span className="w-[14px]" />}
          <Avatar name={p.name} color={p.avatar_color} size={26} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-semibold text-ink">{p.name}</span>
              <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold", lv.tone)}>{lv.label}</span>
              {count(p.id) > 0 && <span className="text-[11px] text-ink-4">{count(p.id)} below</span>}
            </div>
            <div className="truncate text-[11.5px] text-ink-4">{[p.title, p.org_function].filter(Boolean).join(" · ")}{ROLE_NOTE[p.role] ? <> · <span className={p.role === "admin" || p.role === "pm" ? "text-accent-ink" : ""}>{ROLE_NOTE[p.role]}</span></> : null}</div>
          </div>
          <select className="rounded-md bg-transparent py-1 text-[11.5px] text-ink-3 outline-none hover:bg-subtle" value={p.org_level} onChange={(e) => level(p.id, e.target.value as OrgLevel)} title="Level">
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          <select className="max-w-[150px] rounded-md bg-transparent py-1 text-[11.5px] text-ink-3 outline-none hover:bg-subtle" value={p.reports_to ?? ""} onChange={(e) => move(p.id, e.target.value || null)} title="Reports to">
            <option value="">Top level</option>
            {people.filter((x) => x.id !== p.id && !isBelow(x.id, p.id)).map((x) => <option key={x.id} value={x.id}>→ {x.name}</option>)}
          </select>
        </div>
        {open && ch.length > 0 && <ul className="ml-[22px] mt-1.5 space-y-1.5 border-l border-line-strong/0 pl-4">{ch.map((c) => <Node key={c.id} p={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  const roots = (kids.get(null) ?? []).filter(visible);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <Lock size={14} className="text-ink-4" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">Only admins see this. It decides whose tasks managers can see and who people report to. Drag a person onto their manager, or use “Reports to”.</p>
        <label className="relative w-full sm:w-[220px]"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" /><input className="field h-8 pl-7 text-[12.5px]" placeholder="Find a person…" value={qy} onChange={(e) => setQy(e.target.value)} /></label>
      </div>
      <div onDragOver={(e) => { if (drag) { e.preventDefault(); setOver("__top"); } }} onDrop={(e) => { e.preventDefault(); if (drag) move(drag, null); setOver(null); }}
        className={cn("rounded-lg border border-dashed px-3 py-2 text-center text-[12px] text-ink-4 transition-colors", over === "__top" ? "border-accent bg-accent-soft/40 text-accent-ink" : "border-line-strong", !drag && "hidden")}>
        Drop here to make top level
      </div>
      <ul className="space-y-2">{roots.map((p) => <Node key={p.id} p={p} depth={0} />)}</ul>
      <p className="px-1 text-[11.5px] text-ink-4">Access follows the role in Users &amp; access: Admin = all control · Program Manager = all work, no settings · everyone else sees their own tasks and their reports’ tasks.</p>
    </div>
  );
}
