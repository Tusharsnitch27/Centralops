// Cost per item by channel: warehouse ₹ (booked) + logistics ₹ per channel. Used on AOP › Unit costs.
import { EmptyState } from "@/components/ui";
import { cpi, n0, SplitBar } from "@/components/aop/processing/bits";
import { CHANNELS, type AttributionRow } from "@/server/aop/processingTypes";
import { inr } from "@/lib/format";

export function ChannelTable({ rows }: { rows: AttributionRow[] }) {
  if (!rows.length) return <EmptyState compact title="No cost attributed for this month yet" />;
  const by = (ch: string, fam: AttributionRow["family"]) => rows.filter((r) => r.channel === ch && r.family === fam);
  // units repeat per process row of a channel; take the largest, not the sum. ponytail: assumes one unit basis per channel × family
  // …within a warehouse; South + North are then added
  const units = (rs: AttributionRow[]) => {
    const per = new Map<string, number>();
    for (const r of rs) per.set(r.warehouse, Math.max(per.get(r.warehouse) ?? 0, r.units ?? 0));
    return [...per.values()].reduce((a, n) => a + n, 0) || null;
  };
  // logistics rows are per vendor (disjoint AWBs) → sum
  const sumUnits = (rs: AttributionRow[]) => rs.reduce((a, r) => a + (r.units ?? 0), 0) || null;
  const channels = [...CHANNELS.filter((c) => rows.some((r) => r.channel === c)), ...[...new Set(rows.map((r) => r.channel))].filter((c) => !(CHANNELS as readonly string[]).includes(c))];
  const data = channels.map((ch) => {
    const w = by(ch, "warehouse"), l = by(ch, "logistics");
    const wAmt = w.reduce((a, r) => a + r.amount, 0), lAmt = l.reduce((a, r) => a + r.amount, 0);
    const wU = units(w), lU = sumUnits(l);
    const basis = l.some((r) => r.basis === "pending") ? "pending" : l.some((r) => r.basis === "allocated") ? "allocated" : l.length ? "direct" : null;
    return { ch, w, wAmt, wU, lAmt, lU, basis, keys: [...new Set(l.map((r) => r.key))].join(" · "), procs: w.filter((r) => r.process).map((r) => ({ label: r.process, value: r.amount })) };
  }).filter((d) => d.wAmt || d.lAmt);
  // Shared (storage & handling) is carried by every item processed, not by the inventory-capacity line
  const items = data.filter((d) => d.ch !== "Shared").reduce((a, d) => a + (d.wU ?? 0), 0) || null;
  for (const d of data) if (d.ch === "Shared") d.wU = items;
  const totW = data.reduce((a, d) => a + d.wAmt, 0), totL = data.reduce((a, d) => a + d.lAmt, 0);
  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[1040px]">
        <thead><tr><th>Channel</th><th>Warehouse ₹ (by process)</th><th className="text-right">Units</th><th className="text-right">WH CPI</th><th className="text-right">Logistics ₹</th><th className="text-right">Shipments</th><th className="text-right">₹ / shipment</th><th className="text-right" title="(warehouse ₹ + logistics ₹) ÷ items">Total ₹ / item</th></tr></thead>
        <tbody>
          {data.map((d) => {
            const wc = d.wU ? d.wAmt / d.wU : null, lc = d.lU ? d.lAmt / d.lU : null;
            return (
              <tr key={d.ch}>
                <td className="font-medium">{d.ch === "Shared" ? "Shared · storage, dispatch & site overhead" : d.ch}</td>
                <td>{d.wAmt ? (d.procs.length > 1 ? <SplitBar parts={d.procs} fmt={(v) => inr(v)} /> : <span className="tabular">{inr(d.wAmt)}</span>) : <span className="text-ink-4">—</span>}</td>
                <td className="text-right tabular text-ink-3">{n0(d.wU)}</td>
                <td className="text-right tabular">{cpi(wc)}</td>
                <td className="text-right tabular">
                  {d.basis === "pending" ? "—" : inr(d.lAmt || null)}
                </td>
                <td className="text-right tabular text-ink-3">{n0(d.lU)}</td>
                <td className="text-right tabular">{d.basis === "pending" ? "—" : cpi(lc)}</td>
                <td className="text-right font-semibold tabular">{d.wU ? cpi((d.wAmt + (d.basis === "pending" ? 0 : d.lAmt)) / d.wU) : d.basis === "pending" ? "—" : cpi(lc)}</td>
              </tr>
            );
          })}
          <tr className="bg-subtle/70 font-semibold"><td>Total</td><td className="tabular">{inr(totW)}</td><td /><td /><td className="text-right tabular">{inr(totL || null)}</td><td /><td /><td /></tr>
        </tbody>
      </table>
    </div>
  );
}
