import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { MonthlyReviewView } from "@/components/sop/MonthlyReview";
import { monthlyReview, reviewPeriods } from "@/server/sop/monthly";
import { requireUser } from "@/server/auth";

export const metadata = { title: "S&OP · Monthly review" };

export default async function SopMonthlyReview({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const periods = await reviewPeriods();
  if (!periods.length) return <EmptyState title="No monthly review data yet" body="Plan vs actual by channel, week and category will appear here." />;
  const period = sp.period && periods.includes(sp.period) ? sp.period : periods[0];
  const d = await monthlyReview(period);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="seg">
          <span className="seg-label">Month</span>
          {periods.map((p) => (
            <Link key={p} href={`/sop?period=${p}`} data-on={p === period} className="seg-item">
              {new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}
            </Link>
          ))}
        </div>
        <span className="text-[12.5px] font-medium text-ink-3">Plan vs actual by warehouse · actuals from the S&OP review sheet (Snowflake feed later)</span>
      </div>
      <MonthlyReviewView d={d} />
    </div>
  );
}
