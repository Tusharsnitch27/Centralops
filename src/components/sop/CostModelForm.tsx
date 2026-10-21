"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { saveCostModel } from "@/server/sop/costActions";
import type { CostModel } from "@/server/sop/cost";

/** Inputs for the processing-cost method: which AOP lines count, which volumes count, manpower cost per WH-month. */
export function CostModelForm({ model, items, months, canEdit }: { model: CostModel; items: { id: string; name: string; wh: "South" | "North" }[]; months: string[]; canEdit: boolean }) {
  const [m, setM] = useState(model);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  return (
    <div className="space-y-5 p-4 md:p-5">
      <div>
        <div className="label">Volumes counted as “units processed”</div>
        <div className="flex flex-wrap gap-4 text-[13px]">
          {(["inward", "returns", "outward"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={m.volumes[k]} onChange={(e) => setM({ ...m, volumes: { ...m.volumes, [k]: e.target.checked } })} />{k === "inward" ? "Category inward" : k === "returns" ? "Returns putaway" : "Outward (B2C + B2B-MP + Retail)"}</label>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["South", "North"] as const).map((wh) => (
          <div key={wh}>
            <div className="label">{wh} — AOP lines included</div>
            <div className="space-y-1">{items.filter((i) => i.wh === wh).map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" disabled={!canEdit} checked={!m.excluded.includes(i.id)}
                onChange={(e) => setM({ ...m, excluded: e.target.checked ? m.excluded.filter((x) => x !== i.id) : [...m.excluded, i.id] })} />{i.name}</label>
            ))}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="label">Manpower cost (₹) — until the attendance feed is connected</div>
        <div className="overflow-x-auto">
          <table className="table-base min-w-[420px]"><thead><tr><th>Month</th><th className="text-right">South</th><th className="text-right">North</th></tr></thead>
            <tbody>{months.map((p) => (
              <tr key={p}><td>{mon(p)}</td>{(["South", "North"] as const).map((wh) => (
                <td key={wh} className="text-right"><input inputMode="numeric" disabled={!canEdit} className="w-[120px] rounded-md bg-transparent px-1.5 py-1 text-right tabular outline-none hover:bg-subtle focus:bg-info-soft/50" placeholder="—"
                  value={m.manpower[`${p}|${wh}`] ?? ""} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ""); const next = { ...m.manpower }; if (v) next[`${p}|${wh}`] = Number(v); else delete next[`${p}|${wh}`]; setM({ ...m, manpower: next }); }} /></td>
              ))}</tr>
            ))}</tbody></table>
        </div>
      </div>
      {canEdit && <div className="flex justify-end"><Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await saveCostModel(m); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Saved", "success"); router.refresh(); })}>{pending ? "Saving…" : "Save method"}</Button></div>}
    </div>
  );
}
