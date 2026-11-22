import Link from "next/link";
import { ButtonLink, EmptyState } from "@/components/ui";
import { AopHeader, cycleQs } from "@/components/aop/AopNav";
import { ReviewTable } from "@/components/aop/ReviewTable";
import { VarianceGrid } from "@/components/aop/VarianceGrid";
import { requireUser, canManage } from "@/server/auth";
import { editableItemIds, listCycles, loadModel, resolveCycle } from "@/server/aop/model";
import { summaryTree } from "@/server/aop/summaryData";
import { monShort } from "@/server/aop/calc";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Review" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ cycle?: string; period?: string; mine?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [cycles, cycle] = await Promise.all([listCycles(), resolveCycle(sp.cycle)]);
  if (!cycle) return <EmptyState title="No operating plan yet" action={<ButtonLink href="/aop/import" variant="primary">Import plan</ButtonLink>} />;
  const m = (await loadModel(cycle.id))!;
  const closedMonths = m.months.filter((p) => m.lastClosed && p <= m.lastClosed);
  const period = sp.period && m.months.includes(sp.period) ? sp.period : m.lastClosed ?? m.months[0];
  const tree = await summaryTree(m);
  const manage = canManage(user);
  const onlyMine = !manage || sp.mine === "1";
  const qs = (extra = "") => cycleQs(cycle.id, cycles, extra);
  return (
    <div className="animate-fade-in">
      <AopHeader active="review" cycleId={cycle.id} cycles={cycles} title="Review"
        subtitle={manage ? "Every deviation needs a remark from its owner before the monthly review. Owners see only their lines." : "Explain each flagged line on your functions — the prompt tells you what's needed."} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-ink-3">Month</span>
        {closedMonths.map((p) => (
          <Link key={p} href={`/aop/review${qs(`period=${p}${sp.mine === "1" ? "&mine=1" : ""}`)}`} scroll={false}
            className={cn("h-7 rounded-lg px-2.5 text-[12.5px] leading-7 tabular ring-1 ring-inset", p === period ? "bg-ink text-canvas ring-ink" : "text-ink-2 ring-line-strong hover:bg-subtle")}>{monShort(p)}</Link>
        ))}
        {manage && (
          <Link href={`/aop/review${qs(`period=${period}${sp.mine === "1" ? "" : "&mine=1"}`)}`} className="ml-auto text-[12.5px] text-ink-3 hover:text-ink">
            {sp.mine === "1" ? "Show all owners" : "Only my lines"}
          </Link>
        )}
      </div>
      <ReviewTable tree={tree} period={period} editable={[...editableItemIds(m, user)]} onlyMine={onlyMine} />
      {manage && <div className="mt-4"><VarianceGrid tree={tree} /></div>}
    </div>
  );
}
