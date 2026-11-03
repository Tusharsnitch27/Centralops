"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { deleteWhCapacity, setWhCapacity } from "@/server/sop/capacityActions";
import { cn } from "@/lib/cn";

export interface CapSetting { warehouse: "South" | "North"; from: string; capacity: number; special: number | null; by: string | null; at: string }
const lakh = (v: number | null) => (v == null ? "—" : `${(v / 100000).toFixed(2)}L`);
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

/**
 * Capacity control: per warehouse, the main area (every category except the ones below) and the pre-pack area
 * (pre-packs — a set of any category, counted as packs — plus perfumes, shoes, bags and trolleys), from a month onwards.
 */
export function WhCapacityBar({ settings, canEdit }: { settings: CapSetting[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Saved", "success"); router.refresh(); }
  });
  return (
    <div className="border-b border-line bg-subtle/50 px-4 py-3 md:px-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="label-caps">Capacity control</span>
        <span className="text-[11.5px] text-ink-4">Warehouse = every category except pre-pack area items · Pre-pack area = pre-packs (packs) + perfumes, shoes, bags, trolleys</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(["South", "North"] as const).map((wh) => {
          const hist = settings.filter((s) => s.warehouse === wh);
          const cur = hist.find((s) => s.from <= thisMonth()) ?? hist.at(-1);
          return <Row key={wh} wh={wh} cur={cur} hist={hist} canEdit={canEdit} pending={pending}
            onSave={(v) => run(() => setWhCapacity({ warehouse: wh, ...v }))} onDelete={(from) => run(() => deleteWhCapacity(wh, from))} />;
        })}
      </div>
    </div>
  );
}

function Row({ wh, cur, hist, canEdit, pending, onSave, onDelete }: {
  wh: "South" | "North"; cur: CapSetting | undefined; hist: CapSetting[]; canEdit: boolean; pending: boolean;
  onSave: (v: { from: string; capacity: number; special: number | null }) => void; onDelete: (from: string) => void;
}) {
  const [cap, setCap] = useState(cur ? String(cur.capacity) : "");
  const [sp, setSp] = useState(cur?.special != null ? String(cur.special) : "");
  const [from, setFrom] = useState(thisMonth().slice(0, 7));
  const changed = cap !== (cur ? String(cur.capacity) : "") || sp !== (cur?.special != null ? String(cur.special) : "");
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold">{wh === "South" ? "South (BLR)" : "North (GGN)"}</span>
        <span className="text-[11.5px] text-ink-4">now {lakh(cur?.capacity ?? null)} · pre-pack area {lakh(cur?.special ?? null)}</span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="text-[11.5px] text-ink-3">Warehouse capacity (units)
          <input className="field mt-1 h-8 w-full tabular" inputMode="numeric" disabled={!canEdit || pending} value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))} />
          <span className="text-ink-4">{cap ? lakh(Number(cap)) : ""}</span>
        </label>
        <label className="text-[11.5px] text-ink-3">Pre-pack area capacity (units)
          <input className="field mt-1 h-8 w-full tabular" inputMode="numeric" placeholder="not set" disabled={!canEdit || pending} value={sp} onChange={(e) => setSp(e.target.value.replace(/[^\d]/g, ""))} />
          <span className="text-ink-4">{sp ? lakh(Number(sp)) : ""}</span>
        </label>
        <label className="text-[11.5px] text-ink-3">From
          <input type="month" className="field mt-1 h-8 w-[130px]" disabled={!canEdit || pending} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>&nbsp;</span>
        </label>
      </div>
      {canEdit && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" disabled={pending || !cap || !from || (!changed && hist.some((h) => h.from.startsWith(from)))}
            onClick={() => onSave({ from: `${from}-01`, capacity: Number(cap), special: sp ? Number(sp) : null })}>Save from {from ? mon(`${from}-01`) : "…"}</Button>
        </div>
      )}
      {hist.length > 0 && (
        <div className="mt-2 border-t border-line pt-2 text-[11.5px]">
          {hist.map((h) => (
            <div key={h.from} className={cn("flex items-center gap-2 py-0.5", h === cur ? "text-ink" : "text-ink-3")}>
              <span className="w-14 font-medium">{mon(h.from)}</span>
              <span className="tabular">{lakh(h.capacity)}</span><span className="text-ink-4">·</span><span className="tabular">pre-pack {lakh(h.special)}</span>
              {h.by && <span className="text-ink-4">· {h.by}</span>}
              {canEdit && hist.length > 1 && <button type="button" aria-label="Remove" disabled={pending} className="ml-auto text-ink-4 hover:text-bad"
                onClick={() => confirm(`Remove the ${wh} capacity from ${mon(h.from)}?`) && onDelete(h.from)}><Trash2 size={11} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
