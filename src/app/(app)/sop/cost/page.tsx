import { EmptyState } from "@/components/ui";
import { Collapsible } from "@/components/ui/Collapsible";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { CostModelForm } from "@/components/sop/CostModelForm";
import { canManage, requireUser } from "@/server/auth";
import { resolvePeriod } from "@/server/sop/period";
import { processingCost } from "@/server/sop/cost";
import { reviewPeriods } from "@/server/sop/monthly";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Processing cost" };
const inr = (v: number | null | undefined) => (v == null ? "—" : v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${new Intl.NumberFormat("en-IN").format(Math.round(v))}`);
const units = (v: number | null | undefined) => (v == null ? "—" : v >= 100000 ? `${(v / 100000).toFixed(2)}L` : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const rs = (v: number | null | undefined) => (v == null ? "—" : `₹${v.toFixed(2)}`);
const MON = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function ProcessingCost({ searchParams }: { searchParams: Promise<{ grain?: string; p?: string }> }) {
  const u = await requireUser();
  const per = await resolvePeriod(await searchParams);
  if (!per.sel) return <EmptyState title="No data yet" />;
  const [c, allMonths] = await Promise.all([processingCost(per.sel.months), reviewPeriods()]);
  const tot = (["South", "North"] as const).map((wh) => {
    const rs_ = c.rows.filter((r) => r.wh === wh);
    const cost = rs_.reduce((a, r) => a + r.total, 0), budget = rs_.reduce((a, r) => a + r.budget + (r.manpower ?? 0), 0), un = rs_.reduce((a, r) => a + (r.units ?? 0), 0);
    return { wh, cost, budget, units: un, perUnit: un ? cost / un : null, budgetPerUnit: un ? budget / un : null };
  });
  return (
    <div>
      <PeriodPicker base="/sop/cost" grain={per.grain} options={per.options} selected={per.sel.key} partial={per.partial} />
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {tot.map((t) => (
          <div key={t.wh} className="card p-4">
            <div className="text-[11.5px] font-medium text-ink-3">{t.wh} WH · cost per unit processed · {per.label}</div>
            <div className="mt-1 flex items-baseline gap-3"><span className="text-[26px] font-semibold tabular">{rs(t.perUnit)}</span>
              {t.budgetPerUnit != null && <span className={cn("text-[12.5px] font-medium", (t.perUnit ?? 0) > t.budgetPerUnit ? "text-bad" : "text-ok")}>budget {rs(t.budgetPerUnit)}</span>}</div>
            <div className="mt-1 text-[11.5px] text-ink-4">{inr(t.cost)} over {units(t.units)} units</div>
          </div>
        ))}
      </div>
      <section className="mb-6">
        <h2 className="label-caps mb-2 px-1">By month and warehouse</h2>
        <div className="card overflow-x-auto">
          <table className="table-base min-w-[960px]">
            <thead><tr><th>Month</th><th>WH</th><th className="text-right">AOP cost</th><th className="text-right">Manpower</th><th className="text-right">Total</th><th className="text-right">Inward</th><th className="text-right">Returns</th><th className="text-right">Outward</th><th className="text-right">Units</th><th className="text-right">Cost / unit</th><th className="text-right">Budget / unit</th></tr></thead>
            <tbody>{c.rows.map((r) => (
              <tr key={`${r.period}${r.wh}`}>
                <td className="font-medium">{MON(r.period)}</td><td>{r.wh}</td>
                <td className="text-right tabular" title={`${r.basis.actual} lines actual · ${r.basis.provision} provision · ${r.basis.budget} budget`}>{inr(r.cost)}{r.basis.actual === 0 && r.cost > 0 && <span className="ml-1 text-[10.5px] text-warn">{r.basis.provision ? "prov." : "bud."}</span>}</td>
                <td className="text-right tabular text-ink-3">{inr(r.manpower)}</td>
                <td className="text-right font-medium tabular">{inr(r.total)}</td>
                <td className="text-right tabular text-ink-3">{units(r.inward)}</td><td className="text-right tabular text-ink-3">{units(r.returns)}</td><td className="text-right tabular text-ink-3">{units(r.outward)}</td>
                <td className="text-right tabular">{units(r.units)}</td>
                <td className="text-right font-semibold tabular">{rs(r.perUnit)}</td>
                <td className={cn("text-right tabular", r.perUnit != null && r.budgetPerUnit != null && r.perUnit > r.budgetPerUnit ? "text-bad" : "text-ink-3")}>{rs(r.budgetPerUnit)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">AOP cost uses each line’s actual, else provision, else budget (marked). Units from the S&OP inventory flow. Manpower is a manual input until the attendance feed is connected.</p>
        </div>
      </section>
      <Collapsible id="sop:cost-model" title="Method & inputs" sub="Which AOP lines and volumes count, and manpower cost per warehouse — to be finalised">
        <CostModelForm model={c.model} items={c.items} months={allMonths.slice().sort()} canEdit={canManage(u)} />
      </Collapsible>
    </div>
  );
}
