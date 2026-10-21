"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Minus, Plus, X } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { setOrgLevel, setReportsTo } from "@/server/org/actions";
import type { OrgLevel, OrgPerson } from "@/server/org/queries";
import { cn } from "@/lib/cn";

const LEVELS: { key: OrgLevel; label: string; color: string }[] = [
  { key: "manager", label: "Manager", color: "#121212" },
  { key: "program_manager", label: "Program Manager", color: "var(--color-accent)" },
  { key: "dept_manager", label: "Department Manager", color: "#2563eb" },
  { key: "lead", label: "Lead", color: "#7c3aed" },
  { key: "member", label: "Member", color: "#c4c4bf" },
];
const levelOf = (k: OrgLevel) => LEVELS.find((l) => l.key === k) ?? LEVELS[4];

/** Admin-only org chart drawn as a flow chart. Drag a name onto another to change who they report to. */
export function OrgChart({ people }: { people: OrgPerson[] }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  // open zoomed to fit the width, then keep the top of the tree centred
  useEffect(() => {
    const b = box.current, i = inner.current;
    if (!b || !i) return;
    const fit = Math.max(0.5, Math.min(1, (b.clientWidth - 48) / i.scrollWidth));
    setZoom(+fit.toFixed(2));
  }, []);
  useEffect(() => { const b = box.current; if (b) b.scrollLeft = (b.scrollWidth - b.clientWidth) / 2; }, [zoom]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const kids = useMemo(() => {
    const ids = new Set(people.map((p) => p.id));
    const m = new Map<string | null, OrgPerson[]>();
    for (const p of people) { const k = p.reports_to && ids.has(p.reports_to) ? p.reports_to : null; m.set(k, [...(m.get(k) ?? []), p]); }
    const rank = (p: OrgPerson) => LEVELS.findIndex((l) => l.key === p.org_level);
    for (const [k, v] of m) m.set(k, v.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)));
    return m;
  }, [people]);
  const below = (id: string, anc: string): boolean => (kids.get(anc) ?? []).some((c) => c.id === id || below(id, c.id));
  const move = (userId: string, managerId: string | null) => {
    if (userId === managerId || (managerId && below(managerId, userId))) return toast("Can’t move someone under their own report", "error");
    start(async () => { const r = await setReportsTo(userId, managerId); if (!r.ok) toast(r.error, "error"); else router.refresh(); });
  };
  const person = sel ? people.find((p) => p.id === sel) : null;

  const Box = ({ p }: { p: OrgPerson }) => {
    const lv = levelOf(p.org_level);
    return (
      <button type="button" draggable
        onDragStart={(e) => { setDrag(p.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (drag && drag !== p.id) { e.preventDefault(); setOver(p.id); } }} onDragLeave={() => over === p.id && setOver(null)}
        onDrop={(e) => { e.preventDefault(); if (drag) move(drag, p.id); setOver(null); }}
        onClick={() => setSel(p.id)}
        title={[p.title, lv.label].filter(Boolean).join(" · ")}
        className={cn("whitespace-nowrap rounded-lg border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink shadow-[0_1px_2px_rgb(20_20_18/0.06)] transition",
          over === p.id ? "scale-105 border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong", drag === p.id && "opacity-40", sel === p.id && "ring-2 ring-ink/20")}
        style={{ borderTop: `3px solid ${lv.color}` }}>
        {p.name}
      </button>
    );
  };
  // children with their own reports fan out horizontally; the rest stack in a column under the person
  const Node = ({ p }: { p: OrgPerson }) => {
    const ch = kids.get(p.id) ?? [];
    const branchy = ch.some((c) => (kids.get(c.id) ?? []).length > 0);
    return (
      <li>
        <Box p={p} />
        {ch.length > 0 && (branchy
          ? <ul>{ch.map((c) => <Node key={c.id} p={c} />)}</ul>
          : <div className="org-stack">{ch.map((c) => <div key={c.id}><Box p={c} /></div>)}</div>)}
      </li>
    );
  };
  const roots = kids.get(null) ?? [];

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Lock size={14} className="text-ink-4" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">Admins only. Drag a name onto their manager; click a name to change level. Drives whose tasks managers can see.</p>
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-ink-3">
          {LEVELS.map((l) => <span key={l.key} className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: l.color }} />{l.label}</span>)}
        </div>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="rounded-md p-1 text-ink-3 hover:bg-subtle" aria-label="Zoom out"><Minus size={14} /></button>
          <span className="w-9 text-center text-[11.5px] tabular text-ink-3">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))} className="rounded-md p-1 text-ink-3 hover:bg-subtle" aria-label="Zoom in"><Plus size={14} /></button>
        </span>
      </div>

      <div ref={box} className={cn("card max-h-[75dvh] overflow-auto p-6", pending && "opacity-70")}
        onDragOver={(e) => { if (drag && e.target === e.currentTarget) { e.preventDefault(); setOver("__top"); } }}
        onDrop={(e) => { if (drag && e.target === e.currentTarget) { e.preventDefault(); move(drag, null); setOver(null); } }}>
        <div ref={inner} className="mx-auto w-max" style={{ zoom }}>
          <ul className="org-tree">{roots.map((p) => <Node key={p.id} p={p} />)}</ul>
        </div>
        {drag && <p className="mt-6 text-center text-[11.5px] text-ink-4">Drop on empty space to make top level</p>}
      </div>

      {person && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{person.name}</div>
            <div className="text-[12px] text-ink-4">{[person.title, person.org_function].filter(Boolean).join(" · ")}</div>
          </div>
          <label className="block"><span className="label">Level</span>
            <select className="field h-9 py-0" value={person.org_level} disabled={pending}
              onChange={(e) => start(async () => { const r = await setOrgLevel(person.id, e.target.value as OrgLevel); if (!r.ok) toast(r.error, "error"); else router.refresh(); })}>
              {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select></label>
          <label className="block"><span className="label">Reports to</span>
            <select className="field h-9 py-0" value={person.reports_to ?? ""} disabled={pending} onChange={(e) => move(person.id, e.target.value || null)}>
              <option value="">— Top level</option>
              {people.filter((x) => x.id !== person.id && !below(x.id, person.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <button type="button" onClick={() => setSel(null)} className="rounded-md p-2 text-ink-4 hover:bg-subtle" aria-label="Close"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
