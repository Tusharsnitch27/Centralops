import { requireSopOverview } from "@/server/sop/access";
import { EmptyState } from "@/components/ui";
import { MonthlyReviewView } from "@/components/sop/MonthlyReview";
import { PeriodPicker } from "@/components/sop/PeriodPicker";
import { DailyGrid } from "@/components/sop/LeaderBits";
import { Collapsible } from "@/components/ui/Collapsible";
import { monthlyReview } from "@/server/sop/monthly";
import { dailyDeviation } from "@/server/sop/daily";
import { resolvePeriod } from "@/server/sop/period";
import { lastRuns } from "@/server/sop/sync";
import { requireUser } from "@/server/auth";
import { ago } from "@/lib/dates";

export const metadata = { title: "S&OP · Monthly review" };

export default async function SopMonthlyReview({ searchParams }: { searchParams: Promise<{ grain?: string; p?: string; period?: string }> }) {
  await requireSopOverview();
  const per = await resolvePeriod(await searchParams);
  if (!per.sel) return <EmptyState title="No monthly review data yet" body="Plan vs actual by channel, week and category will appear here." />;
  const [d, daily, runs] = await Promise.all([monthlyReview(per.sel.months, per.label), dailyDeviation(per.sel.months), lastRuns()]);
  const lastOk = runs.filter((r) => r.status === "ok").map((r) => r.finished_at ?? r.started_at).sort().at(-1);
  const single = per.sel.months.length === 1;
  return (
    <div>
      <PeriodPicker base="/sop/monthly" grain={per.grain} options={per.options} selected={per.sel.key} partial={per.partial} />
      <p className="-mt-2 mb-5 px-1 text-[12px] text-ink-4">
        {per.sel.months.length > 1 ? `${per.sel.months.length} months added up · ` : ""}{lastOk ? `Actuals from Snowflake, refreshed ${ago(lastOk)}` : "Actuals come only from Snowflake — none yet, run a refresh (Data sources)"}
      </p>
      <MonthlyReviewView d={d} daily={daily.views} />
      <section id="daily" className="mt-6 scroll-mt-20 space-y-2">
        <h2 className="label-caps px-1">Day by day · plan vs actual</h2>
        {!daily.hasActuals
          ? <div className="card px-4 py-5 text-[12.5px] text-ink-3">Day-level alerts need daily actuals — they start with the first Snowflake refresh (Settings › Integrations). Day plans are already loaded for B2C (by channel) and Retail.</div>
          : single
            ? <Collapsible id="sop:daily" title="Days beyond ±20% of plan" sub="One square per day — even an on-plan month can hide swings that strain SLA and staffing">
                <div className="p-3"><DailyGrid views={daily.views} /></div>
              </Collapsible>
            : <div className="card overflow-x-auto"><table className="table-base min-w-[560px]"><thead><tr><th>Flow</th><th className="text-right">Days above</th><th className="text-right">Days below</th><th className="text-right">On plan</th></tr></thead>
                <tbody>{daily.views.map((v) => <tr key={v.key}><td className="font-medium">{v.title}</td><td className="text-right tabular text-[#2563eb]">{v.total.up}</td><td className="text-right tabular text-bad">{v.total.down}</td><td className="text-right tabular text-ok">{v.total.ok}</td></tr>)}</tbody></table>
                <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-4">Pick a single month to see the day-by-day grid.</p></div>}
      </section>
    </div>
  );
}
