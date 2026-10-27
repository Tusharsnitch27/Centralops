import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CircleDashed, FileText, PenLine } from "lucide-react";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { Collapsible, ExpandAll } from "@/components/ui/Collapsible";
import { EntryBody } from "@/components/weekly/EntryBody";
import { SectionEditor } from "@/components/weekly/SectionEditor";
import { RemindButton } from "@/components/weekly/WeeklyActions";
import { WeeklyTabs } from "@/components/weekly/WeeklyTabs";
import { Suspense } from "react";
import { STATUS_LABEL, STATUS_TONE } from "@/components/weekly/meta";
import { FollowThroughPanel, ResetWeek, SectionPrompts } from "@/components/weekly/FollowThrough";
import { storedFollowThrough, type FollowSection } from "@/server/weekly/followthrough";
import { canManage, canOverview, requireUser } from "@/server/auth";
import { currentWeekOf, ensureReport, listReports, loadReport, type ReportView } from "@/server/weekly/model";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Weekly updates" };

const ENTRY = { pending: { label: "Pending", tone: "red" as const }, draft: { label: "Draft", tone: "amber" as const }, submitted: { label: "Submitted", tone: "green" as const } };

/** "E Sagar Kumar Patra" → "Sagar", "Mohd Faisal Jamal Kidwai" → "Faisal". */
const shortName = (n: string) => n.split(/\s+/).find((t) => t.replace(/\./g, "").length > 1 && !/^(mohd|md|mohammad|mr|ms)$/i.test(t)) ?? n;

function countdown(deadline: string) {
  const ms = Date.parse(deadline) - Date.now();
  const h = Math.floor(Math.abs(ms) / 3_600_000), d = Math.floor(h / 24);
  const span = d ? `${d}d ${h % 24}h` : `${h}h ${Math.floor((Math.abs(ms) % 3_600_000) / 60_000)}m`;
  return ms >= 0 ? { text: `due in ${span}`, late: false } : { text: `${span} past deadline`, late: true };
}

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const cur = currentWeekOf();
  const weekOf = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : cur;
  if (weekOf >= cur) await ensureReport(weekOf);
  const [v, reports] = await Promise.all([loadReport(weekOf, u), listReports()]);
  const manage = canManage(u);
  const overview = canOverview(u);
  // without the full overview people see only the sections they own
  if (v && !overview) { v.rows = v.rows.filter((r) => r.section.owner_ids.includes(u.id)); const c = (s: string) => v.rows.filter((r) => r.entry.status === s).length; v.counts = { total: v.rows.length, submitted: c("submitted"), draft: c("draft"), pending: c("pending") }; }
  if (!v) return <><PageHeader title="Weekly updates" /><EmptyState title="No update for that week" action={<ButtonLink href="/weekly">Go to this week</ButtonLink>} /></>;

  const { report, counts } = v;
  const sent = report.status === "sent";
  const dl = countdown(v.deadline);
  const groups = [...new Set(v.rows.map((r) => r.section.group_name))];
  const mine = v.rows.filter((r) => r.mine && !manage && overview);
  const notDone = v.rows.filter((r) => r.entry.status !== "submitted");
  const weeks = [...new Set([cur, ...reports.map((r) => r.week_of)])].sort().reverse().slice(0, 8);
  const pct = (n: number) => `${(n / Math.max(1, counts.total)) * 100}%`;
  // follow-through vs last week: admins and program managers only
  const ft = manage ? await storedFollowThrough(weekOf) : null;
  const prompts = new Map<string, FollowSection>((ft?.data?.sections ?? []).map((s) => [s.section_id, s]));

  return (
    <div>
      <PageHeader title="Weekly updates"
        subtitle="Every Monday by 12 PM · compiled and sent to leadership"
        actions={overview ? <ButtonLink href={`/weekly/document?week=${weekOf}`} variant="primary"><FileText size={14} />{manage ? "Compile & review" : "View document"}</ButtonLink> : undefined} />

      {overview && <Suspense><WeeklyTabs /></Suspense>}
      <div className="seg mb-4">
        <span className="seg-label">Week of</span>
        {weeks.map((w) => <Link key={w} href={`/weekly?week=${w}`} data-on={w === weekOf} className="seg-item">{fmtDate(w)}{w === cur ? " · next" : ""}</Link>)}
      </div>

      {/* quick summary of what's pending */}
      <div className="card mb-5 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold">{report.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
              <Badge tone={STATUS_TONE[report.status]} dot>{STATUS_LABEL[report.status]}</Badge>
              {!sent && <span className={cn("flex items-center gap-1", dl.late && notDone.length ? "font-medium text-bad" : "")}><CalendarClock size={13} />Mon {fmtDate(weekOf)}, 12:00 PM · {dl.text}</span>}
              {sent && report.sent_at && <span>Sent {fmtDate(report.sent_at.slice(0, 10), { dow: true })} to {report.sent_to}</span>}
            </div>
          </div>
          {manage && !sent && <RemindButton reportId={report.id} count={notDone.length} />}
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[12px] text-ink-3">
            <span><b className="font-semibold text-ink">{counts.submitted}</b> of {counts.total} submitted{counts.draft ? ` · ${counts.draft} in draft` : ""}</span>
            <span>{Math.round((counts.submitted / Math.max(1, counts.total)) * 100)}%</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="bg-ok" style={{ width: pct(counts.submitted) }} />
            <span className="bg-warn/70" style={{ width: pct(counts.draft) }} />
          </div>
        </div>
        {notDone.length > 0 && !sent && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-4">Still pending</div>
            <div className="flex flex-wrap gap-1.5">
              {notDone.map((r) => (
                <a key={r.entry.id} href={`#${r.entry.id}`} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[12px] hover:border-line-strong">
                  {r.entry.status === "draft" ? <PenLine size={11} className="text-warn" /> : <CircleDashed size={11} className="text-bad" />}
                  <span className="font-medium text-ink">{r.section.name}</span>
                  <span className="text-ink-4">{r.section.owners.map(shortName).join(", ")}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {manage && <FollowThroughPanel weekOf={weekOf} data={ft?.data ?? null} engine={ft?.engine ?? null} at={ft?.at ?? null} stale={!!ft?.stale} auto={counts.submitted > 0} />}

      {mine.length > 0 && !sent && (
        <section className="mb-6 space-y-2">
          <h2 className="label-caps px-1">Your sections</h2>
          {mine.map((r) => <Row key={r.entry.id} r={r} sent={sent} idPrefix="weekly:mine:" />)}
        </section>
      )}

      <div className="mb-2 flex justify-end"><ExpandAll ids={v.rows.map((r) => `weekly:${r.entry.id}`)} /></div>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g} className="space-y-2">
            <h2 className="label-caps px-1">{g}</h2>
            {v.rows.filter((r) => r.section.group_name === g).map((r) => <Row key={r.entry.id} r={r} sent={sent} anchor prompts={prompts.get(r.section.id)} />)}
          </section>
        ))}
      </div>
      <Link href={`/weekly/document?week=${weekOf}`} className="mt-6 flex items-center gap-1 px-1 text-[12.5px] text-ink-3 hover:text-ink">Open the compiled document <ArrowRight size={12} /></Link>
      {u.role === "admin" && <ResetWeek reportId={report.id} weekOf={weekOf} title={report.title} />}
    </div>
  );
}

