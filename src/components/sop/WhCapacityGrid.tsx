"use client";
import { Fragment, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/client";
import { deleteWhCapacity, setWhCapacity } from "@/server/sop/capacityActions";
import { PREPACK_AREA_CATEGORIES, WAREHOUSE_CATEGORIES } from "@/lib/whAreas";
import { cn } from "@/lib/cn";

export interface CapSetting { warehouse: "South" | "North"; from: string; capacity: number; special: number | null; by: string | null; at: string }
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const WH = [["South", "South (BLR)"], ["North", "North (GGN)"]] as const;
const FIELDS = [["capacity", "Bin space (warehouse)"], ["special", "Floor space (pre-pack area)"]] as const;

/**
 * Capacity by month: a value entered for a month carries forward (auto-filled) to every later month until the next month that has its own.
 * Each change is stored as "from this month" — months already loaded take it at once.
 */
export function WhCapacityGrid({ months, settings, canEdit }: { months: string[]; settings: CapSetting[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Saved", "success"); router.refresh(); }
  });
  // value in force for a warehouse in a month, and whether that month set it
  const at = (w: "South" | "North", m: string) => {
    const hist = settings.filter((s) => s.warehouse === w).sort((a, b) => b.from.localeCompare(a.from));
    const s = hist.find((x) => x.from <= m);
    return { s, own: s?.from === m };
  };
  const save = (w: "South" | "North", m: string, field: "capacity" | "special", raw: string) => {
    const v = raw.replace(/[^\d]/g, "");
    const { s } = at(w, m);
    const cur = field === "capacity" ? s?.capacity : s?.special;
    if ((v === "" ? null : Number(v)) === (cur ?? null)) return;
    if (field === "capacity" && !v) return toast("Warehouse capacity can't be empty", "error");
    run(() => setWhCapacity({ warehouse: w, from: m, capacity: field === "capacity" ? Number(v) : (s?.capacity ?? 0), special: field === "special" ? (v ? Number(v) : null) : (s?.special ?? null) }));
  };
  return (
    <div className="card overflow-x-auto">
      <table className="table-base min-w-[1100px]">
        <thead><tr><th>Warehouse</th><th>Capacity (units)</th>{months.map((m) => <th key={m} className="text-right">{mon(m)}</th>)}</tr></thead>
        <tbody>
          {WH.map(([w, label]) => (
            <Fragment key={w}>
              {FIELDS.map(([f, fl], i) => (
                <tr key={f}>
                  <td className="font-semibold">{i === 0 ? label : ""}</td>
                  <td className="whitespace-nowrap text-ink-3">{fl}</td>
                  {months.map((m) => {
                    const { s, own } = at(w, m);
                    const v = f === "capacity" ? s?.capacity : s?.special;
                    return (
                      <td key={m} className="px-1.5 text-right">
                        <span className="group relative inline-flex items-center">
                          <input aria-label={`${label} ${fl} ${mon(m)}`} inputMode="numeric" disabled={!canEdit || pending} defaultValue={v != null ? new Intl.NumberFormat("en-IN").format(v) : ""} placeholder="—"
                            key={`${m}${v ?? ""}`}
                            className={cn("h-8 w-[92px] rounded-md border border-transparent bg-transparent px-1.5 text-right tabular outline-none focus:border-line-strong focus:bg-surface",
                              own ? "font-semibold text-ink" : "text-ink-4", canEdit && "hover:border-line")}
                            onBlur={(e) => save(w, m, f, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          {canEdit && own && i === 0 && m !== months[0] && (
                            <button type="button" aria-label={`Clear ${mon(m)} change`} disabled={pending} title="Clear this month's change (carry the earlier value)"
                              className="absolute -right-1.5 -top-1 hidden rounded-full bg-surface text-ink-4 shadow-sm hover:text-bad group-hover:block"
                              onClick={() => run(() => deleteWhCapacity(w, m))}><X size={11} /></button>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="grid gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-[11.5px] md:grid-cols-2">
        <p className="text-ink-3"><b className="font-semibold text-ink-2">Bin space (warehouse)</b> · {WAREHOUSE_CATEGORIES.join(", ")} — and any other category</p>
        <p className="text-ink-3"><b className="font-semibold text-ink-2">Floor space (pre-pack area)</b> · Pre-packs (a set of any category, counted in pieces — PP4 = 4), {PREPACK_AREA_CATEGORIES.join(", ")}</p>
        <p className="text-ink-4 md:col-span-2">Type a month&apos;s capacity and press Enter: later months fill with it until the next month you change. Bold = set that month · grey = carried forward.</p>
      </div>
    </div>
  );
}
