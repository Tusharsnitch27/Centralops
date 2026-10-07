import Link from "next/link";
import { ArrowUpRight, FolderKanban, LayoutGrid, Rows3 } from "lucide-react";
import { ButtonLink, Card, EmptyState, HealthBadge, PageHeader } from "@/components/ui";
import { FilterBar, QuerySegment } from "@/components/projects/FilterBar";
import { ProjectFormButton } from "@/components/projects/ProjectForm";
import { ProjectCard, ProjectTable } from "@/components/projects/ProjectViews";
import { requireUser, canEdit } from "@/server/auth";
import { listProjects } from "@/server/projects/queries";
import { projectsAtRisk } from "@/server/projects/summary";
import { pickerOptions } from "@/server/projects/options";
import { PROJECT_STATUS, type ProjectStatus } from "@/server/projects/metrics";
import { HEALTH, type Health } from "@/lib/meta";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Projects" };

type SP = Promise<{ program?: string; owner?: string; health?: string; status?: string; view?: string; attention?: string }>;

export default async function ProjectsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const health = sp.health && sp.health in HEALTH ? (sp.health as Health) : undefined;
  const status = sp.status && sp.status in PROJECT_STATUS ? (sp.status as ProjectStatus) : undefined;
  const [all, atRisk, options] = await Promise.all([listProjects(), projectsAtRisk(), pickerOptions()]);

  const attentionIds = new Set(atRisk.map((p) => p.id));
  const projects = all.filter((p) =>
    (!sp.program || (sp.program === "none" ? !p.program_id : p.program_id === sp.program)) &&
    (!sp.owner || p.owner_id === sp.owner) &&
    (!health || p.health === health) &&
    (!status || p.status === status) &&
    (!sp.attention || attentionIds.has(p.id)) &&
    (status ? true : p.status !== "completed"), // completed projects only when asked for
  );

  const live = all.filter((p) => p.status === "active" || p.status === "on_hold");
  const nAtRisk = live.filter((p) => p.health !== "on_track").length;
  const nSlipped = live.reduce((a, p) => a + p.ms_slipped, 0);
  const nOverdue = live.reduce((a, p) => a + p.overdue_tasks, 0);
  const view = sp.view === "table" ? "table" : "cards";

  // group by program (projects without a program last)
  const groups = new Map<string, { id: string | null; name: string; code: string | null; color: string | null; items: typeof projects }>();
  for (const p of projects) {
    const key = p.program_id ?? "none";
    if (!groups.has(key)) groups.set(key, { id: p.program_id, name: p.program_name ?? "Standalone projects", code: p.program_code, color: p.program_color, items: [] });
    groups.get(key)!.items.push(p);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name));

  const owners = [...new Map(all.filter((p) => p.owner_id).map((p) => [p.owner_id!, p.owner_name!])).entries()].map(([value, label]) => ({ value, label }));
  const programOpts = [...options.programs, { value: "none", label: "No program" }];

  const subtitle = nAtRisk || nSlipped || nOverdue ? (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {[
        nAtRisk ? <Link key="r" href="/projects?health=at_risk" className="font-medium text-warn hover:underline">{plural(nAtRisk, "project")} at risk</Link> : null,
        nSlipped ? <Link key="s" href="/projects?attention=1" className="font-medium text-ink-2 hover:underline">{plural(nSlipped, "milestone")} slipped</Link> : null,
        nOverdue ? <Link key="o" href="/projects?attention=1" className="font-medium text-bad hover:underline">{plural(nOverdue, "overdue action")}</Link> : null,
      ].filter(Boolean).flatMap((x, i) => (i ? [<span key={`d${i}`} className="text-ink-4">·</span>, x] : [x]))}
      <span className="text-ink-4">· across {plural(live.length, "live project")}</span>
    </span>
  ) : <>All {plural(live.length, "live project")} on track.</>;

  return (
    <div>
      <PageHeader eyebrow="Work" title="Projects" subtitle={subtitle}
        actions={canEdit(user) ? <ProjectFormButton options={options} /> : null} />

      {atRisk.length > 0 && !sp.attention && !health && (
        <section className="mb-7">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Needs attention</h3>
            {atRisk.length > 3 && <Link href="/projects?attention=1" className="text-[12px] text-ink-3 hover:text-ink">View all {atRisk.length}</Link>}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {atRisk.slice(0, 3).map((p) => (
              <Card key={p.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/projects/${p.id}`} className="min-w-0 text-[13.5px] font-medium leading-snug text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4">{p.name}</Link>
                  <HealthBadge health={p.health} className="shrink-0" />
                </div>
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {p.slippedMilestones.slice(0, 2).map((m) => <li key={m.title} className="flex gap-1.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-warn" /><span>{m.title} <span className="font-medium text-warn tabular">+{m.slipDays}d</span></span></li>)}
                  {p.overdueTasks > 0 && <li className="flex gap-1.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-bad" /><span>{plural(p.overdueTasks, "overdue action")}</span></li>}
                  {p.primaryRisk && <li className="flex gap-1.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" /><span className="line-clamp-1">{p.primaryRisk}</span></li>}
                </ul>
                <div className="mt-auto flex items-center justify-between pt-1 text-[12px] text-ink-3">
                  <span>{p.owner_name ?? "No owner"} · {p.progress}%</span>
                  <ButtonLink href={`/projects/${p.id}`} size="xs" variant="ghost">Review<ArrowUpRight size={12} /></ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <FilterBar className="mb-5" filters={[
        { key: "program", label: "Program", options: programOpts, width: 200 },
        { key: "owner", label: "Owner", options: owners },
        { key: "health", label: "Health", options: Object.entries(HEALTH).map(([value, m]) => ({ value, label: m.label })), width: 150 },
        { key: "status", label: "Status", options: Object.entries(PROJECT_STATUS).map(([value, m]) => ({ value, label: m.label })), width: 150 },
      ]}>
        <QuerySegment param="view" value={view} options={[
          { value: "cards", label: <LayoutGrid size={14} />, title: "Cards" },
          { value: "table", label: <Rows3 size={14} />, title: "Table" },
        ]} />
      </FilterBar>

      {!projects.length ? (
        <Card>
          <EmptyState icon={<FolderKanban size={18} />} title={all.length ? "No projects match these filters" : "No projects yet"}
            body={all.length ? "Try clearing a filter." : "Create the first project to start tracking milestones, owners and updates."}
            action={all.length ? <ButtonLink href="/projects">Clear filters</ButtonLink> : canEdit(user) ? <ProjectFormButton options={options} /> : null} />
        </Card>
      ) : (
        <div className="space-y-8">
          {ordered.map((g) => {
            const risky = g.items.filter((p) => p.health !== "on_track" && p.status === "active").length;
            return (
              <section key={g.id ?? "none"}>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: g.color ?? "#a1a1aa" }} />
                  {g.id ? <Link href={`/programs/${g.id}`} className="text-[14px] font-semibold text-ink hover:underline hover:underline-offset-4">{g.name}</Link> : <span className="text-[14px] font-semibold text-ink">{g.name}</span>}
                  {g.code && <span className="font-mono text-[11px] text-ink-4">{g.code}</span>}
                  <span className="text-[12px] text-ink-3">{plural(g.items.length, "project")}{risky ? <> · <span className="text-warn">{risky} at risk</span></> : null}</span>
                </div>
                {view === "table" ? <ProjectTable projects={g.items} /> : (
                  <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3")}>
                    {g.items.map((p) => <ProjectCard key={p.id} p={p} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
