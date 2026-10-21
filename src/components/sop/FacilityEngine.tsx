"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { saveEngineScenario } from "@/server/sop/capacityActions";
import { DEFAULT_ENGINE, runEngine, type EngineInput, type Facility } from "@/lib/facilityEngine";
import { cn } from "@/lib/cn";

const fmt = (v: number) => (Number.isFinite(v) ? new Intl.NumberFormat("en-IN").format(Math.round(v)) : "∞");
const d1 = (v: number) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "∞");

/** What-if calculator: facility capacities + channel workloads → days needed, bottleneck, extra stickering capacity. */
export function FacilityEngine({ initial, canSave, savedAt }: { initial: EngineInput; canSave: boolean; savedAt: string | null }) {
  const [x, setX] = useState<EngineInput>(initial);
  const r = useMemo(() => runEngine(x), [x]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const num = (v: number, on: (n: number) => void, w = "w-[84px]") => (
    <input inputMode="numeric" className={cn(w, "rounded-md bg-transparent px-1.5 py-1 text-right tabular outline-none hover:bg-subtle focus:bg-info-soft/50")}
      value={v ? fmt(v) : ""} placeholder="0" onChange={(e) => on(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} />
  );
  const setCap = (i: number, k: "inward" | "outward" | "sticker", v: number) => setX((s) => ({ ...s, caps: s.caps.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setLoad = (i: number, patch: Partial<EngineInput["loads"][number]>) => setX((s) => ({ ...s, loads: s.loads.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  return (
    <div className="space-y-5 p-4 md:p-5">
      {/* bottom line */}
      <div className="grid gap-3 md:grid-cols-2">
        {r.facilities.map((f) => (
          <div key={f.facility} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between"><span className="text-[13.5px] font-semibold">{f.facility}</span><span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", f.bottleneck === "Stickering" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>Bottleneck: {f.bottleneck}</span></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["Inward", f.inwardDays], ["Outward", f.outwardDays], ["Stickering", f.stickerDays]].map(([l, v]) => (
                <div key={l as string} className="rounded-md bg-subtle/70 px-2 py-1.5"><div className="text-[11px] text-ink-4">{l} days</div><div className={cn("text-[17px] font-semibold tabular", (v as number) > f.window ? "text-bad" : "text-ink")}>{d1(v as number)}</div></div>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
              Window <b className="font-semibold">{f.window} days</b>. Priority restickering ({fmt(f.priorityRestick)}) needs <b className="font-semibold">{fmt(f.requiredSticker)}/day</b>
              {f.additionalSticker > 0 ? <> — add <b className="font-semibold text-bad">{fmt(f.additionalSticker)} sticker/day</b> to finish in {f.daysAfter} days instead of {f.stickerDays}.</> : <> — current capacity is enough.</>}
              {f.technicalRestick > 0 && <> Technical restickering ({fmt(f.technicalRestick)}) runs separately: ~{f.technicalDays} days on the same line.</>}
            </p>
          </div>
        ))}
      </div>

      {/* inputs: capacities */}
      <div>
        <div className="label-caps mb-1.5 px-1">Facility capacity · units per day</div>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[480px]">
            <thead><tr><th>Facility</th><th className="text-right">Inward / day</th><th className="text-right">Outward / day</th><th className="text-right">Stickering / day</th></tr></thead>
            <tbody>{x.caps.map((c, i) => (
              <tr key={c.facility}><td className="font-medium">{c.facility}</td>
                <td className="text-right">{num(c.inward, (v) => setCap(i, "inward", v))}</td>
                <td className="text-right">{num(c.outward, (v) => setCap(i, "outward", v))}</td>
                <td className="text-right">{num(c.sticker, (v) => setCap(i, "sticker", v))}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* inputs: workloads + per-channel result */}
      <div>
        <div className="mb-1.5 flex items-center justify-between px-1"><span className="label-caps">Channel workloads · units</span>
          <button type="button" onClick={() => setX((s) => ({ ...s, loads: [...s.loads, { facility: "North WH" as Facility, channel: "", inwards: 0, picking: 0, restick: 0, outward: 0, priority: true }] }))} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><Plus size={12} />Channel</button>
        </div>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[900px]">
            <thead><tr><th>Facility</th><th>Channel</th><th className="text-right">Inwards</th><th className="text-right">Picking</th><th className="text-right">Restickering</th><th className="text-right">Outward</th><th className="text-center">Priority</th><th className="text-right">Days now</th><th className="text-right">Days after</th><th className="w-8" /></tr></thead>
            <tbody>{x.loads.map((l, i) => {
              const c = r.channels[i];
              return (
                <tr key={i}>
                  <td><select className="rounded-md bg-transparent py-1 outline-none hover:bg-subtle" value={l.facility} onChange={(e) => setLoad(i, { facility: e.target.value as Facility })}>{x.caps.map((k) => <option key={k.facility}>{k.facility}</option>)}</select></td>
                  <td><input className="w-[110px] rounded-md bg-transparent px-1.5 py-1 outline-none hover:bg-subtle focus:bg-info-soft/50" value={l.channel} placeholder="Channel" onChange={(e) => setLoad(i, { channel: e.target.value })} /></td>
                  <td className="text-right">{num(l.inwards, (v) => setLoad(i, { inwards: v }))}</td>
                  <td className="text-right">{num(l.picking, (v) => setLoad(i, { picking: v }))}</td>
                  <td className="text-right">{num(l.restick, (v) => setLoad(i, { restick: v }))}</td>
                  <td className="text-right">{num(l.outward, (v) => setLoad(i, { outward: v }))}</td>
                  <td className="text-center"><input type="checkbox" checked={l.priority} onChange={(e) => setLoad(i, { priority: e.target.checked })} title="Priority restickering (must fit in the window)" /></td>
                  <td className="text-right font-medium tabular">{c ? fmt(c.daysNow) : ""}</td>
                  <td className={cn("text-right font-semibold tabular", c && c.daysAfter < c.daysNow ? "text-ok" : "text-ink")}>{c ? fmt(c.daysAfter) : ""}</td>
                  <td><button type="button" onClick={() => setX((s) => ({ ...s, loads: s.loads.filter((_, j) => j !== i) }))} className="rounded p-1 text-ink-4 hover:text-bad" aria-label="Remove"><X size={12} /></button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="mt-2 px-1 text-[11.5px] text-ink-4">Pools run in parallel; the longer of inward and outward sets the window. Priority restickering must fit inside it — the extra sticker capacity is what it takes. “Days after” uses the added capacity.</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11.5px] text-ink-4">{savedAt ? `Saved scenario · ${new Date(savedAt).toLocaleDateString("en-IN")}` : "Defaults from the MP + Technical sheet"}</span>
        <Button size="sm" variant="ghost" onClick={() => setX(DEFAULT_ENGINE)}><RotateCcw size={13} />Sheet defaults</Button>
        {canSave && <Button size="sm" variant="primary" disabled={pending} onClick={() => start(async () => { const res = await saveEngineScenario(x); if (!res.ok) return toast(res.error, "error"); toast(res.message ?? "Saved", "success"); router.refresh(); })}>{pending ? "Saving…" : "Save scenario"}</Button>}
      </div>
    </div>
  );
}
