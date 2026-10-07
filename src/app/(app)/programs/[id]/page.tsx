import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ChevronLeft, Flag, ListChecks, Repeat, ShieldAlert } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, HealthBadge, PageHeader, Progress, Stat } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { ProjectTable } from "@/components/projects/ProjectViews";
import { ProjectFormButton } from "@/components/projects/ProjectForm";
import { RiskTable } from "@/components/risks/RiskTable";
import { toRiskView } from "@/components/risks/view";
import { moduleLink } from "@/components/programs/links";
import { requireUser, canEdit } from "@/server/auth";
import { listPrograms, programReviews } from "@/server/programs/queries";
import { pctInt } from "@/server/projects/metrics";
import { pickerOptions } from "@/server/projects/options";
import { listTasks } from "@/server/tasks/queries";
import { listRisks } from "@/server/risks/queries";
import { listDecisions } from "@/server/decisions/queries";
import { dateOf, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Program" };

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [g] = await listPrograms([id]);
  if (!g) notFound();
  const [overdue, risks, reviews, decisions, opts] = await Promise.all([
    listTasks({ programId: id, overdue: true }), listRisks({ programId: id }), programReviews(id), listDecisions({ programId: id, status: "pending" }), pickerOptions(),
  ]);
  const td = today();
  const mod = moduleLink(g.code);
  const live = g.projects.filter((p) => p.status !== "completed");
  const upcoming = [...g.upcoming].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  return (
    <div>
      <Link href="/programs" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ChevronLeft size={14} />Program Tracker</Link>
      <PageHeader eyebrow={<span className="flex items-center gap-2"><span className="size-2 rounded-[2px]" style={{ background: g.color ?? "#a1a1aa" }} /><span className="font-mono">{g.code}</span></span>}
        title={g.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><HealthBadge health={g.derived_health} /><span>Owner {g.owner_name ?? "—"}</span>{g.target_date && <><span className="text-ink-4">·</span><span>Target {fmtDate(g.target_date, { year: true })}</span></>}</span>}
        actions={<>
          {mod && <ButtonLink href={mod.href} variant="secondary">{mod.label}<ArrowUpRight size={13} /></ButtonLink>}
          {canEdit(user) && <ProjectFormButton options={opts} defaultProgramId={id} label="Add project" variant="primary" />}
        </>} />
      {g.description && <p className="-mt-2 mb-6 max-w-3xl text-[13.5px] leading-relaxed text-ink-2">{g.description}</p>}

      <Card className="mb-6 grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-1">
          <div className="eyebrow mb-1">Progress</div>
          <div className="font-serif text-[28px] leading-none tabular">{pctInt(g.progress)}%</div>
          <Progress value={g.progress} className="mt-2" tone={g.derived_health === "on_track" ? "neutral" : g.derived_health === "at_risk" ? "amber" : "red"} />
        </div>
        <Stat label="Projects" value={live.length} delta={g.at_risk ? `${g.at_risk} at risk` : undefined} tone="amber" hint={g.at_risk ? undefined : "on track"} />
        <Stat label="Overdue actions" value={g.overdue_tasks} tone="red" delta={g.overdue_tasks ? "chase" : undefined} hint={`${g.open_tasks} open`} />
        <Stat label="Slipped milestones" value={g.slipped} tone="amber" hint={`${upcoming.length} due in 30d`} />
        <Stat label="Open risks" value={g.open_risks} tone="red" delta={g.critical_risks ? `${g.critical_risks} critical` : undefined} />
        <Stat label="Decisions pending" value={g.pending_decisions} tone="amber" delta={g.pending_decisions ? "decide" : undefined} />
      </Card>

      <section className="mb-6">
        <div className="mb-2.5 flex items-center justify-between"><h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Project health</h3></div>
        {g.projects.length ? <ProjectTable projects={g.projects} /> : <Card><EmptyState compact title="No projects in this program" body="Add the first project to start tracking." /></Card>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card id="overdue">
          <CardHeader title={overdue.length ? `${plural(overdue.length, "overdue action")}` : "Overdue actions"} icon={<ListChecks size={15} />} subtitle={overdue.length ? "Across all projects in the program" : undefined} />
          <TaskList tasks={overdue.slice(0, 12)} empty={<p className="px-4 py-6 text-[13px] text-ink-3">Nothing overdue across the program.</p>} />
        </Card>
        <Card>
          <CardHeader title="Upcoming milestones" subtitle="Next 30 days, across projects" icon={<Flag size={15} />} />
          {upcoming.length ? (
            <ul className="divide-y divide-line/70">
              {upcoming.slice(0, 10).map((m) => (
                <li key={m.id}>
                  <Link href={`/projects/${m.project_id}?tab=milestones`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                    <Flag size={13} className={cn("shrink-0", m.overdue ? "text-bad" : m.slip ? "text-warn" : "text-ink-4")} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.title}</span>
                    <span className="shrink-0 rounded-md px-1.5 text-[11.5px] text-ink-3 ring-1 ring-inset ring-line">{m.project_code ?? m.project_name}</span>
                    {m.slip > 0 && <Badge tone="amber">+{m.slip}d</Badge>}
                    <span className={cn("w-[84px] shrink-0 text-right text-[12px] tabular", m.overdue ? "font-medium text-bad" : "text-ink-3")}>{m.overdue ? `${m.overdue}d overdue` : relDay(m.due_date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-[13px] text-ink-3">No milestones due in the next 30 days.</p>}
        </Card>
        <Card id="risks" className="lg:col-span-2">
          <CardHeader title="Top risks" icon={<ShieldAlert size={15} />} action={<ButtonLink href="/risks" size="xs" variant="ghost">Risk register</ButtonLink>} />
          {risks.length ? <RiskTable risks={risks.slice(0, 6).map(toRiskView)} options={opts} editable={canEdit(user)} />
            : <p className="px-4 py-6 text-[13px] text-ink-3">No open risks for this program.</p>}
        </Card>
        {decisions.length > 0 && (
          <Card>
            <CardHeader title={`${plural(decisions.length, "decision")} required`} />
            <ul className="divide-y divide-line/70">
              {decisions.map((d) => (
                <li key={d.id}><Link href={`/decisions?focus=${d.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-subtle/60">
                  <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                  {d.maker_name && <Avatar name={d.maker_name} color={d.maker_color} size={18} />}
                  <span className={cn("shrink-0 text-[12px] tabular", d.due_date && d.due_date < td ? "text-bad" : "text-ink-3")}>{d.due_date ? relDay(d.due_date) : "—"}</span>
                </Link></li>
              ))}
            </ul>
          </Card>
        )}
        <Card className={decisions.length ? "" : "lg:col-span-2"}>
          <CardHeader title="Linked reviews" icon={<Repeat size={15} />} action={<ButtonLink href="/reviews" size="xs" variant="ghost">All reviews</ButtonLink>} />
          {reviews.length ? (
            <ul className="divide-y divide-line/70">
              {reviews.map((r) => (
                <li key={r.id}><Link href={`/reviews/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{r.name}</span><span className="text-[12px] capitalize text-ink-3">{r.cadence} · {r.owner_name ?? "No owner"}</span></span>
                  <span className="shrink-0 text-[12px] text-ink-3">{r.next_at ? `Next ${relDay(dateOf(r.next_at))}, ${fmtTime(r.next_at)}` : "No upcoming meeting"}</span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-[13px] text-ink-3">No review series linked to this program.</p>}
        </Card>
      </div>
    </div>
  );
}
