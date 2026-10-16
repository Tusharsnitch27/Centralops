import Link from "next/link";
import { AlertTriangle, MessageCircleQuestion, Users } from "lucide-react";
import { Avatar, AvatarStack, Badge, ButtonLink, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireUser, canManage } from "@/server/auth";
import { listPeopleOverview, listTeamsOverview, type PersonRow } from "@/server/people/queries";
import { listTasks } from "@/server/tasks/queries";
import { TaskList } from "@/components/tasks/TaskRow";
import { relDay, ago } from "@/lib/dates";
import { plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "People & Teams" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string; team?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "teams" ? "teams" : "people";
  const [people, teams] = await Promise.all([listPeopleOverview(), listTeamsOverview()]);
  const withOverdue = people.filter((p) => p.overdue > 0).length;
  const awaiting = people.reduce((s, p) => s + p.followups_open, 0);

  return (
    <div>
      <PageHeader eyebrow="Organisation" title="People & Teams"
        subtitle="Who owns what across tasks, projects, AOP lines and S&OP streams — an ownership map, not a scorecard."
        actions={canManage(user) ? <ButtonLink href="/settings?tab=users" size="sm">Manage users</ButtonLink> : null} />

      {(withOverdue > 0 || awaiting > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px]">
          {withOverdue > 0 && (
            <Link href="/exceptions#overdue" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-2 hover:border-line-strong hover:text-ink">
              <AlertTriangle size={13} className="text-bad" />{plural(withOverdue, "person has", "people have")} overdue work <span className="text-ink-4">→</span>
            </Link>
          )}
          {awaiting > 0 && (
            <Link href="/followups" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-ink-2 hover:border-line-strong hover:text-ink">
              <MessageCircleQuestion size={13} className="text-warn" />{plural(awaiting, "follow-up")} awaiting a response <span className="text-ink-4">→</span>
            </Link>
          )}
        </div>
      )}

      <Tabs className="mb-5" active={tab} items={[
        { key: "people", label: "People", href: "/people", count: people.length },
        { key: "teams", label: "Teams", href: "/people?tab=teams", count: teams.length },
      ]} />

      {tab === "people" ? <PeopleTable people={people} /> : <TeamsView teams={teams} focus={sp.team} />}
    </div>
  );
}

