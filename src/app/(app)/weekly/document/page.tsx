import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { EntryBody, RichText } from "@/components/weekly/EntryBody";
import { DocToolbar, ExecSummaryEditor, SectionFeedback } from "@/components/weekly/DocumentControls";
import { STATUS_LABEL, STATUS_TONE } from "@/components/weekly/meta";
import { canManage, canOverview, requireUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { currentWeekOf, ensureReport, loadReport } from "@/server/weekly/model";
import { emailConfig } from "@/server/weekly/delivery";

export const metadata = { title: "Weekly update · Document" };

export default async function WeeklyDocument({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const u = await requireUser();
  if (!canOverview(u)) redirect("/weekly");
  const sp = await searchParams;
  const cur = currentWeekOf();
  const weekOf = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : cur;
  if (weekOf >= cur) await ensureReport(weekOf);
  const v = await loadReport(weekOf, u);
  if (!v) return <EmptyState title="No update for that week" />;
  const manage = canManage(u);
  const { report } = v;
  const editable = manage && report.status !== "sent";
  const mail = manage ? await emailConfig() : null;
  const groups = [...new Set(v.rows.map((r) => r.section.group_name))];
  return (
    <div className="mx-auto max-w-[900px]">
      <Link href={`/weekly?week=${weekOf}`} className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink print:hidden"><ArrowLeft size={13} />Weekly updates</Link>
      {manage && <DocToolbar reportId={report.id} status={report.status} emailReady={!!(mail?.webhookUrl && mail.recipients)} />}

      <article className="card p-5 md:p-9 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 border-b border-line pb-4">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[report.status]} dot>{STATUS_LABEL[report.status]}</Badge>
            {report.approved_by_name && <span className="text-[11.5px] text-ink-4">Approved by {report.approved_by_name}</span>}
            <span className="text-[11.5px] text-ink-4">{v.counts.submitted}/{v.counts.total} sections submitted</span></div>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">{report.title}</h1>
        </header>

        <section className="mb-8">
          <h2 className="mb-3 border-b-2 border-ink pb-1 text-[16px] font-semibold">Executive Summary</h2>
          {editable && <ExecSummaryEditor reportId={report.id} initial={report.exec_summary} engine={report.exec_engine} />}
          <div className={editable ? "hidden print:block" : ""}>
            {report.exec_summary ? <RichText text={report.exec_summary} className="space-y-2.5" /> : <p className="text-[12.5px] text-ink-4">Not written yet.</p>}
          </div>
        </section>

        {groups.map((g) => (
          <section key={g} className="mb-8">
            <h2 className="mb-4 border-b-2 border-ink pb-1 text-[16px] font-semibold">{g}</h2>
            <div className="space-y-7">
              {v.rows.filter((r) => r.section.group_name === g).map((r) => (
                <div key={r.entry.id} className="break-inside-avoid-page">
                  <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[14.5px] font-semibold">
                    {r.section.name}<span className="text-[12.5px] font-normal text-ink-3">{r.section.owners.join(", ")}</span>
                    {r.entry.status !== "submitted" && <span className="text-[11.5px] font-medium text-warn print:hidden">{r.entry.status === "draft" ? "Draft" : "Not submitted"}</span>}
                  </h3>
                  <EntryBody e={r.entry} />
                  {editable && <SectionFeedback entryId={r.entry.id} initial={r.entry.pm_comment} />}
                </div>
              ))}
            </div>
          </section>
        ))}
      </article>
    </div>
  );
}
