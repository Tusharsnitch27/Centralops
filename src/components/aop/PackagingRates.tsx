"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { closePackagingMonth, deletePackageRate, setPackageRate } from "@/server/packaging/actions";
import { refreshFromSnowflake } from "@/server/sop/syncActions";
import type { RateRow } from "@/server/packaging/model";
import { today } from "@/lib/dates";
import { cn } from "@/lib/cn";

/** Rate card: the rate in force today per package type, its history, and a change that applies from a chosen date onwards. */
export function PackagingRates({ rates, canEdit }: { rates: RateRow[]; canEdit: boolean }) {
  const [qy, setQy] = useState("");
  const [f, setF] = useState({ packageType: "", rate: "", effectiveFrom: today(), note: "" });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const t = today();
  const types = useMemo(() => {
    const m = new Map<string, RateRow[]>();
    for (const r of rates) m.set(r.package_type, [...(m.get(r.package_type) ?? []), r]);
    return [...m.entries()].map(([type, rs]) => {
      const sorted = rs.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      const cur = [...sorted].reverse().find((r) => r.effective_from <= t) ?? null;
      const next = sorted.find((r) => r.effective_from > t) ?? null;
      return { type, cur, next, history: sorted };
    }).filter((x) => !qy || x.type.toLowerCase().includes(qy.toLowerCase())).sort((a, b) => a.type.localeCompare(b.type));
  }, [rates, qy, t]);
  const save = () => start(async () => {
    const r = await setPackageRate({ packageType: f.packageType, rate: Number(f.rate), effectiveFrom: f.effectiveFrom, note: f.note });
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Saved", "success"); setF({ packageType: "", rate: "", effectiveFrom: today(), note: "" }); router.refresh();
  });
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="card p-3 md:p-4">
          <div className="mb-2 text-[13px] font-semibold">Change a rate</div>
          <div className="grid gap-2 sm:grid-cols-[1.4fr_0.7fr_0.8fr_1.2fr_auto]">
            <input className="field" list="pkg-types" placeholder="Package type (e.g. MEDIUM BOX)" value={f.packageType} onChange={(e) => setF({ ...f, packageType: e.target.value })} />
            <datalist id="pkg-types">{types.map((x) => <option key={x.type} value={x.type} />)}</datalist>
            <input className="field" inputMode="decimal" placeholder="₹ / package" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            <input className="field" type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} title="Applies from this day onwards" />
            <input className="field" placeholder="Note (vendor, PO…) — optional" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <Button variant="primary" disabled={pending || !f.packageType.trim() || !f.rate} onClick={save}><Plus size={13} />Save</Button>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-4">The new rate applies from that date onwards; earlier days keep the previous rate. Closed months stay as they were frozen.</p>
        </div>
      )}
      <div className="card overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="text-[13px] font-semibold">Rate card</span><span className="text-[12px] text-ink-4">{types.length} package types</span>
          <label className="relative ml-auto w-56"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" /><input className="field h-8 pl-7" placeholder="Find a package…" value={qy} onChange={(e) => setQy(e.target.value)} /></label>
        </div>
        <table className="table-base min-w-[720px]">
          <thead><tr><th>Package type</th><th className="text-right">Rate today</th><th>Since</th><th>Upcoming</th><th>History</th><th className="w-10" /></tr></thead>
          <tbody>{types.map((x) => (
            <tr key={x.type} className="group align-top">
              <td className="font-medium">{x.type}</td>
              <td className="text-right font-semibold tabular">{x.cur ? `₹${x.cur.rate}` : <span className="text-ink-4">from {x.next?.effective_from}</span>}</td>
              <td className="text-[12px] text-ink-3">{x.cur?.effective_from ?? "—"}</td>
              <td className="text-[12px]">{x.next ? <span className="text-info">₹{x.next.rate} from {x.next.effective_from}</span> : <span className="text-ink-4">—</span>}</td>
              <td className="text-[11.5px] text-ink-4">{x.history.length > 1 ? x.history.map((h) => `₹${h.rate} (${h.effective_from})`).join(" → ") : "—"}</td>
              <td>{canEdit && x.history.length > 0 && (
                <button disabled={pending} title="Remove the latest rate" onClick={() => { const h = x.history.at(-1)!; if (confirm(`Remove ₹${h.rate} from ${h.effective_from} for ${x.type}?`)) start(async () => { const r = await deletePackageRate(x.type, h.effective_from); if (!r.ok) toast(r.error, "error"); else router.refresh(); }); }}
                  className={cn("rounded p-1 text-ink-4 opacity-0 transition-opacity hover:text-bad group-hover:opacity-100")}><Trash2 size={13} /></button>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Refresh the live month now; admins can also freeze a finished month. */
export function PkgMonthActions({ period, canClose }: { period: string; canClose: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Done", "success"); router.refresh(); } });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => refreshFromSnowflake("packaging"))}>{pending ? "Working…" : "Refresh from Snowflake"}</Button>
      {canClose && <Button size="sm" variant="primary" disabled={pending} onClick={() => confirm(`Close ${period.slice(0, 7)} and write it to the AOP actuals?`) && run(() => closePackagingMonth(period))}>Close month & write to AOP</Button>}
      <span className="text-[11.5px] text-ink-4">Refreshed daily at the S&OP sync time; a finished month closes itself on the first refresh of the next month.</span>
    </div>
  );
}