function PeopleTable({ people }: { people: PersonRow[] }) {
  if (!people.length) return <Card><EmptyState icon={<Users size={18} />} title="No people yet" body="Add teammates in Settings → Users & access." action={<ButtonLink href="/settings?tab=users">Add people</ButtonLink>} /></Card>;
  const groups = new Map<string, PersonRow[]>();
  for (const p of people) groups.set(p.team_name ?? "No team", [...(groups.get(p.team_name ?? "No team") ?? []), p]);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base min-w-[980px]">
          <thead>
            <tr>
              <th className="w-[260px]">Person</th>
              <th className="text-right">Active tasks</th>
              <th className="text-right">Overdue</th>
              <th className="text-right">Projects</th>
              <th className="text-right">AOP lines</th>
              <th className="text-right">S&OP streams</th>
              <th className="text-right" title="Follow-ups responded / requested">Responses</th>
              <th>Next deadline</th>
              <th>Last update</th>
            </tr>
          </thead>
          {[...groups.entries()].map(([team, rows]) => (
            <tbody key={team}>
              <tr className="hover:bg-transparent">
                <td colSpan={9} className="h-8 bg-subtle/60 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
                  <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: rows[0].team_color ?? "#a1a1aa" }} />{team}<span className="font-normal normal-case tracking-normal text-ink-4">{rows.length}</span></span>
                </td>
              </tr>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/people/${p.id}`} className="flex items-center gap-2.5">
                      <Avatar name={p.name} color={p.avatar_color} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink hover:underline decoration-ink-4 underline-offset-2">{p.name}</span>
                        <span className="block truncate text-[12px] text-ink-3">{p.title ?? "—"}</span>
                      </span>
                    </Link>
                  </td>
                  <Num v={p.active_tasks} href={`/people/${p.id}#tasks`} />
                  <td className="text-right tabular">{p.overdue ? <Link href={`/people/${p.id}#tasks`} className="font-medium text-bad hover:underline">{p.overdue}</Link> : <span className="text-ink-4">—</span>}</td>
                  <Num v={p.projects} href={`/people/${p.id}#projects`} />
                  <Num v={p.aop_lines + p.aop_sections} href={`/people/${p.id}#aop`} />
                  <Num v={p.sop_streams} href={`/people/${p.id}#sop`} />
                  <td className="text-right tabular text-ink-2">
                    {p.followups_requested ? <span title={`${p.followups_responded} of ${p.followups_requested} follow-ups answered`}>{p.followups_responded}/{p.followups_requested}{p.followups_open > 0 && <span className="ml-1.5 text-warn">· {p.followups_open} open</span>}</span> : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="text-ink-2">{p.next_due ? relDay(p.next_due) : <span className="text-ink-4">—</span>}</td>
                  <td className="text-ink-3">{p.last_update_at ? ago(p.last_update_at) : <span className="text-ink-4">—</span>}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Card>
  );
}

const Num = ({ v, href }: { v: number; href: string }) => (
  <td className="text-right tabular">{v ? <Link href={href} className="text-ink-2 hover:text-ink hover:underline">{v}</Link> : <span className="text-ink-4">—</span>}</td>
);

async function TeamsView({ teams, focus }: { teams: Awaited<ReturnType<typeof listTeamsOverview>>; focus?: string }) {
  if (!teams.length) return <Card><EmptyState icon={<Users size={18} />} title="No teams yet" body="Create teams in Settings to assign team-owned work." action={<ButtonLink href="/settings?tab=teams">Create a team</ButtonLink>} /></Card>;
  const teamTasks = await Promise.all(teams.map((t) => (t.team_owned ? listTasks({ teamId: t.id, open: true, limit: 200 }).then((ts) => ts.filter((x) => x.owner_team_id === t.id).slice(0, focus === t.id ? 50 : 4)) : Promise.resolve([]))));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {teams.map((t, i) => (
        <Card key={t.id} id={`team-${t.id}`} className={cn("overflow-hidden", focus === t.id && "ring-2 ring-ink/10")}>
          <div className="flex items-start justify-between gap-3 px-4 pt-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white" style={{ background: t.color ?? "#71717a" }}>{t.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{t.name}</div>
                <div className="truncate text-[12px] text-ink-3">{t.function ?? "—"} · Lead {t.lead_id ? <Link href={`/people/${t.lead_id}`} className="text-ink-2 hover:underline">{t.lead_name}</Link> : <span className="text-ink-4">not set</span>}</div>
              </div>
            </div>
            <AvatarStack people={t.members.map((m) => ({ name: m.name, color: m.color }))} max={5} />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-px border-y border-line bg-line text-center">
            {[["Open tasks", t.open_tasks, null], ["Team-owned", t.team_owned, null], ["Overdue", t.overdue, t.overdue ? "text-bad" : null], ["Projects", t.projects, null]].map(([l, v, c]) => (
              <div key={l as string} className="bg-surface px-2 py-2.5">
                <div className={cn("font-serif text-[18px] leading-none tabular", (c as string) ?? "text-ink")}>{v as number}</div>
                <div className="mt-1 text-[11px] text-ink-3">{l as string}</div>
              </div>
            ))}
          </div>
          <div className="px-1 py-1">
            {teamTasks[i].length ? <TaskList tasks={teamTasks[i]} showOwner={false} /> : (
              <div className="px-3 py-4 text-[12.5px] text-ink-3">No team-owned work open. {t.members.length ? `${plural(t.members.length, "member")}.` : ""}</div>
            )}
          </div>
          {t.team_owned > teamTasks[i].length && (
            <div className="border-t border-line px-4 py-2 text-[12.5px]"><Link href={`/people?tab=teams&team=${t.id}#team-${t.id}`} className="text-ink-2 hover:text-ink">View all {t.team_owned} team tasks →</Link></div>
          )}
          {t.blocked > 0 && <div className="border-t border-line px-4 py-2"><Badge tone="red" dot>{plural(t.blocked, "blocked task")}</Badge></div>}
        </Card>
      ))}
    </div>
  );
}
