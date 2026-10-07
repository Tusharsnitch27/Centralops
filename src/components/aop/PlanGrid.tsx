"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, MessageSquare, Search, TriangleAlert, User2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/client";
import { updateValue } from "@/server/aop/actions";
import { fmtUnit, impactOf, monShort, parseUnit, STATUS_META, type AopStatus, type Direction, type Labels, type Measure, type UnitMode } from "@/server/aop/calc";
import { LineDrawer } from "./LineDrawer";

export interface Vals { plan: number | null; forecast: number | null; actual: number | null }
export interface RowMetrics { fyPlan: number; ytdPlan: number; ytdPlanReported: number; ytdActual: number; variance: number; impact: number; projection: number; gap: number; gapImpact: number; status: AopStatus; missingLast: number }
export interface GridRow {
  kind: "function" | "group" | "item"; id: string; parentId: string | null; fnId: string; depth: number; name: string; owner: string | null; ownerId: string | null;
  vals: Record<string, Vals>; m: RowMetrics; comments: number; openTasks: number; editable: boolean; direction: Direction; unit: "inr" | "num" | "pct";
  confidence: string | null; note: string | null;
}
type View = Measure | "variance" | "all";
type Edit = { id: string; period: string; field: Measure } | null;

const SHORT: Record<Measure, string> = { plan: "B", forecast: "P", actual: "A" };
const addV = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

