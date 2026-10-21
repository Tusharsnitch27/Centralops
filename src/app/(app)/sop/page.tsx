import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { MonthlyReviewView } from "@/components/sop/MonthlyReview";
import { monthlyReview, partialPeriods, periodOptions, reviewPeriods, type Grain } from "@/server/sop/monthly";
import { requireUser } from "@/server/auth";
import { lastRuns } from "@/server/sop/sync";
import { ago } from "@/lib/dates";

export const metadata = { title: "S&OP · Monthly review" };

const GRAINS: { key: Grain; label: string }[] = [{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Annual" }];

export default async function SopMonthlyReview({ searchParams }: { searchParams: Promise<{ grain?: string; p?: string; period?: string }> }) {
  const sp = await searchParams;
  await requireUser();
  const [months, partial, runs] = await Promise.all([reviewPeriods(), partialPeriods(), lastRuns()]);
  const okRuns = runs.filter((r) => r.status === "ok");
  const lastOk = okRuns.map((r) => r.finished_at ?? r.started_at).sort().at(-1);
  if (!months.length) return <EmptyState title="No monthly review data yet" body="Plan vs actual by channel, week and category will appear here." />;
  const grain: Grain = sp.grain === "quarter" || sp.grain === "year" ? sp.grain : "month";
  const options = periodOptions(months, grain);
  const want = sp.p ?? sp.period;
  const sel = options.find((o) => o.key === want) ?? options[0];
  const mtd = sel.months.filter((m) => partial[m]).map((m) => `${new Date(`${m}T00:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" })} 1–${partial[m]}`);
  const d = await monthlyReview(sel.months, grain === "month" ? sel.label : sel.label.split(" · ")[0]);
  const href = (g: Grain, p?: string) => `/sop?grain=${g}${p ? `&p=${p}` : ""}`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg">
          <span className="seg-label">View by</span>
          {GRAINS.map((g) => <Link key={g.key} href={href(g.key)} data-on={g.key === grain} className="seg-item">{g.label}</Link>)}
        </div>
        <div className="seg">
          {options.map((o) => (
            <Link key={o.key} href={href(grain, o.key)} data-on={o.key === sel.key} className="seg-item">
              {o.label}{grain === "month" && partial[o.key] ? ` · MTD 1–${partial[o.key]}` : ""}
            </Link>
          ))}
        </div>
      </div>
      <p className="mb-6 text-[12.5px] font-medium text-ink-3">
        {sel.months.length > 1 ? `${sel.months.length} months added up` : "Plan vs actual by warehouse"}{mtd.length && sel.months.length > 1 ? ` · includes ${mtd.join(", ")} (month to date)` : ""} · {lastOk ? <>actuals from Snowflake, refreshed {ago(lastOk)}{runs.some((r) => r.status === "failed") ? " (some feeds failed — see Settings › Integrations)" : ""}</> : "actuals from the S&OP workbook until the Snowflake feed is connected"}
      </p>
      <MonthlyReviewView d={d} />
    </div>
  );
}
