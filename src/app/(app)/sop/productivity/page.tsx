import { requireSopOverview } from "@/server/sop/access";
import { EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { requireUser } from "@/server/auth";
import { resolvePeriod } from "@/server/sop/period";
import { engineScenario } from "@/server/sop/capacityTools";
import { q } from "@/server/db";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Productivity" };
const MON = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const n = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const pc = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Throughput vs facility capacity now; units per man-day by function once the attendance feed is connected. */
export default async function Productivity({ searchParams }: { searchParams: Promise<{ grain?: string; p?: string }> }) {
  await requireSopOverview();
  const per = await resolvePeriod(await searchParams);
  if (!per.sel) return <EmptyState title="No data yet" />;
  const [flow, periods, engine] = await Promise.all([
    q<{ period: string; warehouse: "South" | "North"; inward_category: number; inward_returns: number; outward: number }>(
      `select period::text as period, warehouse, coalesce(inward_category,0)::float8 as inward_category, coalesce(inward_returns,0)::float8 as inward_returns, coalesce(outward,0)::float8 as outward from sop_inventory_flow where period = any($1::date[]) order by period, warehouse desc`, [per.sel.months]),
    q<{ period: string; through_day: number }>(`select period::text as period, through_day from sop_review_periods where period = any($1::date[])`, [per.sel.months]),
    engineScenario(),
  ]);
  const cap = (wh: "South" | "North") => engine.input.caps.find((c) => c.facility === `${wh} WH`);
  const days = (p: string) => periods.find((x) => x.period === p)?.through_day ?? new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate();
  const rows = flow.map((f) => {
    const d = days(f.period), c = cap(f.warehouse);
    const inDay = (f.inward_category + f.inward_returns) / d, outDay = f.outward / d;
    return { ...f, d, inDay, outDay, inUtil: c?.inward ? inDay / c.inward : null, outUtil: c?.outward ? outDay / c.outward : null, c };
  });
  const tone = (u: number | null) => (u == null ? "" : u >= 1 ? "text-bad font-semibold" : u >= 0.85 ? "text-warn font-semibold" : u < 0.5 ? "text-ink-3" : "text-ok");
  return (
    <div>
      <PeriodPicker base="/sop/productivity" grain={per.grain} options={per.options} selected={per.sel.key} partial={per.partial} />
      <section className="mb-6">
        <h2 className="label-caps mb-2 px-1">Throughput vs facility capacity</h2>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Month</th><th>WH</th><th className="text-right">Inward / day</th><th className="text-right">Inward cap / day</th><th className="text-right">Inward util.</th><th className="text-right">Outward / day</th><th className="text-right">Outward cap / day</th><th className="text-right">Outward util.</th><th className="text-right">Units / man-day</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.period}${r.warehouse}`}>
                <td className="font-medium">{MON(r.period)}</td><td>{r.warehouse}</td>
                <td className="text-right tabular">{n(r.inDay)}</td><td className="text-right tabular text-ink-3">{n(r.c?.inward)}</td><td className={cn("text-right tabular", tone(r.inUtil))}>{pc(r.inUtil)}</td>
                <td className="text-right tabular">{n(r.outDay)}</td><td className="text-right tabular text-ink-3">{n(r.c?.outward)}</td><td className={cn("text-right tabular", tone(r.outUtil))}>{pc(r.outUtil)}</td>
                <td className="text-right text-[11.5px] text-ink-4">awaiting attendance</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Per day = month volume ÷ days covered (MTD for the current month). Capacity per day from S&amp;OP › Capacity planning › Facility capacity engine.</p>
        </div>
      </section>
      <section>
        <h2 className="label-caps mb-2 px-1">Productivity &amp; utilisation by function</h2>
        <div className="card p-5">
          <p className="text-[13px] text-ink-2">Ready for the warehouse attendance feed. Once the link is shared, each warehouse function gets:</p>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead><tr><th>Function</th><th>Output (from S&amp;OP feeds)</th><th>Input (attendance)</th><th>Measures</th></tr></thead>
              <tbody>
                {[["Inward (GRN + putaway)", "Category inward units", "Man-days in inward"], ["Pick, pack & dispatch", "B2C + B2B-MP + Retail outward units", "Man-days in outbound"], ["Returns processing", "Returns putaway units", "Man-days in returns"], ["Pre-pack & stickering", "Pre-pack units, restickering", "Man-days in VAS"]].map(([f, o, i]) => (
                  <tr key={f}><td className="font-medium">{f}</td><td className="text-ink-3">{o}</td><td className="text-ink-3">{i}</td><td className="text-ink-3">Units per man-day · utilisation vs standard · day-level swings</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