export function PlanGrid({ cycleId, labels, months, lastClosed, currentMonth, threshold, rows, canEditPlan, userId, initialItem, initialFn, initialMeasure, initialMine, totals }: {
  cycleId: string; labels: Labels; months: string[]; lastClosed: string | null; currentMonth: string; threshold: number; rows: GridRow[]; canEditPlan: boolean; userId: string;
  initialItem: string | null; initialFn: string | null; initialMeasure: View; initialMine: boolean; totals: { vals: Record<string, Vals>; m: RowMetrics };
}) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const [view, setView] = useState<View>(initialMeasure);
  const [unit, setUnit] = useState<UnitMode>("lakh");
  const [query, setQuery] = useState("");
  const [fn, setFn] = useState<string | null>(initialFn);
  const [exceptions, setExceptions] = useState(false);
  const [mine, setMine] = useState(initialMine);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<Record<string, Record<string, Partial<Vals>>>>({});
  const [edit, setEdit] = useState<Edit>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  useEffect(() => { if (initialItem) setDrawer(initialItem); }, [initialItem]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const u = localStorage.getItem("aop.unit"); if (u === "inr" || u === "lakh" || u === "cr") setUnit(u); } catch {} }, []);
  useEffect(() => { setOver({}); }, [rows]);
  // keep ?item= in the URL so the drawer deep-links
  const prevDrawer = useRef<string | null>(null);
  useEffect(() => {
    if (drawer === prevDrawer.current) return;
    const url = new URL(window.location.href);
    if (drawer) url.searchParams.set("item", drawer); else if (prevDrawer.current) url.searchParams.delete("item");
    prevDrawer.current = drawer;
    window.history.replaceState(window.history.state, "", url.toString());
  }, [drawer]);

  const fns = rows.filter((r) => r.kind === "function");
  const items = rows.filter((r) => r.kind === "item");
  const valsOf = useCallback((r: GridRow, p: string): Vals => ({ ...(r.vals[p] ?? { plan: null, forecast: null, actual: null }), ...(over[r.id]?.[p] ?? {}) }), [over]);

  // sections: descendant items, recomputed from (possibly edited) item values
  const desc = useMemo(() => {
    const parent = new Map(rows.map((r) => [r.id, r.parentId]));
    const out = new Map<string, GridRow[]>();
    for (const it of items) { let p = it.parentId; while (p) { out.set(p, [...(out.get(p) ?? []), it]); p = parent.get(p) ?? null; } }
    return out;
  }, [rows, items]);
  const sectionVals = useCallback((id: string, p: string): Vals => {
    let v: Vals = { plan: null, forecast: null, actual: null };
    for (const it of desc.get(id) ?? []) { const x = valsOf(it, p); v = { plan: addV(v.plan, x.plan), forecast: addV(v.forecast, x.forecast), actual: addV(v.actual, x.actual) }; }
    return v;
  }, [desc, valsOf]);

  const ql = query.trim().toLowerCase();
  const itemVisible = useCallback((r: GridRow) => {
    if (fn && r.fnId !== fn) return false;
    if (mine && !r.editable) return false;
    if (exceptions && r.m.status === "on_track" && !r.m.missingLast) return false;
    if (ql && !`${r.name} ${r.owner ?? ""}`.toLowerCase().includes(ql) && !rows.some((s) => s.id === r.parentId && s.name.toLowerCase().includes(ql)) && !fns.find((f) => f.id === r.fnId)?.name.toLowerCase().includes(ql)) return false;
    return true;
  }, [fn, mine, exceptions, ql, rows, fns]);
  const visibleItems = useMemo(() => new Set(items.filter(itemVisible).map((r) => r.id)), [items, itemVisible]);
  const shown = useMemo(() => {
    const parent = new Map(rows.map((r) => [r.id, r.parentId]));
    const hiddenByCollapse = (r: GridRow) => { let p = r.parentId; while (p) { if (collapsed.has(p)) return true; p = parent.get(p) ?? null; } return false; };
    return rows.filter((r) => (r.kind === "item" ? visibleItems.has(r.id) : (desc.get(r.id) ?? []).some((i) => visibleItems.has(i.id))) && !hiddenByCollapse(r));
  }, [rows, visibleItems, desc, collapsed]);
  const editableOrder = useMemo(() => shown.filter((r) => r.kind === "item" && r.editable).map((r) => r.id), [shown]);

  const fieldsFor = (v: View): Measure[] => (v === "all" ? ["plan", "forecast", "actual"] : v === "variance" ? [] : [v]);
  const canEditCell = (r: GridRow, field: Measure, p: string) => r.kind === "item" && r.editable && (field !== "plan" || canEditPlan) && !(field === "actual" && p > currentMonth);

  const commit = (r: GridRow, p: string, field: Measure, raw: string, move?: "down" | "right" | "left" | "up") => {
    const cur = valsOf(r, p)[field];
    const val = parseUnit(raw, unit);
    if (val !== null && Number.isNaN(val)) { toast("Enter a number, e.g. 12.5 or 12.5L", "error"); return; }
    if (move) moveEdit(r.id, p, field, move); else setEdit(null);
    if (val === cur || (val != null && cur != null && Math.abs(val - cur) < 0.005)) return;
    setOver((o) => ({ ...o, [r.id]: { ...o[r.id], [p]: { ...o[r.id]?.[p], [field]: val } } }));
    start(async () => {
      const res = await updateValue({ itemId: r.id, period: p, field, value: val });
      if (!res.ok) {
        toast(res.error, "error");
        setOver((o) => ({ ...o, [r.id]: { ...o[r.id], [p]: { ...o[r.id]?.[p], [field]: cur } } }));
      } else router.refresh();
    });
  };
  const moveEdit = (id: string, p: string, field: Measure, dir: "down" | "right" | "left" | "up") => {
    if (dir === "down" || dir === "up") {
      const i = editableOrder.indexOf(id) + (dir === "down" ? 1 : -1);
      const next = editableOrder[i];
      setEdit(next ? { id: next, period: p, field } : null);
    } else {
      const flds = fieldsFor(view);
      const cols = months.flatMap((m) => flds.map((f) => ({ m, f })));
      const i = cols.findIndex((c) => c.m === p && c.f === field) + (dir === "right" ? 1 : -1);
      setEdit(cols[i] ? { id, period: cols[i].m, field: cols[i].f } : null);
    }
  };

  const setU = (u: UnitMode) => { setUnit(u); try { localStorage.setItem("aop.unit", u); } catch {} };
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allCollapsed = collapsed.size > 0;
  const fmt = (v: number | null | undefined) => fmtUnit(v ?? null, unit);
  const isClosed = (p: string) => !!lastClosed && p <= lastClosed;
  const flds = fieldsFor(view);
  const colsPerMonth = view === "all" ? 3 : 1;
  const unitLabel = unit === "inr" ? "₹" : unit === "lakh" ? "₹ Lakh" : "₹ Cr";

  /* ---------- cells ---------- */
  const monthCells = (r: GridRow, isSection: boolean) => months.map((p) => {
    const v = isSection ? sectionVals(r.id, p) : valsOf(r, p);
    if (view === "variance") {
      const d = v.actual != null && v.plan != null ? v.actual - v.plan : null;
      const imp = d == null ? 0 : impactOf(r.direction, v.plan ?? 0, v.actual ?? 0);
      const bad = d != null && v.plan ? imp / Math.abs(v.plan) < -threshold : false;
      const good = d != null && v.plan ? imp / Math.abs(v.plan) > threshold : false;
      return <td key={p} className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap", bad && "text-bad", good && "text-ok", !isClosed(p) && "bg-subtle/40")}>{d == null ? "" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(Math.abs(d))}`}</td>;
    }
    return (
      <Fragment key={p}>
        {flds.map((f) => {
          const val = v[f];
          const editing = !isSection && edit?.id === r.id && edit.period === p && edit.field === f;
          const editableCell = !isSection && canEditCell(r, f, p);
          const missing = f === "actual" && isClosed(p) && val == null && ((v.plan ?? 0) !== 0 || (v.forecast ?? 0) !== 0);
          const off = f === "actual" && val != null && v.plan ? impactOf(r.direction, v.plan, val) / Math.abs(v.plan) : 0;
          return (
            <td key={f} onClick={(e) => { if (editableCell) { e.stopPropagation(); setEdit({ id: r.id, period: p, field: f }); } }}
              className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap relative", view === "all" && f === "plan" && "border-l border-line/70", !isClosed(p) && "bg-subtle/40",
                editableCell && "cursor-text hover:bg-info-soft/60", missing && !isSection && "bg-warn-soft/60", editing && "p-0")}
              title={missing ? `${labels.actual} missing` : undefined}>
              {editing ? (
                <input autoFocus defaultValue={val == null ? "" : fmtUnit(val, unit).replace(/,/g, "")} onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => commit(r, p, f, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); setEdit(null); }
                    if (e.key === "Enter") { e.preventDefault(); commit(r, p, f, e.currentTarget.value, e.shiftKey ? "up" : "down"); }
                    if (e.key === "Tab") { e.preventDefault(); commit(r, p, f, e.currentTarget.value, e.shiftKey ? "left" : "right"); }
                  }}
                  className="h-full w-full bg-surface px-2 text-right text-[12.5px] tabular outline-none ring-2 ring-inset ring-info" />
              ) : (
                <span className={cn(f === "actual" && off < -threshold && "text-bad", f === "plan" && view === "all" && "text-ink-3", f === "forecast" && "text-ink-2")}>
                  {missing && !isSection ? <span className="text-[11px] text-warn">—</span> : fmt(val)}
                </span>
              )}
            </td>
          );
        })}
      </Fragment>
    );
  });

  const tailCells = (r: GridRow) => {
    const m = r.m;
    const pctV = m.ytdPlanReported ? m.variance / Math.abs(m.ytdPlanReported) : null;
    const tone = Math.abs(m.impact) < Math.abs(m.ytdPlanReported) * 0.005 ? "text-ink-3" : m.impact < 0 ? "text-bad" : "text-ok";
    const st = STATUS_META[m.status];
    return (
      <>
        <td className="h-8 min-w-[76px] border-b border-l border-line/70 px-2 text-right tabular whitespace-nowrap">{fmt(m.ytdPlan)}</td>
        <td className="h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap">{fmt(m.ytdActual)}</td>
        <td className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap", tone)}>{m.variance ? `${m.variance > 0 ? "+" : "−"}${fmt(Math.abs(m.variance))}` : ""}</td>
        <td className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap", tone)}>{pctV == null ? "" : `${pctV > 0 ? "+" : pctV < 0 ? "−" : ""}${Math.abs(pctV * 100).toFixed(1)}%`}</td>
        <td className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap", m.gapImpact < 0 && Math.abs(m.gap) > Math.abs(m.fyPlan) * threshold ? "text-bad" : "")}>{fmt(m.projection)}</td>
        <td className="px-2">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-2">
            <span className={cn("size-1.5 rounded-full", st.tone === "red" ? "bg-bad" : st.tone === "amber" ? "bg-warn" : "bg-ok")} />{st.label}
          </span>
        </td>
        <td className="px-2 text-right">
          <span className="inline-flex items-center gap-2 text-[11px] text-ink-3">
            {r.kind === "item" && r.m.missingLast > 0 && <span title={`${labels.actual} missing for the last closed month`} className="text-warn"><TriangleAlert size={12} /></span>}
            {r.comments > 0 && <span className="inline-flex items-center gap-0.5" title={`${r.comments} comments`}><MessageSquare size={12} />{r.comments}</span>}
            {r.openTasks > 0 && <span className="inline-flex items-center gap-0.5" title={`${r.openTasks} open tasks`}><ListChecks size={12} />{r.openTasks}</span>}
          </span>
        </td>
      </>
    );
  };

  const exceptionsCount = items.filter((r) => r.m.status !== "on_track" || r.m.missingLast).length;

  return (
    <div>
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lines, vendors, owners" className="field h-8 w-[230px] py-1 pl-8 text-[12.5px]" />
        </div>
        <select value={fn ?? ""} onChange={(e) => setFn(e.target.value || null)} className="field h-8 w-auto py-1 pr-7 text-[12.5px]">
          <option value="">All functions</option>
          {fns.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <Chip on={exceptions} onClick={() => setExceptions(!exceptions)}><TriangleAlert size={12} />Exceptions <span className="tabular text-ink-4">{exceptionsCount}</span></Chip>
        <Chip on={mine} onClick={() => setMine(!mine)}><User2 size={12} />My lines</Chip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented value={view} onChange={(v) => { setView(v as View); setEdit(null); }}
            options={[["plan", labels.plan], ["forecast", labels.forecast], ["actual", labels.actual], ["variance", "Variance"], ["all", "All"]]} />
          <Segmented value={unit} onChange={(v) => setU(v as UnitMode)} options={[["inr", "₹"], ["lakh", "Lakh"], ["cr", "Cr"]]} />
          <button type="button" title={allCollapsed ? "Expand all" : "Collapse all"} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(rows.filter((r) => r.kind === "function").map((r) => r.id)))}
            className="flex size-8 items-center justify-center rounded-lg text-ink-3 ring-1 ring-inset ring-line-strong hover:bg-subtle hover:text-ink">
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div ref={scrollRef} className="scroll-thin max-h-[calc(100dvh-250px)] min-h-[320px] overflow-auto">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px] [&_th]:h-9 [&_th]:whitespace-nowrap [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.04em] [&_th]:text-ink-3">
            <thead>
              <tr>
                <th rowSpan={view === "all" ? 2 : 1} className="sticky left-0 top-0 z-30 w-[300px] min-w-[300px] border-b border-r border-line bg-surface px-3 text-left">
                  <span className="text-ink-3">Function › Group › Line</span>
                  <span className="ml-2 font-normal normal-case tracking-normal text-ink-4">{unitLabel}</span>
                </th>
                <th rowSpan={view === "all" ? 2 : 1} className="sticky top-0 z-20 border-b border-line bg-surface px-2 text-left">Owner</th>
                <th rowSpan={view === "all" ? 2 : 1} className="sticky top-0 z-20 border-b border-line bg-surface px-2 text-right">FY {labels.plan}</th>
                {months.map((p) => (
                  <th key={p} colSpan={colsPerMonth} className={cn("sticky top-0 z-20 border-b border-line bg-surface px-2 text-right", view === "all" && "border-l text-center", p === lastClosed && "text-ink")}>
                    {monShort(p)}{p === currentMonth && <span className="ml-1 font-normal normal-case text-ink-4">now</span>}
                  </th>
                ))}
                {(["YTD " + labels.plan, "YTD " + labels.actual, "Var", "Var %", "FY proj.", "Status", ""] as const).map((h, i) => (
                  <th key={i} rowSpan={view === "all" ? 2 : 1} className={cn("sticky top-0 z-20 border-b border-line bg-surface px-2", i < 5 ? "text-right" : "text-left", i === 0 && "border-l")}>{h}</th>
                ))}
              </tr>
              {view === "all" && (
                <tr>
                  {months.flatMap((p) => flds.map((f) => (
                    <th key={p + f} className={cn("sticky top-9 z-20 border-b border-line bg-surface px-2 text-right text-[10.5px]", f === "plan" && "border-l")} title={labels[f]}>{SHORT[f]}</th>
                  )))}
                </tr>
              )}
            </thead>
            <tbody>
              <tr className="bg-subtle font-medium">
                <td className="sticky left-0 z-10 border-b border-r border-line bg-subtle px-3 text-ink">Total plan</td>
                <td className="border-b border-line" />
                <td className="h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap">{fmt(totals.m.fyPlan)}</td>
                {months.map((p) => {
                  const v = totals.vals[p] ?? { plan: null, forecast: null, actual: null };
                  if (view === "variance") return <td key={p} className="h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap">{v.actual != null && v.plan != null ? fmt(v.actual - v.plan) : ""}</td>;
                  return <Fragment key={p}>{flds.map((f) => <td key={f} className={cn("h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap", view === "all" && f === "plan" && "border-l border-line/70")}>{fmt(v[f])}</td>)}</Fragment>;
                })}
                {tailCells({ ...rows[0], kind: "function", m: totals.m, comments: 0, openTasks: 0 } as GridRow)}
              </tr>
              {shown.map((r) => {
                const isSection = r.kind !== "item";
                const open = !collapsed.has(r.id);
                return (
                  <tr key={r.id} onClick={() => (isSection ? toggle(r.id) : setDrawer(r.id))}
                    className={cn("group cursor-pointer", r.kind === "function" && "bg-subtle/70 font-medium", r.kind === "group" && "font-medium", drawer === r.id && "bg-info-soft/50")}>
                    <td className={cn("sticky left-0 z-10 border-b border-r border-line/70 px-3 group-hover:bg-subtle", r.kind === "function" ? "bg-subtle" : drawer === r.id ? "bg-info-soft" : "bg-surface")}>
                      <div className="flex h-8 items-center gap-1.5" style={{ paddingLeft: r.depth * 14 }}>
                        {isSection ? (open ? <ChevronDown size={13} className="shrink-0 text-ink-4" /> : <ChevronRight size={13} className="shrink-0 text-ink-4" />) : <span className="w-[13px] shrink-0" />}
                        <span className={cn("truncate", r.kind === "item" ? "text-ink" : "text-ink")} title={r.note ?? r.name}>{r.name}</span>
                        {r.kind === "item" && r.editable && <span className="ml-auto hidden text-[10.5px] text-ink-4 group-hover:inline">open</span>}
                      </div>
                    </td>
                    <td className="max-w-[110px] truncate border-b border-line/70 px-2 text-[12px] text-ink-3">{r.owner ?? ""}</td>
                    <td className="h-8 min-w-[76px] border-b border-line/70 px-2 text-right tabular whitespace-nowrap">{fmt(r.m.fyPlan)}</td>
                    {monthCells(r, isSection)}
                    {tailCells(r)}
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={99} className="px-3 py-10 text-center text-ink-3">No lines match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11.5px] text-ink-3">
          <span>{visibleItems.size} of {items.length} lines</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-warn-soft ring-1 ring-warn/30" />{labels.actual} missing after month close</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-subtle ring-1 ring-line" />Open months</span>
          <span className="ml-auto">Click a value to edit · Enter ↓ · Tab → · Esc cancel</span>
        </div>
      </div>
      <LineDrawer itemId={drawer} onClose={() => setDrawer(null)} unit={unit} userId={userId} cycleId={cycleId} />
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] ring-1 ring-inset transition-colors", on ? "bg-ink text-white ring-ink [&_span]:text-white/70" : "text-ink-2 ring-line-strong hover:bg-subtle")}>
      {children}
    </button>
  );
}
export function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex h-8 items-center rounded-lg bg-subtle p-0.5 ring-1 ring-inset ring-line">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn("h-7 rounded-md px-2.5 text-[12px] transition-colors", value === v ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-ink-3 hover:text-ink")}>{l}</button>
      ))}
    </div>
  );
}
