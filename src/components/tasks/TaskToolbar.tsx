"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookmarkPlus, Check, ChevronDown, Layers, ListFilter, Search, X } from "lucide-react";
import { Popover, MenuItem, Modal, useToast } from "@/components/ui/client";
import { Avatar, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PRIORITY, TASK_STATUS } from "@/lib/meta";
import { saveTaskView } from "@/server/tasks/collab-actions";

export interface ToolbarOptions {
  people: { id: string; name: string; color: string | null }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; code: string | null }[];
  tags: string[];
}
type Opt = { value: string; label: string; icon?: React.ReactNode };

const GROUPS = [
  { key: "none", label: "No grouping" }, { key: "status", label: "Status" }, { key: "project", label: "Project" },
  { key: "owner", label: "Owner" }, { key: "due", label: "Due date" },
];

/** Search, filters (URL params), group-by and "Save view" for /tasks. */
export function TaskToolbar({ options, meId }: { options: ToolbarOptions; meId: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(sp.get("search") ?? "");
  const [saveOpen, setSaveOpen] = useState(false);
  const firstRender = useRef(true);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    const qs = next.toString();
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };

  // debounced search → URL
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const h = setTimeout(() => { if ((sp.get("search") ?? "") !== search.trim()) setParam("search", search.trim() || null); }, 280);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const ownerOpts: Opt[] = useMemo(() => [
    { value: "me", label: "Me" },
    ...options.people.filter((p) => p.id !== meId).map((p) => ({ value: p.id, label: p.name, icon: <Avatar name={p.name} color={p.color} size={18} /> })),
    ...options.teams.map((t) => ({ value: `team:${t.id}`, label: `${t.name} team`, icon: <TeamChip name={t.name} /> })),
  ], [options, meId]);
  const teamOpts: Opt[] = options.teams.map((t) => ({ value: t.id, label: t.name, icon: <TeamChip name={t.name} /> }));
  const projectOpts: Opt[] = options.projects.map((p) => ({ value: p.id, label: p.name, icon: p.code ? <span className="w-12 shrink-0 font-mono text-[10.5px] text-ink-4">{p.code}</span> : undefined }));
  const priorityOpts: Opt[] = (Object.keys(PRIORITY) as (keyof typeof PRIORITY)[]).map((k) => ({ value: k, label: PRIORITY[k].label }));
  const statusOpts: Opt[] = (Object.keys(TASK_STATUS) as (keyof typeof TASK_STATUS)[]).map((k) => ({ value: k, label: TASK_STATUS[k].label }));
  const tagOpts: Opt[] = options.tags.map((t) => ({ value: t, label: `#${t}` }));

  const filters: FilterDef[] = [
    { key: "owner", label: "Owner", opts: ownerOpts },
    { key: "team", label: "Team", opts: teamOpts },
    { key: "project", label: "Project", opts: projectOpts },
    { key: "priority", label: "Priority", opts: priorityOpts, multi: true },
    { key: "status", label: "Status", opts: statusOpts, multi: true },
    { key: "tag", label: "Tag", opts: tagOpts },
  ];
  const active = filters.filter((f) => sp.get(f.key));
  const inactive = filters.filter((f) => !sp.get(f.key));
  const group = sp.get("group") ?? "none";
  const hasCustom = active.length > 0 || !!sp.get("search") || group !== "none";

  const valueLabel = (f: (typeof filters)[number]) => {
    const vals = (sp.get(f.key) ?? "").split(",").filter(Boolean);
    const labels = vals.map((v) => f.opts.find((o) => o.value === v)?.label ?? v);
    return labels.length > 2 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ");
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-70")}>
      <label className="relative flex h-8 w-full items-center sm:w-64">
        <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-4" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks…"
          className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-7 text-[13px] outline-none placeholder:text-ink-4 focus:border-ink-3 focus:ring-4 focus:ring-ink/5" />
        {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 text-ink-4 hover:text-ink" aria-label="Clear search"><X size={13} /></button>}
      </label>

      {active.map((f) => (
        <FilterPopover key={f.key} f={f} value={sp.get(f.key)} onChange={(v) => setParam(f.key, v)}
          trigger={(toggle) => (
            <span className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-line-strong bg-surface text-[12.5px]">
              <button type="button" onClick={toggle} className="flex h-full items-center gap-1 px-2.5 hover:bg-subtle">
                <span className="text-ink-3">{f.label}</span>
                <span className="max-w-[180px] truncate font-medium text-ink">{valueLabel(f)}</span>
              </button>
              <button type="button" onClick={() => setParam(f.key, null)} className="flex h-full items-center border-l border-line px-1.5 text-ink-4 hover:bg-subtle hover:text-ink" aria-label={`Clear ${f.label}`}><X size={12} /></button>
            </span>
          )} />
      ))}

      {inactive.length > 0 && <AddFilterMenu filters={inactive} onPick={(k, v) => setParam(k, v)} />}

      {active.length > 1 && (
        <button type="button" onClick={() => {
          const next = new URLSearchParams(sp.toString());
          for (const f of filters) next.delete(f.key);
          start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
        }} className="h-8 px-1.5 text-[12.5px] text-ink-3 hover:text-ink">Clear all</button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Popover align="end" className="w-44" trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-2 hover:bg-subtle hover:text-ink">
            <Layers size={13} className="text-ink-3" />
            {group === "none" ? "Group" : `Grouped by ${GROUPS.find((g) => g.key === group)?.label.toLowerCase()}`}
            <ChevronDown size={12} className="text-ink-4" />
          </button>
        )}>
          {(close) => GROUPS.map((g) => <MenuItem key={g.key} active={g.key === group} onClick={() => { close(); setParam("group", g.key === "none" ? null : g.key); }}>{g.label}</MenuItem>)}
        </Popover>
        {hasCustom && (
          <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)}><BookmarkPlus size={14} /> Save view</Button>
        )}
      </div>
      <SaveViewModal open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  );
}

