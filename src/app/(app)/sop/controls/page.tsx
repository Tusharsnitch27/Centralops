import { requireSopOverview } from "@/server/sop/access";
import { canManage, requireUser } from "@/server/auth";
import { q } from "@/server/db";
import { WhCapacityGrid, type CapSetting } from "@/components/sop/WhCapacityGrid";

export const metadata = { title: "S&OP · Controls" };

/** FY months, April → March. */
const fyMonths = (start: number) => Array.from({ length: 12 }, (_, i) => { const m = ((3 + i) % 12) + 1; return `${m >= 4 ? start : start + 1}-${String(m).padStart(2, "0")}-01`; });

/** S&OP controls: the numbers the review is measured against that aren't projections — warehouse capacity by month. */
export default async function SopControls() {
  await requireSopOverview();
  const u = await requireUser();
  const settings = await q<CapSetting>(
    `select s.warehouse, s.effective_from::text as from, s.capacity::float8 as capacity, s.special_capacity::float8 as special, u.name as by, s.updated_at::text as at
     from sop_wh_capacity_settings s left join users u on u.id = s.updated_by order by s.warehouse desc, s.effective_from`);
  return (
    <div className="space-y-2">
      <h2 className="label-caps px-1">Warehouse capacity · by month</h2>
      <WhCapacityGrid months={fyMonths(2026)} settings={settings} canEdit={canManage(u)} />
    </div>
  );
}
