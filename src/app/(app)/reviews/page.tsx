import Link from "next/link";
import { Repeat } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { MomOwnerPicker, ReviewFormButton } from "@/components/reviews/ReviewControls";
import { requireUser, canManage } from "@/server/auth";
import { listReviews } from "@/server/reviews/queries";
import { pickerOptions } from "@/server/projects/options";
import { dateOf, fmtTime, relDay } from "@/lib/dates";
import { plural } from "@/lib/format";
import { MOM_STATUS, type Tone } from "@/lib/meta";
import { cn } from "@/lib/cn";

export const metadata = { title: "Reviews" };

const MODULE_LABEL: Record<string, string> = { aop: "AOP", sop: "S&OP", program: "Program", project: "Project", general: "General" };

export default async function ReviewsPage() {
  const user = await requireUser();
  const [reviews, opts] = await Promise.all([listReviews(), pickerOptions()]);
  const manager = canManage(user);
  const active = reviews.filter((r) => r.active);
  const momPending = active.filter((r) => r.last_mom_status === "pending" || r.last_mom_status === "draft");
  const momReview = active.filter((r) => r.last_mom_status === "submitted");
  const overdue = active.reduce((a, r) => a + r.overdue_actions, 0);
  const noMomOwner = active.filter((r) => !r.mom_owner_id).length;

  const parts = [
    momPending.length ? <span key="p" className="font-medium text-warn">{plural(momPending.length, "MoM")} pending</span> : null,
    momReview.length ? <span key="r" className="font-medium text-info">{momReview.length} awaiting your review</span> : null,
    overdue ? <span key="o" className="font-medium text-bad">{plural(overdue, "overdue action")} from reviews</span> : null,
    noMomOwner ? <span key="n" className="text-warn">{noMomOwner} without a MoM owner</span> : null,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader eyebrow="Programs" title="Business reviews"
        subtitle={parts.length ? <span className="flex flex-wrap gap-x-1.5">{parts.flatMap((x, i) => (i ? [<span key={`s${i}`} className="text-ink-4">·</span>, x] : [x]))}</span> : `${plural(active.length, "recurring review")}, all MoMs and actions on track.`}
        actions={manager ? <ReviewFormButton options={opts} /> : null} />

      {!reviews.length ? (
        <Card><EmptyState icon={<Repeat size={18} />} title="No review series yet" body="Set up the recurring reviews you run — S&OP, cost, warehouse ops — and their packs compile themselves." action={manager ? <ReviewFormButton options={opts} /> : null} /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th className="w-[28%]">Review</th><th>Cadence</th><th>Owner</th><th>MoM owner</th><th>Next meeting</th><th>Last MoM</th><th className="text-right">Open</th><th className="text-right">Overdue</th></tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const ms = r.last_mom_status ? MOM_STATUS[r.last_mom_status as keyof typeof MOM_STATUS] : null;
                return (
                  <tr key={r.id} className={cn(!r.active && "opacity-55")}>
                    <td>
                      <Link href={`/reviews/${r.id}`} className="block py-1.5">
                        <span className="block font-medium text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4">{r.name}</span>
                        <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                          <Badge tone="muted">{MODULE_LABEL[r.module ?? "general"]}</Badge>
                          {r.program_name && <span className="truncate">{r.program_name}</span>}
                          {r.calendar_match && <span className="truncate text-ink-4">· matches “{r.calendar_match}”</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="capitalize text-ink-2">{r.cadence === "adhoc" ? "Ad hoc" : r.cadence}</td>
                    <td><span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar name={r.owner_name} color={r.owner_color} size={20} /><span className="text-ink-2">{r.owner_name ?? "—"}</span></span></td>
                    <td><MomOwnerPicker reviewId={r.id} value={r.mom_owner_id} name={r.mom_owner_name} color={r.mom_owner_color} people={opts.people} disabled={!manager} /></td>
                    <td className="whitespace-nowrap text-ink-2">{r.next_at ? <Link href={`/meetings/${r.next_id}`} className="hover:text-ink">{relDay(dateOf(r.next_at))} · {fmtTime(r.next_at)}</Link> : <span className="text-ink-4">Not scheduled</span>}</td>
                    <td>{ms && r.last_id ? <Link href={`/meetings/${r.last_id}`}><Badge tone={ms.tone as Tone}>{ms.label}</Badge></Link> : <span className="text-ink-4">—</span>}</td>
                    <td className="text-right tabular text-ink-2">{r.open_actions || <span className="text-ink-4">—</span>}</td>
                    <td className={cn("text-right tabular", r.overdue_actions ? "font-medium text-bad" : "text-ink-4")}>{r.overdue_actions || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {manager && <p className="mt-3 text-[12px] text-ink-3">Changing the MoM owner reassigns upcoming meetings of that review that don’t have minutes yet.</p>}
    </div>
  );
}