function TeamChip({ name }: { name: string }) {
  return <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-[8.5px] font-semibold text-ink-2">{name.slice(0, 2).toUpperCase()}</span>;
}

type FilterDef = { key: string; label: string; opts: Opt[]; multi?: boolean };

function FilterPopover({ f, value, onChange, trigger }: { f: FilterDef; value: string | null; onChange: (v: string | null) => void; trigger: (toggle: () => void) => React.ReactNode }) {
  return (
    <Popover className="w-64" trigger={({ toggle }) => <>{trigger(toggle)}</>}>
      {(close) => <OptionList f={f} value={value} onChange={onChange} close={close} />}
    </Popover>
  );
}

function AddFilterMenu({ filters, onPick }: { filters: FilterDef[]; onPick: (key: string, v: string | null) => void }) {
  const [which, setWhich] = useState<string | null>(null);
  const f = filters.find((x) => x.key === which);
  return (
    <Popover className="w-64" onOpenChange={(o) => !o && setWhich(null)} trigger={({ toggle }) => (
      <button type="button" onClick={toggle} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-2.5 text-[12.5px] text-ink-3 hover:border-ink-4 hover:text-ink">
        <ListFilter size={13} /> Filter
      </button>
    )}>
      {(close) => f ? (
        <div>
          <button type="button" onClick={() => setWhich(null)} className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-3 hover:text-ink">
            <ChevronDown size={12} className="rotate-90" /> {f.label}
          </button>
          <OptionList f={f} value={null} close={() => { setWhich(null); close(); }} onChange={(v) => { onPick(f.key, v); if (!f.multi) setWhich(null); }} />
        </div>
      ) : filters.map((x) => <MenuItem key={x.key} onClick={() => setWhich(x.key)}>{x.label}</MenuItem>)}
    </Popover>
  );
}

function OptionList({ f, value, onChange, close }: { f: FilterDef; value: string | null; onChange: (v: string | null) => void; close: () => void }) {
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const selected = new Set((local ?? "").split(",").filter(Boolean));
  const shown = query ? f.opts.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : f.opts;
  return (
    <div>
      {f.opts.length > 7 && (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter by ${f.label.toLowerCase()}…`}
          className="mb-1 w-full rounded-lg border-0 bg-subtle px-2.5 py-1.5 text-[13px] outline-none placeholder:text-ink-4" />
      )}
      <div className="max-h-72 overflow-y-auto scroll-thin">
        {shown.map((o) => {
          const on = selected.has(o.value);
          return (
            <button key={o.value} type="button"
              onClick={() => {
                if (f.multi) {
                  const next = new Set(selected);
                  if (on) next.delete(o.value); else next.add(o.value);
                  const v = next.size ? [...next].join(",") : null;
                  setLocal(v); onChange(v);
                } else { onChange(on ? null : o.value); close(); }
              }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle", on ? "text-ink" : "text-ink-2")}>
              {f.multi && <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border", on ? "border-ink bg-ink text-canvas" : "border-line-strong")}>{on && <Check size={10} strokeWidth={3} />}</span>}
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {!f.multi && on && <Check size={14} />}
            </button>
          );
        })}
        {!shown.length && <div className="px-2 py-3 text-center text-[12.5px] text-ink-4">{f.opts.length ? "No matches" : `No ${f.label.toLowerCase()}s yet`}</div>}
      </div>
    </div>
  );
}

function SaveViewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    const filters: Record<string, unknown> = {};
    for (const k of ["view", "owner", "team", "project", "tag", "search", "group"]) { const v = sp.get(k); if (v) filters[k] = v; }
    for (const k of ["priority", "status"]) { const v = sp.get(k); if (v) filters[k] = v.split(","); }
    const r = await saveTaskView(name, filters);
    if (!r.ok) return toast(r.error, "error");
    toast(`Saved “${name.trim()}”`, "success");
    setName(""); onClose(); router.refresh();
  });
  return (
    <Modal open={open} onClose={onClose} width={420} title="Save view" description="Keep this combination of tab, filters and grouping one click away."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || pending} onClick={submit}>{pending ? "Saving…" : "Save view"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit(); }}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Logistics — high priority" className="field" maxLength={60} />
      </form>
    </Modal>
  );
}
