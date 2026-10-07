import { PageHeader } from "@/components/ui";
import { SopNav } from "@/components/sop/actions";
import { addMonths, fyLabel, today } from "@/lib/dates";
import { currentPeriod, isOpenSub } from "@/server/sop/model";
import { getCapacityBreaches, getSubmissionGrid } from "@/server/sop/queries";

export default async function SopLayout({ children }: { children: React.ReactNode }) {
  const cur = currentPeriod(today());
  const [grid, breaches] = await Promise.all([getSubmissionGrid([cur, addMonths(cur, 1), addMonths(cur, 2)]), getCapacityBreaches(cur, addMonths(cur, 2))]);
  const open = grid.cells.filter((c) => c.period === addMonths(cur, 1) && isOpenSub(c.state)).length + grid.cells.filter((c) => c.period === cur && c.state === "late").length;
  return (
    <div>
      <PageHeader eyebrow={`Programs · ${fyLabel()}`} title="S&OP" subtitle="Projections from every channel, actuals against them, and the warehouse capacity they need." className="mb-4" />
      <SopNav counts={{ inputs: open, capacity: breaches.length }} />
      {children}
    </div>
  );
}
