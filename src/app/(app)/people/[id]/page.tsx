import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Boxes, CalendarClock, CircleCheck, FolderKanban, History, MessageSquareText, Target } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, HealthBadge, PageHeader } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser, canManage } from "@/server/auth";
import { getPersonRow, personDetail } from "@/server/people/queries";
import { listTasks } from "@/server/tasks/queries";
import { ago, fmtDate, fmtMonth, relDay, today } from "@/lib/dates";
import { inr, pct, plural } from "@/lib/format";
import type { Health } from "@/lib/meta";
import { cn } from "@/lib/cn";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await getPersonRow(id) : null;
  return { title: p ? p.name : "Person" };
}

const KIND_ICON = { task: CircleCheck, milestone: FolderKanban, aop: Target, sop: Boxes, decision: CalendarClock } as const;
const ROLE_LABEL: Record<string, string> = { admin: "Admin", pm: "Program manager", owner: "Owner", viewer: "Viewer", leadership: "Leadership" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getPersonRow(id);
  if (!p) notFound();
  const [d, tasks, delegated] = await Promise.all([
    personDetail(id),
    listTasks({ ownerId: id, open: true, order: "due", limit: 100 }),
    listTasks({ delegatedBy: id, open: true, order: "due", limit: 20 }),
  ]);
  const td = today();
  const responseRate = p.followups_requested ? p.followups_responded / p.followups_requested : null;

  return (
    <div>
      <Link href="/people" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ArrowLeft size={13} />People & Teams</Link>
      <PageHeader
        title={<span className="flex items-center gap-3"><Avatar name={p.name} color={p.avatar_color} size={40} />{p.name}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{p.title ?? "—"}{p.team_name && <><span className="text-ink-4">·</span><Link href={`/people?tab=teams&team=${p.team_id}#team-${p.team_id}`} className="hover:text-ink">{p.team_name}</Link></>}<span className="text-ink-4">·</span>{ROLE_LABEL[p.role] ?? p.role}{!p.active && <Badge tone="muted">Inactive</Badge>}</span>}
        actions={canManage(user) ? <ButtonLink href={`/settings?tab=users&user=${p.id}`} size="sm">Edit access</ButtonLink> : null}
      />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
        <Metric label="Active tasks" value={p.active_tasks} href="#tasks" hint={p.due_week ? `${p.due_week} due this week` : "Nothing due this week"} />
        <Metric label="Overdue" value={p.overdue} href="#tasks" tone={p.overdue ? "bad" : undefined} hint={p.overdue ? "Follow up" : "On schedule"} />
        <Metric label="Projects & programs" value={d.projects.length + d.programs.length} href="#projects" hint={`${d.projects.filter((x) => x.role === "Owner").length} owned`} />
        <Metric label="AOP & S&OP" value={d.aop.length + d.streams.length} href="#aop" hint={`${d.aop.length} AOP · ${d.streams.length} S&OP`} />
        <Metric label="Follow-up responses" value={responseRate == null ? "—" : pct(responseRate)} href="#followups" hint={p.followups_requested ? `${p.followups_responded} of ${p.followups_requested}${p.followups_open ? ` · ${p.followups_open} open` : ""}` : "None requested yet"} tone={p.followups_open ? "warn" : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card id="tasks" className="overflow-hidden">
            <CardHeader icon={<CircleCheck size={15} />} title="Open tasks" subtitle={tasks.length ? `${plural(tasks.length, "task")}${p.overdue ? ` · ${p.overdue} overdue` : ""}` : undefined}
              action={tasks.length ? <ButtonLink href={`/tasks/all?owner=${p.id}`} size="xs" variant="ghost">Open in Tasks</ButtonLink> : null} />
            <TaskList tasks={tasks} showOwner={false} empty={<EmptyState compact icon={<CircleCheck size={18} />} title="Nothing open" body={`${p.name.split(" ")[0]} has no open tasks.`} />} />
          </Card>

          {delegated.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Delegated by them" subtitle={`${plural(delegated.length, "open task")} owned by others`} />
              <TaskList tasks={delegated} />
            </Card>
          )}

          <Card id="projects" className="overflow-hidden">
            <CardHeader icon={<FolderKanban size={15} />} title="Projects & programs" />
            {d.projects.length + d.programs.length === 0 ? <EmptyState compact title="No projects or programs" body="Not an owner, sponsor or member of any active project." /> : (
              <table className="table-base">
                <tbody>
                  {d.programs.map((g) => (
                    <tr key={g.id}><td><Link href={`/programs/${g.id}`} className="font-medium hover:underline">{g.name}</Link> <span className="ml-1 text-[11.5px] text-ink-4">Program</span></td><td className="text-ink-3">{g.role}</td><td className="text-right"><HealthBadge health={g.health as Health} /></td></tr>
                  ))}
                  {d.projects.map((x) => (
                    <tr key={x.id}>
                      <td><Link href={`/projects/${x.id}`} className="font-medium hover:underline">{x.name}</Link>{x.program_name && <span className="ml-2 text-[12px] text-ink-4">{x.program_name}</span>}</td>
                      <td className="text-ink-3">{x.role}</td>
                      <td className="text-right"><span className="mr-3 text-[12px] text-ink-3">{x.target_date ? `Target ${fmtDate(x.target_date)}` : ""}</span><HealthBadge health={x.health as Health} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card id="aop" className="overflow-hidden">
            <CardHeader icon={<Target size={15} />} title="AOP lines owned" subtitle="YTD actuals vs budget on reported months" action={d.aop.length ? <ButtonLink href="/aop" size="xs" variant="ghost">Open AOP</ButtonLink> : null} />
            {d.aop.length === 0 ? <EmptyState compact title="No AOP lines" body="Owns no AOP functions or lines in the active cycle." /> : (
              <div className="max-h-[360px] overflow-y-auto scroll-thin">
                <table className="table-base">
                  <thead><tr><th>Line</th><th className="text-right">YTD budget</th><th className="text-right">YTD actual</th><th className="text-right">Variance</th></tr></thead>
                  <tbody>
                    {d.aop.map((l) => {
                      const v = l.ytd_plan ? (l.ytd_actual - l.ytd_plan) / l.ytd_plan : null;
                      return (
                        <tr key={l.kind + l.id}>
                          <td>
                            <div className={cn("text-ink", l.kind === "section" && "font-medium")}>{l.name}{l.kind === "section" && <span className="ml-2 text-[11.5px] font-normal text-ink-4">Function</span>}</div>
                            {l.kind === "item" && <div className="text-[11.5px] text-ink-4">{l.function_name} · {l.section}</div>}
                            {l.pending_inputs > 0 && <Badge tone="amber" className="mt-1">{plural(l.pending_inputs, "input")} pending</Badge>}
                          </td>
                          <td className="text-right tabular text-ink-2">{inr(l.ytd_plan)}</td>
                          <td className="text-right tabular text-ink-2">{inr(l.ytd_actual)}</td>
                          <td className={cn("text-right tabular", v == null ? "text-ink-4" : v > 0.05 ? "text-bad" : v < -0.05 ? "text-ok" : "text-ink-3")}>{v == null ? "—" : pct(v, 1, true)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card id="sop" className="overflow-hidden">
            <CardHeader icon={<Boxes size={15} />} title="S&OP streams" action={d.streams.length ? <ButtonLink href="/sop" size="xs" variant="ghost">Open S&OP</ButtonLink> : null} />
            {d.streams.length === 0 ? <EmptyState compact title="No S&OP streams" body="Not the POC for any projection stream." /> : (
              <table className="table-base">
                <tbody>
                  {d.streams.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.name}<span className="ml-2 text-[12px] font-normal capitalize text-ink-4">{s.area}</span></td>
                      <td className="text-ink-3">{s.next_period ? `Next: ${fmtMonth(s.next_period)} projection` : "All inputs in"}</td>
                      <td className="text-right">
                        {s.late > 0 ? <Badge tone="red" dot>{plural(s.late, "input")} late</Badge> : s.next_due ? <span className={cn("text-[12px]", s.next_due < td ? "text-bad" : "text-ink-3")}>Due {relDay(s.next_due)}</span> : <Badge tone="green" dot>Up to date</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon={<CalendarClock size={15} />} title="Upcoming deadlines" subtitle="Next 3 weeks" />
            {d.deadlines.length === 0 ? <div className="px-4 py-5 text-[12.5px] text-ink-3">Nothing due in the next three weeks.</div> : (
              <ul className="divide-y divide-line/70">
                {d.deadlines.map((x, i) => {
                  const Icon = KIND_ICON[x.kind];
                  return (
                    <li key={i}>
                      <Link href={x.href} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-subtle/60">
                        <Icon size={14} className="mt-0.5 shrink-0 text-ink-4" />
                        <span className="min-w-0 flex-1 text-[13px] text-ink">{x.title}</span>
                        <span className={cn("shrink-0 text-[12px] tabular", x.date === td ? "font-medium text-warn" : "text-ink-3")}>{relDay(x.date)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card id="followups">
            <CardHeader icon={<MessageSquareText size={15} />} title="Recent updates" />
            {d.updates.length === 0 ? <div className="px-4 py-5 text-[12.5px] text-ink-3">No updates posted yet.</div> : (
              <ul className="divide-y divide-line/70">
                {d.updates.map((u, i) => (
                  <li key={i} className="px-4 py-2.5">
                    <Link href={u.href} className="block text-[12.5px] font-medium text-ink hover:underline">{u.title}</Link>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{u.body}</p>
                    <div className="mt-0.5 text-[11.5px] text-ink-4">{u.kind === "project" ? "Project update" : "Task update"} · {ago(u.at)}</div>
                  </li>
                ))}
              </ul>
            )}
            {d.followups.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <div className="eyebrow mb-2">Follow-ups to {p.name.split(" ")[0]}</div>
                <ul className="space-y-1.5">
                  {d.followups.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-[12.5px]">
                      <span className={cn("size-1.5 shrink-0 rounded-full", f.status === "open" ? "bg-warn" : f.status === "responded" ? "bg-ok" : "bg-ink-4")} />
                      <Link href={`/tasks/${f.entity_id}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">{f.title ?? f.message}</Link>
                      <span className="shrink-0 text-ink-4">{f.status === "open" ? `asked ${ago(f.created_at)}` : f.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader icon={<History size={15} />} title="Recent activity" />
            {d.activity.length === 0 ? <div className="px-4 py-5 text-[12.5px] text-ink-3">No activity recorded yet.</div> : (
              <ul className="relative px-4 py-3">
                {d.activity.map((a) => (
                  <li key={a.id} className="relative flex gap-2.5 pb-3 last:pb-0">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-4" />
                    <div className="min-w-0 text-[12.5px]">
                      <span className="text-ink-2">{describe(a)}</span>
                      <div className="text-[11.5px] text-ink-4">{ago(a.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="px-4 py-3 text-[12.5px] text-ink-3">
            <div className="flex justify-between py-1"><span>Email</span><span className="text-ink-2">{p.email ?? <span className="text-warn">No email — can't sign in</span>}</span></div>
            <div className="flex justify-between py-1"><span>Joined</span><span className="text-ink-2">{fmtDate(p.joined_at, { year: true })}</span></div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint, href, tone }: { label: string; value: number | string; hint?: string; href: string; tone?: "bad" | "warn" }) {
  return (
    <Link href={href} className="group bg-surface px-4 py-3.5 transition-colors hover:bg-subtle/50">
      <div className="eyebrow mb-1">{label}</div>
      <div className={cn("font-serif text-[22px] leading-none tabular", tone === "bad" ? "text-bad" : "text-ink")}>{value}</div>
      {hint && <div className={cn("mt-1.5 text-[12px]", tone === "warn" ? "text-warn" : "text-ink-3")}>{hint}</div>}
    </Link>
  );
}

function describe(a: { action: string; entity_type: string; summary: string | null; field: string | null; from_value: string | null; to_value: string | null }) {
  const what = a.summary ?? a.entity_type;
  const verb: Record<string, string> = {
    created: "Created", completed: "Completed", blocked: "Marked blocked", unblocked: "Unblocked", due_changed: "Moved the due date of", update_posted: "Posted an update on",
    followed_up: "Followed up on", assigned: "Reassigned", status_changed: "Changed status of", updated: "Updated", priority_changed: "Changed priority of", reopened: "Reopened", cancelled: "Cancelled",
  };
  const tail = a.action === "due_changed" && a.to_value ? ` → ${fmtDate(a.to_value)}` : a.action === "updated" && a.field === "health" && a.to_value ? ` → ${a.to_value.replace("_", " ")}` : "";
  return `${verb[a.action] ?? a.action.replace(/_/g, " ")} ${what}${tail}`;
}
