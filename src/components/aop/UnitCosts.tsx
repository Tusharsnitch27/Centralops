import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { inr } from "@/lib/format";
import type { StorageMonth } from "@/server/wcm/storage";

const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
const rs = (v: number | null, d = 2) => (v == null ? null : `₹${v.toFixed(d)}`);
const n0 = (v: number | null) => (v == null ? null : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const STREAMS = ["B2C forward", "B2B forward", "B2C returns", "B2B returns"];

/** AOP Overview › Unit costs: what one item costs to store, inward and process, per site, for the last closed months. */
export function UnitCosts({ months, href, cps, cpsHref }: { months: StorageMonth[]; href: string; cps?: { month: string; cpsB2c: number | null; cpuB2b: number | null }[]; cpsHref?: string }) {
  const periods = [...new Set(months.map((m) => m.period))];
  const get = (site: "South" | "North", p: string) => months.find((m) => m.site === site && m.period === p)!;
  const rows: { label: string; v: (m: StorageMonth) => string | null }[] = [
    { label: "Storage & handling", v: (m) => (m.sh == null ? null : inr(m.sh)) },
    { label: "Storage per item / month", v: (m) => rs(m.perItem) },
    { label: "Per bin / month", v: (m) => rs(m.perBin, 0) },
    { label: "Inward per unit", v: (m) => rs(m.inwardPerItem) },
    ...STREAMS.map((fn) => ({ label: `${fn[0].toUpperCase()}${fn.slice(1)} manpower`, v: (m: StorageMonth) => { const x = m.manpowerByFn.find((f) => f.fn === fn); return x ? inr(x.amount) : null; } })),
  ];
  return (
    <section aria-label="Unit costs">
      <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
        <div><h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Warehouse unit costs</h3><p className="text-[12px] text-ink-4">Booked actuals · last {periods.length} months</p></div>
        <Link href={href} className="flex items-center gap-1 text-[12.5px] font-medium text-accent-ink hover:underline">By category & bin <ArrowUpRight size={13} /></Link>
      </div>
      {cps && cps.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {([["B2C cost per shipment", "cpsB2c"], ["B2B cost per unit", "cpuB2b"]] as const).map(([label, k]) => (
            <Link key={k} href={cpsHref ?? href} className="card px-4 py-3 hover:bg-subtle">
              <div className="text-[11px] text-ink-4">{label} · all-India</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4">{cps.map((c, i) => (
                <span key={c.month} className={i === cps.length - 1 ? "text-[20px] font-semibold tabular text-ink" : "text-[13px] tabular text-ink-3"}>{rs(c[k]) ?? "—"} <span className="text-[11px] font-normal text-ink-4">{mon(c.month)}</span></span>))}</div>
            </Link>))}
        </div>)}
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
              <th rowSpan={2} className="px-5 py-2 text-left align-bottom font-semibold">Measure</th>
              {(["South", "North"] as const).map((s) => <th key={s} colSpan={periods.length} className="border-l border-line px-3 pt-2.5 text-center font-semibold text-ink-2">{s}</th>)}
            </tr>
            <tr className="text-[11px] text-ink-4">{(["South", "North"] as const).flatMap((s) => periods.map((p, i) => <th key={s + p} className={`px-3 pb-2 text-right font-medium ${i === 0 ? "border-l border-line" : ""}`}>{mon(p)}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line/70">
                <td className="px-5 py-2.5 font-medium text-ink">{r.label}</td>
                {(["South", "North"] as const).flatMap((s) => periods.map((p, i) => { const v = r.v(get(s, p)); return (
                  <td key={s + p} className={`px-3 py-2.5 text-right tabular ${i === 0 ? "border-l border-line" : ""} ${v == null ? "text-[11.5px] text-ink-4" : "text-ink"}`}>{v ?? "—"}</td>); }))}
              </tr>
            ))}
            <tr className="border-t border-line/70 text-[12px] text-ink-3">
              <td className="px-5 py-2.5">Average units on hand · inward units</td>
              {(["South", "North"] as const).flatMap((s) => periods.map((p, i) => { const m = get(s, p); return (
                <td key={s + p} className={`px-3 py-2.5 text-right tabular ${i === 0 ? "border-l border-line" : ""}`}>{n0(m.avgUnits) ?? "—"}<div className="text-ink-4">{n0(m.inwardUnits) ?? "no feed"}</div></td>); }))}
            </tr>
          </tbody>
        </table>
      </div></div>
    </section>
  );
}
