// ₹ per item by month: warehouse (booked) ÷ units processed, logistics ÷ shipments. Used on AOP › Unit costs.
import { EmptyState } from "@/components/ui";
import { cpi, monLabel } from "@/components/aop/processing/bits";
import type { AttributionRow } from "@/server/aop/processingTypes";
import { inr } from "@/lib/format";

export function Economics({ months, rows }: { months: string[]; rows: AttributionRow[] }) {
  if (!months.length || !rows.length) return <EmptyState compact title="No attributed cost yet" />;
  // units repeat per process row; per family take the largest unit basis per channel, then sum channels. ponytail: same assumption as Processing › ④
  const fam = (p: string, f: AttributionRow["family"]) => {
    const rs = rows.filter((r) => r.period === p && r.family === f);
    const amt = rs.reduce((a, r) => a + r.amount, 0);
    const byCh = new Map<string, number>();
    // warehouse: process rows share a volume → max per channel × warehouse; logistics: vendor rows are disjoint AWBs → sum
    for (const r of rs) if (r.channel !== "Shared") {
      const k = f === "logistics" ? `${r.channel}|${r.process}` : `${r.channel}|${r.warehouse}`;
      byCh.set(k, f === "logistics" ? (byCh.get(k) ?? 0) + (r.units ?? 0) : Math.max(byCh.get(k) ?? 0, r.units ?? 0));
    }
    const units = [...byCh.values()].reduce((a, v) => a + v, 0);
    const pendingAmt = rs.filter((r) => r.basis === "pending").reduce((a, r) => a + r.amount, 0), mapped = amt - pendingAmt;
    return { amt, mapped, units, cpi: units ? mapped / units : null, pending: pendingAmt > 0, pendingAmt };
  };
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[760px]">
        <thead><tr><th>Month</th><th className="text-right">Warehouse ₹</th><th className="text-right">Units</th><th className="text-right">WH ₹ / item</th><th className="text-right">Logistics ₹</th><th className="text-right">Shipments</th><th className="text-right">Logistics ₹ / shipment</th><th className="text-right">Total ₹ / item</th></tr></thead>
        <tbody>{months.map((p) => {
          const w = fam(p, "warehouse"), l = fam(p, "logistics");
          return (
            <tr key={p}>
              <td className="font-medium">{monLabel(p)}</td>
              <td className="text-right tabular">{inr(w.amt || null)}</td><td className="text-right tabular text-ink-3">{w.units ? new Intl.NumberFormat("en-IN").format(Math.round(w.units)) : "—"}</td><td className="text-right tabular">{cpi(w.cpi)}</td>
              <td className="text-right tabular">{inr(l.amt || null)}</td>
              <td className="text-right tabular text-ink-3">{l.units ? new Intl.NumberFormat("en-IN").format(Math.round(l.units)) : "—"}</td><td className="text-right tabular">{cpi(l.cpi)}</td>
              <td className="text-right font-semibold tabular">{w.units ? cpi((w.amt + l.mapped) / w.units) : "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
