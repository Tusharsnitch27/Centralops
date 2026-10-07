import Link from "next/link";
import { Gavel } from "lucide-react";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/projects/FilterBar";
import { DecisionList } from "@/components/decisions/DecisionList";
import { DecisionFormButton } from "@/components/decisions/DecisionForm";
import { toDecisionView } from "@/components/decisions/view";
import { requireUser, canEdit } from "@/server/auth";
import { decisionFilterOptions, listDecisions } from "@/server/decisions/queries";
import { decisionFormOptions } from "@/server/decisions/options";
import { DECISION_STATUS } from "@/server/decisions/meta";
import { dateOf, fmtDate, today } from "@/lib/dates";
import { plural } from "@/lib/format";

export const metadata = { title: "Decisions" };

type SP = Promise<{ project?: string; meeting?: string; maker?: string; status?: string; q?: string; focus?: string }>;

export default async function DecisionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const status = sp.status && (sp.status in DECISION_STATUS || sp.status === "pending") ? sp.status : undefined;
  const [rows, filterOpts, opts] = await Promise.all([
    listDecisions({ projectId: sp.project, meetingId: sp.meeting, makerId: sp.maker, status, search: sp.q?.trim() || undefined }),
    decisionFilterOptions(),
    decisionFormOptions(),
  ]);
  // a focused decision outside the current filters is still shown
  let all = rows;
  if (sp.focus && /^[0-9a-f-]{36}$/i.test(sp.focus) && !rows.some((d) => d.id === sp.focus)) all = [...(await listDecisions({ ids: [sp.focus] })), ...rows];
  const views = all.map(toDecisionView);
  const pending = views.filter((d) => d.status === "pending" || d.status === "proposed");
  const made = views.filter((d) => !(d.status === "pending" || d.status === "proposed"));
  const td = today();
  const overdue = pending.filter((d) => d.due_date && d.due_date < td).length;
  const dueWeek = pending.filter((d) => d.due_date && d.due_date >= td && d.due_date <= new Date(Date.parse(`${td}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10)).length;
  const editable = canEdit(user);
  const filtered = Boolean(sp.project || sp.meeting || sp.maker || status || sp.q);

  // group made decisions by month for scanability
  const byMonth = new Map<string, typeof made>();
  for (const d of made) {
    const key = (d.decided_on ?? "").slice(0, 7) || "undated";
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(d);
  }

  return (
    <div>
      <PageHeader eyebrow="Institutional memory" title="Decisions"
        subtitle={pending.length ? (
          <span>
            <Link href="/decisions?status=pending" className="font-medium text-warn hover:underline">{plural(pending.length, "decision")} required</Link>
            {overdue ? <> · <span className="font-medium text-bad">{overdue} overdue</span></> : dueWeek ? <> · {dueWeek} due this week</> : null}
            <span className="text-ink-4"> · {plural(made.length, "decision")} logged</span>
          </span>
        ) : <>{plural(made.length, "decision")} logged. Nothing waiting on a decision.</>}
        actions={editable ? <DecisionFormButton options={opts} /> : null} />

      <FilterBar className="mb-5" search={{ placeholder: "Search decisions, context, impact…" }} filters={[
        { key: "status", label: "Status", options: [{ value: "pending", label: "Decision required" }, { value: "made", label: "Decided" }, { value: "revisited", label: "Revisited" }, { value: "superseded", label: "Superseded" }], width: 170 },
        { key: "project", label: "Project", options: opts.projects, width: 190 },
        { key: "meeting", label: "Meeting", options: filterOpts.meetings.map((m) => ({ value: m.id, label: m.title, hint: fmtDate(dateOf(m.starts_at)) })), width: 190 },
        { key: "maker", label: "Decided by", options: filterOpts.makers.map((m) => ({ value: m.id, label: m.name })), width: 170 },
      ]} />

      {!views.length ? (
        <Card>
          <EmptyState icon={<Gavel size={18} />} title={filtered ? "No decisions match" : "No decisions logged yet"}
            body={filtered ? "Try a broader search or clear the filters." : "Log decisions from meetings and projects so the why is never lost."}
            action={filtered ? <ButtonLink href="/decisions">Clear filters</ButtonLink> : editable ? <DecisionFormButton options={opts} /> : null} />
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <Card className="border-warn/25">
              <CardHeader title="Decisions required" subtitle="Ordered by decide-by date" />
              <DecisionList decisions={pending} options={opts} focusId={sp.focus} editable={editable} />
            </Card>
          )}
          {[...byMonth.entries()].map(([month, list]) => (
            <Card key={month}>
              <CardHeader title={month === "undated" ? "Undated" : new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} subtitle={plural(list.length, "decision")} />
              <DecisionList decisions={list} options={opts} focusId={sp.focus} editable={editable} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