function Row({ r, sent, idPrefix = "weekly:", anchor, prompts }: { r: ReportView["rows"][number]; sent: boolean; idPrefix?: string; anchor?: boolean; prompts?: FollowSection }) {
  const st = ENTRY[r.entry.status];
  const editable = r.mine && !sent;
  return (
    <div id={anchor ? r.entry.id : undefined} className="scroll-mt-20">
      {anchor && <span id={`sec-${r.section.id}`} className="block scroll-mt-20" />}
      <Collapsible id={`${idPrefix}${r.entry.id}`} title={r.section.name}
        sub={`${r.section.owners.join(", ") || "No owner"}${r.entry.submitted_at ? ` · submitted ${fmtDate(r.entry.submitted_at.slice(0, 10))}` : ""}`}
        summary={<>
          {r.entry.images.length > 0 && <span className="text-ink-4">{r.entry.images.length} img</span>}
          {prompts && <Badge tone="info">{prompts.items.length} to ask</Badge>}
          {r.entry.pm_comment && r.entry.status !== "submitted" && <Badge tone="amber">Feedback</Badge>}
          <Badge tone={st.tone} dot>{st.label}</Badge>
          {editable && <span className="hidden text-[11.5px] text-accent-ink sm:inline">{r.entry.status === "submitted" ? "Edit" : "Fill in"}</span>}
        </>}>
        {prompts && <SectionPrompts s={prompts} />}
        {editable
          ? <SectionEditor e={r.entry} lastAhead={r.lastAhead} />
          : (
            <div className="p-4 md:p-5">
              <EntryBody e={r.entry} />
              {r.entry.status === "submitted" && <div className="mt-3 flex items-center gap-1 text-[11.5px] text-ok"><CheckCircle2 size={12} />Submitted by {r.entry.submitted_by_name ?? "owner"}</div>}
            </div>
          )}
      </Collapsible>
    </div>
  );
}
