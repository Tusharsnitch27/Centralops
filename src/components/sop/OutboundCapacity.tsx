"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { saveObCapacity } from "@/server/sop/capacityActions";
import type { ObDay } from "@/server/sop/capacityTools";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/cn";

const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));
const WHS = ["South", "North"] as const;
const dow = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString("en-IN", { weekday: "short", timeZone: "UTC" });

/** Day-level outbound plan: what MP and Retail need vs the capacity planned, per warehouse. Red = short. */
export function OutboundCapacity({ rows, canEdit }: { rows: ObDay[]; canEdit: boolean }) {
  const months = useMemo(() => [...new Set(rows.map((r) => r.day.slice(0, 7)))].sort(), [rows]);
  const [month, setMonth] = useState(months.at(-1) ?? new Date().toISOString().slice(0, 7));
  const [edits, setEdits] = useState<Record<string, ObDay>>({});
  const [extra, setExtra] = useState<ObDay[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const key = (r: Pick<ObDay, "day" | "warehouse">) => `${r.day}|${r.warehouse}`;
  const all = [...rows, ...extra].map((r) => edits[key(r)] ?? r);
  const days = [...new Set(all.filter((r) => r.day.startsWith(month)).map((r) => r.day))].sort();
  const at = (d: string, w: (typeof WHS)[number]) => all.find((r) => r.day === d && r.warehouse === w) ?? { day: d, warehouse: w, mp_required: 0, retail_required: 0, planned: 0 };
  const set = (d: string, w: (typeof WHS)[number], k: "mp_required" | "retail_required" | "planned", v: string) => {
    const cur = at(d, w);
    setEdits((e) => ({ ...e, [key(cur)]: { ...cur, [k]: Number(v.replace(/[^\d]/g, "")) || 0 } }));
  };
  const short = WHS.map((w) => ({ w, days: days.filter((d) => { const r = at(d, w); return r.mp_required + r.retail_required > r.planned; }).length, gap: days.reduce((a, d) => { const r = at(d, w); return a + Math.max(0, r.mp_required + r.retail_required - r.planned); }, 0) }));
  const addMonth = () => {
    const last = months.at(-1) ?? month;
    const [y, m] = last.split("-").map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    const base = rows.filter((r) => r.day.startsWith(last));
    const plannedOf = (w: string) => base.find((r) => r.warehouse === w)?.planned ?? 20000;
    const out: ObDay[] = [];
    for (let d = `${next}-01`; d.startsWith(next); d = addDays(d, 1)) for (const w of WHS) out.push({ day: d, warehouse: w, mp_required: 0, retail_required: 0, planned: plannedOf(w) });
    setExtra((x) => [...x, ...out]);
    setMonth(next);
  };
  const dirty = Object.keys(edits).length > 0 || extra.length > 0;
  const inp = (v: number, on: (s: string) => void) => canEdit
    ? <input inputMode="numeric" className="w-[72px] rounded-md bg-transparent px-1.5 py-1 text-right tabular outline-none hover:bg-subtle focus:bg-info-soft/50" value={v ? fmt(v) : ""} placeholder="0" onChange={(e) => on(e.target.value)} />
    : <span className="px-1.5 tabular">{fmt(v)}</span>;

  return (
    <div className="space-y-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">{[...new Set([...months, month])].sort().map((m) => <button key={m} type="button" data-on={m === month} onClick={() => setMonth(m)} className="seg-item">{new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })}</button>)}</div>
        {canEdit && <Button size="sm" variant="ghost" onClick={addMonth}><Plus size={13} />Next month</Button>}
        <span className="ml-auto flex flex-wrap gap-3 text-[12px]">
          {short.map((s) => <span key={s.w} className={s.days ? "text-bad" : "text-ok"}>{s.w}: {s.days ? <><b className="font-semibold">{s.days} day{s.days > 1 ? "s" : ""} short</b> · {fmt(s.gap)} units</> : "within capacity"}</span>)}
        </span>
      </div>
      <div className="card overflow-x-auto">
        <table className="table-base min-w-[860px]">
          <thead>
            <tr><th rowSpan={2}>Date</th>{WHS.map((w) => <th key={w} colSpan={5} className="text-center">{w} WH</th>)}</tr>
            <tr>{WHS.flatMap((w) => ["MP", "Retail", "Required", "Planned", "Delta"].map((h) => <th key={w + h} className="text-right">{h}</th>))}</tr>
          </thead>
          <tbody>{days.map((d) => (
            <tr key={d}>
              <td className="whitespace-nowrap"><span className="font-medium">{d.slice(8)}</span> <span className="text-ink-4">{dow(d)}</span></td>
              {WHS.flatMap((w) => {
                const r = at(d, w), req = r.mp_required + r.retail_required, delta = r.planned - req;
                return [
                  <td key={w + "mp"} className="text-right">{inp(r.mp_required, (v) => set(d, w, "mp_required", v))}</td>,
                  <td key={w + "rt"} className="text-right">{inp(r.retail_required, (v) => set(d, w, "retail_required", v))}</td>,
                  <td key={w + "rq"} className="text-right font-medium tabular">{fmt(req)}</td>,
                  <td key={w + "pl"} className="text-right">{inp(r.planned, (v) => set(d, w, "planned", v))}</td>,
                  <td key={w + "dl"} className={cn("text-right font-semibold tabular", delta < 0 ? "bg-bad-soft text-bad" : delta === 0 ? "text-ink-3" : "text-ok")}>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{fmt(Math.abs(delta))}</td>,
                ];
              })}
            </tr>
          ))}</tbody>
        </table>
        {!days.length && <p className="p-6 text-center text-[12.5px] text-ink-4">No days planned for this month yet{canEdit ? " — use Next month to start one." : "."}</p>}
      </div>
      {canEdit && dirty && (
        <div className="sticky bottom-[72px] z-10 flex items-center justify-end gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2 backdrop-blur lg:bottom-3">
          <span className="mr-auto text-[12px] text-warn">Unsaved changes</span>
          <Button onClick={() => { setEdits({}); setExtra([]); }}>Discard</Button>
          <Button variant="primary" disabled={pending} onClick={() => start(async () => {
            const r = await saveObCapacity([...Object.values(edits), ...extra.filter((x) => !edits[key(x)])]);
            if (!r.ok) return toast(r.error, "error");
            toast(r.message ?? "Saved", "success"); setEdits({}); setExtra([]); router.refresh();
          })}>{pending ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}
