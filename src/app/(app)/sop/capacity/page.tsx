import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { CapacityTable, type CapLine } from "@/components/sop/CapacityTable";
import { CreateActionButton } from "@/components/sop/actions";
import { requireUser, canEdit } from "@/server/auth";
import { listPeople } from "@/server/core/people";
import { getCapacity, getCapacityBreaches, getCapacityOwnerId, getCapacityPeriods, getRules, sortDepts, WH_LABEL } from "@/server/sop/queries";
import { currentPeriod } from "@/server/sop/model";
import { addMonths, fmtMonth, today } from "@/lib/dates";
import { num, plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP capacity" };

const WHS = ["South", "North"] as const;

export default async function SopCapacity({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const cur = currentPeriod(today());
  const outlook = [cur, addMonths(cur, 1), addMonths(cur, 2)];
  const stored = await getCapacityPeriods();
  const months = [...new Set([...stored, ...outlook])].sort();
  const month = sp.month && /^\d{4}-\d{2}-01$/.test(sp.month) ? sp.month : cur;
  const [rows, outlookRows, breaches, rules, people, ownerId] = await Promise.all([
    getCapacity(month, month), getCapacity(cur, addMonths(cur, 2)), getCapacityBreaches(month, month), getRules(), listPeople(), getCapacityOwnerId(),
  ]);
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name, hint: p.team_name }));

  // departments: this month's, else carry the list from the nearest month so the grid is ready to fill
  let depts = sortDepts(rows.map((r) => r.department));
  if (!depts.length) {
    const near = await getCapacity(addMonths(month, -12), addMonths(month, 12));
    depts = sortDepts(near.map((r) => r.department));
  }
  const empty = { required: null, available: null, remarks: null };
  const lines: CapLine[] = depts.map((d) => {
    const pick = (wh: (typeof WHS)[number]) => { const r = rows.find((x) => x.department === d && x.warehouse === wh); return r ? { required: r.required, available: r.available, remarks: r.remarks } : empty; };
    return { department: d, South: pick("South"), North: pick("North") };
  });
  const isDemo = rows.some((r) => r.remarks?.startsWith("Demo"));
  const shortBy = new Map<string, number>();
  for (const b of breaches) shortBy.set(b.warehouse, (shortBy.get(b.warehouse) ?? 0) + b.gap);

  return (
    <div className="space-y-5">
      {/* month selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {months.map((p) => (
          <Link key={p} href={`/sop/capacity?month=${p}`} className={cn("flex h-8 items-center rounded-lg border px-2.5 text-[12.5px] transition",
            p === month ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink")}>
            {fmtMonth(p)}{p === cur && <span className={cn("ml-1.5 text-[10.5px]", p === month ? "text-white/70" : "text-info")}>now</span>}
          </Link>
        ))}
      </div>

      {/* derived sentences */}
      <Card className="px-5 py-4">
        <div className="flex items-start gap-3">
          {breaches.length ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">
              {breaches.length ? `${plural(breaches.length, "capacity breach", "capacity breaches")} in ${fmtMonth(month)}` : rows.length ? `Capacity covers ${fmtMonth(month)} requirements` : `No capacity plan for ${fmtMonth(month)} yet`}
              {[...shortBy].map(([wh, g]) => <span key={wh} className="ml-2 text-[12.5px] font-normal text-ink-3">· {WH_LABEL[wh]} {num(g)}/day short</span>)}
            </div>
            <ul className="mt-2 space-y-1.5">
              {breaches.slice(0, 6).map((b) => (
                <li key={`${b.department}${b.warehouse}`} className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                  <span>{b.warehouse} {b.department.toLowerCase().includes("inward") ? "inward" : b.department} needs <span className="tabular font-medium text-ink">{num(b.required)}/day</span> vs {num(b.available)} available in {fmtMonth(b.period, false)} — <span className="font-medium text-bad">{num(b.gap)} short</span></span>
                  <CreateActionButton people={peopleOpts} variant="ghost" label="Create action"
                    defaults={{ title: `Close ${b.warehouse} ${b.department} capacity gap · ${fmtMonth(b.period)}`, description: `${WH_LABEL[b.warehouse]} ${b.department} needs ${num(b.required)}/day vs ${num(b.available)} available — ${num(b.gap)} short.\nOptions: temp manpower, OT / second shift, shift volume to the other warehouse.`, ownerId }} />
                </li>
              ))}
              {breaches.length > 6 && <li className="text-[12.5px] text-ink-3">+ {breaches.length - 6} more in the table below</li>}
              {!rows.length && <li className="text-[13px] text-ink-3">Fill required vs available per department below — the warehouse team owns these numbers.</li>}
            </ul>
          </div>
        </div>
      </Card>

      {/* grid */}
      <Card>
        <CardHeader title={`Day-level capacity · ${fmtMonth(month)}`} subtitle={`Required vs available per department and warehouse${isDemo ? " · demo values — replace with WH input" : ""}`} />
        {lines.length ? (
          <CapacityTable key={month} period={month} periodLabel={fmtMonth(month)} lines={lines} people={peopleOpts} canEdit={canEdit(u)} defaultOwnerId={ownerId} threshold={rules.capacityThreshold} />
        ) : <EmptyState compact title="No departments yet" body="Add the first department to start the capacity plan." />}
      </Card>

      {/* outlook */}
      <Card>
        <CardHeader title="Outlook" subtitle="Available − required per day, next three months · red = breach" />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Department</th>
                {outlook.map((p) => <th key={p} colSpan={2} className="border-l border-line text-center">{fmtMonth(p)}</th>)}
              </tr>
              <tr className="[&>th]:h-7">
                <th />
                {outlook.flatMap((p) => WHS.map((wh) => <th key={p + wh} className={cn("text-right", wh === "South" && "border-l border-line")}>{wh}</th>))}
              </tr>
            </thead>
            <tbody>
              {sortDepts(outlookRows.map((r) => r.department)).map((d) => (
                <tr key={d}>
                  <td className="text-ink">{d}</td>
                  {outlook.flatMap((p) => WHS.map((wh) => {
                    const r = outlookRows.find((x) => x.period === p && x.department === d && x.warehouse === wh);
                    const g = r?.required != null && r.available != null ? r.available - r.required : null;
                    return (
                      <td key={p + wh} className={cn("text-right tabular", wh === "South" && "border-l border-line")}>
                        <Link href={`/sop/capacity?month=${p}`} className={cn(g == null ? "text-ink-4" : g < 0 ? "font-medium text-bad" : "text-ink-3")}>{g == null ? "—" : num(g, { sign: true })}</Link>
                      </td>
                    );
                  }))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
