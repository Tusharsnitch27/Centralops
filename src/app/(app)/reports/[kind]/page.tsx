import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileSearch } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { REPORTS, buildReport, meetingOptions, polishReport, projectOptions } from "@/server/reports/builders";
import { toText, toWhatsApp } from "@/server/reports/doc";
import { scopeFor } from "@/server/insights/signals";
import { aiConfigured } from "@/server/ai/provider";
import { ReportView, PRINT_CSS } from "@/components/reports/ReportView";
import { ReportActions, ReportPicker } from "@/components/reports/ReportActions";

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: REPORTS.find((r) => r.kind === kind)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ project?: string; meeting?: string; polish?: string }> }) {
  const user = await requireUser();
  const { kind } = await params;
  const sp = await searchParams;
  const meta = REPORTS.find((r) => r.kind === kind);
  if (!meta) notFound();
  const project = sp.project && UUID.test(sp.project) ? sp.project : undefined;
  const meeting = sp.meeting && UUID.test(sp.meeting) ? sp.meeting : undefined;
  const scope = await scopeFor(user.id);
  const [doc, options] = await Promise.all([
    buildReport(kind, user.id, { project, meeting }),
    kind === "project" ? projectOptions() : kind === "mom" ? meetingOptions(scope) : Promise.resolve(null),
  ]);
  const ai = doc && sp.polish === "1" ? await polishReport(doc) : null;
  const pickerParam = kind === "project" ? "project" : "meeting";

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/reports" className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={13} />Reports</Link>
          <span className="text-ink-4">/</span>
          <span className="truncate text-[13px] font-medium text-ink">{meta.title}</span>
        </div>
        {doc && <ReportActions text={toText(doc)} whatsapp={toWhatsApp(doc)} canPolish={aiConfigured()} polished={!!ai} />}
      </div>
      {options && (
        <div className="no-print mb-5 flex items-center gap-3">
          <ReportPicker options={options.map((o) => ({ value: o.value, label: o.label, ...(o.hint ? { hint: o.hint } : {}) }))} value={project ?? meeting ?? null} param={pickerParam} placeholder={kind === "project" ? "Choose a project…" : "Choose a meeting…"} />
          {sp.polish === "1" && doc && !ai && <span className="text-[12px] text-ink-4">AI summary unavailable — showing the rule-based report.</span>}
        </div>
      )}
      {!options && sp.polish === "1" && doc && !ai && <p className="no-print mb-3 text-[12px] text-ink-4">AI summary unavailable — showing the rule-based report.</p>}
      {doc ? <ReportView doc={doc} aiSummary={ai} /> : (
        <Card className="mx-auto max-w-[860px]">
          <EmptyState icon={<FileSearch size={18} />} title={kind === "project" ? "Pick a project" : "Pick a meeting"}
            body={kind === "project" ? "Choose a project above to compose its status report." : "Choose a past meeting above to format its minutes, decisions and actions."} />
        </Card>
      )}
    </div>
  );
}
