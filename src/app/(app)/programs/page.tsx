import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
import { AvatarStack, Avatar, ButtonLink, Card, EmptyState, HealthBadge, PageHeader, Progress } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { moduleLink } from "@/components/programs/links";
import { listPrograms } from "@/server/programs/queries";
import { pctInt } from "@/server/projects/metrics";
import { relDay } from "@/lib/dates";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Program Tracker" };

export default async function ProgramsPage() {
  await requireUser();
  const programs = await listPrograms();
  const atRisk = programs.filter((g) => g.derived_health !== "on_track");
  const overdue = programs.reduce((a, g) => a + g.overdue_tasks, 0);
  const slipped = programs.reduce((a, g) => a + g.slipped, 0);
  return (
    <div>
      <PageHeader eyebrow="Programs" title="Program Tracker"
        subtitle={atRisk.length || overdue || slipped
          ? <span>{atRisk.length ? <span className="font-medium text-warn">{plural(atRisk.length, "program")} need attention</span> : "All programs on track"}{slipped ? <> · {plural(slipped, "milestone")} slipped</> : null}{overdue ? <> · <span className="text-bad">{plural(overdue, "overdue action")}</span></> : null}</span>
          : `${plural(programs.length, "program")}, all on track.`} />
      {!programs.length ? (
        <Card><EmptyState icon={<Layers size={18} />} title="No programs yet" body="Programs group projects under one outcome and owner." /></Card>
      ) : (
        <div className="space-y-4">
          {programs.map((g) => {
            const mod = moduleLink(g.code);
            const owners = [...new Map(g.projects.filter((p) => p.owner_name).map((p) => [p.owner_name!, { name: p.owner_name!, color: p.owner_color }])).values()];
            const next = [...g.upcoming].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
            return (
              <Card key={g.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="size-2.5 rounded-[3px]" style={{ background: g.color ?? "#a1a1aa" }} />
                      <span className="font-mono text-[11px] text-ink-4">{g.code}</span>
                      <HealthBadge health={g.derived_health} />
                    </div>
                    <Link href={`/programs/${g.id}`} className="font-serif text-[22px] leading-tight text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4">{g.name}</Link>
                    {g.description && <p className="mt-1 line-clamp-2 max-w-3xl text-[13px] text-ink-3">{g.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {mod && <ButtonLink href={mod.href} size="sm" variant="ghost">{mod.label}<ArrowUpRight size={12} /></ButtonLink>}
                    <ButtonLink href={`/programs/${g.id}`} size="sm">Open</ButtonLink>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="col-span-2 sm:col-span-1 lg:col-span-1">
                    <div className="eyebrow mb-1.5">Progress</div>
                    <div className="flex items-center gap-2"><Progress value={g.progress} className="w-20" tone={g.derived_health === "on_track" ? "neutral" : g.derived_health === "at_risk" ? "amber" : "red"} /><span className="font-medium tabular">{pctInt(g.progress)}%</span></div>
                  </div>
                  <Metric label="Projects" value={g.projects.length} sub={g.at_risk ? `${g.at_risk} at risk` : "all on track"} tone={g.at_risk ? "text-warn" : undefined} />
                  <Metric label="Overdue actions" value={g.overdue_tasks} sub={`${g.open_tasks} open`} tone={g.overdue_tasks ? "text-bad" : undefined} href={`/programs/${g.id}#overdue`} />
                  <Metric label="Open risks" value={g.open_risks} sub={g.critical_risks ? `${g.critical_risks} critical` : undefined} tone={g.critical_risks ? "text-bad" : undefined} href={`/programs/${g.id}#risks`} />
                  <div>
                    <div className="eyebrow mb-1.5">Next milestone</div>
                    {next ? <div className="text-[12.5px]"><div className="truncate text-ink-2" title={next.title}>{next.title}</div><div className={cn("tabular", next.overdue ? "text-bad" : "text-ink-3")}>{relDay(next.due_date)}{g.slipped ? ` · ${g.slipped} slipped` : ""}</div></div> : <span className="text-[12.5px] text-ink-4">None in 30 days</span>}
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Owners</div>
                    <div className="flex items-center gap-2"><Avatar name={g.owner_name} color={g.owner_color} size={22} />{owners.length > 0 && <AvatarStack people={owners} max={4} size={20} />}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone, href }: { label: string; value: number; sub?: string; tone?: string; href?: string }) {
  const inner = (
    <>
      <div className="eyebrow mb-1">{label}</div>
      <div className={cn("font-serif text-[24px] leading-none tabular", value ? tone ?? "text-ink" : "text-ink-4")}>{value}</div>
      {sub && <div className={cn("mt-1 text-[11.5px]", tone && value ? tone : "text-ink-3")}>{sub}</div>}
    </>
  );
  return href ? <Link href={href} className="block hover:opacity-80">{inner}</Link> : <div>{inner}</div>;
}
