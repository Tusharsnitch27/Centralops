"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { deleteStandard, mapFunction, mapSite, refreshManpower, setStandard } from "@/server/manpower/actions";
import type { RateRow } from "@/server/manpower/model";
import { today } from "@/lib/dates";
import { cn } from "@/lib/cn";

type Res = { ok: boolean; error?: string; message?: string };
function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return { pending, run: (fn: () => Promise<Res>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Saved", "success"); router.refresh(); } }) };
}
const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const when = (ts: string) => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

interface Run { id: string; trigger: string; status: string; from_date: string | null; to_date: string | null; rows_written: number | null; message: string | null; started_at: string }

/** Feed status, refresh / back-fill, and the last few pulls. */
export function ManpowerFeed({ configured, host, runs, lastDay, canEdit }: { configured: boolean; host: string | null; runs: Run[]; lastDay: string | null; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [from, setFrom] = useState("");
  const last = runs[0];
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-semibold">Manpower feed
            {!configured ? <Badge tone="amber" dot>Not connected</Badge> : last?.status === "failed" ? <Badge tone="red" dot>Last pull failed</Badge> : last ? <Badge tone="green" dot>Connected</Badge> : <Badge tone="neutral" dot>Waiting for first pull</Badge>}
          </div>
          <div className="text-[12.5px] text-ink-3">
            {configured ? <>Read-only from <span className="font-medium text-ink-2">{host}</span> every morning at 08:00 IST (last 10 days re-read, so late corrections land). Present day-equivalents (half day = 0.5) per day × facility × department, Day + Night shifts added — no attendance detail kept.</>
              : <>Set <code className="text-[11.5px]">ATTENDANCE_API_BASE_URL</code>, <code className="text-[11.5px]">MANPOWER_API_PATH</code> and <code className="text-[11.5px]">ATTENDANCE_MANPOWER_API_TOKEN</code> (from the attendance app) in Coolify, then redeploy.</>}
            {lastDay && <> Latest day in: <b className="text-ink-2">{lastDay}</b>.</>}
          </div>
        </div>
        {canEdit && configured && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" className="field h-8 w-[150px] text-[12.5px]" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} title="Back-fill from this date (optional)" />
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => refreshManpower(from || undefined))}><RefreshCw size={13} className={cn(pending && "animate-spin")} />{from ? "Back-fill" : "Refresh now"}</Button>
          </div>
        )}
      </div>
      {runs.length > 0 && (
        <div className="mt-3 divide-y divide-line/70 rounded-lg border border-line text-[12.5px]">
          {runs.map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
              <span className={cn("w-12 font-medium", r.status === "ok" ? "text-ok" : r.status === "failed" ? "text-bad" : "text-ink-3")}>{r.status}</span>
              <span className="w-28 text-ink-3">{when(r.started_at)}</span>
              <span className="text-ink-4">{r.trigger} · {r.from_date} → {r.to_date}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2" title={r.message ?? ""}>{r.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Their site / function names → South / North and capacity-planning departments. New names arrive unmapped. */
export function ManpowerMapping({ sites, funcs, departments, canEdit }: {
  sites: { site: string; warehouse: string; days: number; heads: number }[];
  funcs: { func: string; department: string | null; days: number; heads: number }[];
  departments: string[]; canEdit: boolean;
}) {
  const { pending, run } = useRun();
  const unmapped = funcs.filter((f) => !f.department).length;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3"><div className="text-[13.5px] font-semibold">Facilities → warehouse</div><div className="text-[12px] text-ink-3">Guessed from the name on arrival; change if wrong.</div></div>
        {sites.length ? (
          <table className="table-base">
            <thead><tr><th>Facility (attendance app)</th><th className="text-right">Avg heads</th><th>Counts as</th></tr></thead>
            <tbody>{sites.map((s) => (
              <tr key={s.site}>
                <td className="font-medium">{s.site}</td><td className="text-right tabular text-ink-3">{s.days ? fmt(s.heads) : "—"}</td>
                <td><select className="field h-8 py-0 text-[12.5px]" disabled={!canEdit || pending} value={s.warehouse} onChange={(e) => run(() => mapSite(s.site, e.target.value as "South"))}>
                  <option value="South">South WH</option><option value="North">North WH</option><option value="ignore">Not counted</option></select></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="px-4 py-3 text-[12.5px] text-ink-4">Sites appear after the first pull.</p>}
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3"><div className="flex items-center gap-2 text-[13.5px] font-semibold">Their departments → function {unmapped > 0 && <Badge tone="amber">{unmapped} unmapped</Badge>}</div><div className="text-[12px] text-ink-3">Matched by name on arrival; Admin / Ops / Logistics count as Support (overhead). Unmapped names aren’t counted.</div></div>
        {funcs.length ? (
          <table className="table-base">
            <thead><tr><th>Department (attendance app)</th><th className="text-right">Heads / day</th><th>Function</th></tr></thead>
            <tbody>{funcs.map((f) => (
              <tr key={f.func} className={cn(!f.department && "bg-warn-soft/30")}>
                <td className="font-medium">{f.func}</td><td className="text-right tabular text-ink-3">{f.days ? fmt(f.heads) : "—"}</td>
                <td><select className="field h-8 py-0 text-[12.5px]" disabled={!canEdit || pending} value={f.department ?? ""} onChange={(e) => run(() => mapFunction(f.func, e.target.value || null))}>
                  <option value="">Not counted / unmapped</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="px-4 py-3 text-[12.5px] text-ink-4">Functions appear after the first pull.</p>}
      </div>
    </div>
  );
}

/** Units per head per day per department × warehouse; a change applies from its date onwards. */
export function ManpowerStandards({ rates, departments, canEdit, refs = {} }: { rates: RateRow[]; departments: string[]; canEdit: boolean; refs?: Record<string, { actual: number | null; plan: number | null }> }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ department: "", south: true, north: true, rate: "", from: today(), note: "" });
  const t = today();
  const grid = useMemo(() => departments.map((d) => {
    const cell = (wh: "South" | "North") => {
      const rs = rates.filter((r) => r.department === d && r.warehouse === wh);
      return { cur: rs.filter((r) => r.effective_from <= t).at(-1) ?? null, next: rs.find((r) => r.effective_from > t) ?? null, history: rs };
    };
    return { d, South: cell("South"), North: cell("North") };
  }), [rates, departments, t]);
  const missing = grid.reduce((a, g) => a + (g.South.cur ? 0 : 1) + (g.North.cur ? 0 : 1), 0);
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card p-3 md:p-4">
          <div className="mb-2 text-[13px] font-semibold">Set a standard</div>
          <div className="grid gap-2 sm:grid-cols-[1.6fr_auto_0.8fr_0.9fr_1.2fr_auto] sm:items-end">
            <label className="block"><span className="label">Function</span><select className="field" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">Pick…</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></label>
            <div className="flex h-9 items-center gap-3 text-[12.5px]"><label className="flex items-center gap-1.5"><input type="checkbox" checked={f.south} onChange={(e) => setF({ ...f, south: e.target.checked })} />South</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={f.north} onChange={(e) => setF({ ...f, north: e.target.checked })} />North</label></div>
            <label className="block"><span className="label">Units / head / day</span><input className="field tabular" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="e.g. 180" /></label>
            <label className="block"><span className="label">From</span><input type="date" className="field" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="block"><span className="label">Note <span className="font-normal text-ink-4">(optional)</span></span><input className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. new pick-to-light" /></label>
            <Button variant="primary" disabled={pending || !f.department || !f.rate || (!f.south && !f.north)} onClick={() => run(async () => {
              const r = await setStandard({ department: f.department, warehouses: [...(f.south ? ["South" as const] : []), ...(f.north ? ["North" as const] : [])], unitsPerHead: Number(f.rate), effectiveFrom: f.from, note: f.note });
              if (r.ok) setF({ ...f, rate: "", note: "" });
              return r;
            })}><Plus size={13} />Save</Button>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-4">Days before the date keep the earlier standard, so past achieved % doesn’t move. Under each cell: units per head <b>did</b> this month and what the capacity <b>plan needs</b> per head — click one to fill the form.</p>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="table-base min-w-[640px]">
          <thead><tr><th>Function {missing > 0 && <span className="ml-1 font-normal normal-case text-warn">· {missing} not set</span>}</th><th className="text-right">South · units / head / day</th><th className="text-right">North · units / head / day</th></tr></thead>
          <tbody>{grid.map((g) => (
            <tr key={g.d} className="align-top">
              <td className="font-medium">{g.d}</td>
              {(["South", "North"] as const).map((wh) => { const c = g[wh]; return (
                <td key={wh} className="text-right">
                  {c.cur ? <span className="tabular font-medium">{c.cur.units_per_head}</span> : <span className="text-warn">not set</span>}
                  {c.cur && <span className="ml-1 text-[11px] text-ink-4">since {c.cur.effective_from}</span>}
                  {c.next && <div className="text-[11px] text-info">→ {c.next.units_per_head} from {c.next.effective_from}</div>}
                  {(() => { const r = refs[`${g.d}|${wh}`]; if (!r || (r.actual == null && r.plan == null)) return null;
                    const use = (v: number) => canEdit && setF({ ...f, department: g.d, south: wh === "South", north: wh === "North", rate: String(Math.round(v)) });
                    return (
                      <div className="mt-0.5 flex justify-end gap-2 text-[11px] text-ink-4">
                        {r.actual != null && <button type="button" disabled={!canEdit} onClick={() => use(r.actual!)} className="hover:text-ink hover:underline" title="Units per head achieved this month — click to use">did {fmt(r.actual)}</button>}
                        {r.plan != null && <button type="button" disabled={!canEdit} onClick={() => use(r.plan!)} className="hover:text-ink hover:underline" title="Capacity-plan required ÷ heads this month — click to use">plan needs {fmt(r.plan)}</button>}
                      </div>
                    ); })()}
                  {canEdit && c.history.length > 0 && (
                    <details className="mt-0.5 text-[11px] text-ink-4"><summary className="cursor-pointer">history</summary>
                      {c.history.map((h) => (
                        <div key={h.effective_from} className="flex items-center justify-end gap-1.5">{h.effective_from}: {h.units_per_head}{h.note ? ` · ${h.note}` : ""}{h.by ? ` · ${h.by}` : ""}
                          <button type="button" aria-label="Remove" disabled={pending} className="text-ink-4 hover:text-bad" onClick={() => confirm(`Remove ${g.d} ${wh} standard from ${h.effective_from}?`) && run(() => deleteStandard(g.d, wh, h.effective_from))}><Trash2 size={11} /></button>
                        </div>
                      ))}
                    </details>
                  )}
                </td>
              ); })}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
