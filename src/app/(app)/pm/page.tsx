import Link from "next/link";
import { ArrowUpRight, Ban, CalendarRange, Flame, Gavel, Hourglass, ShieldAlert, Sparkles, UserX } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, HealthBadge, PageHeader } from "@/components/ui";
import { AttentionList } from "@/components/home/Attention";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser } from "@/server/auth";
import { attention } from "@/server/home/attention";
import { projectsWatch } from "@/server/home/overview";
import { escalations, missingUpdates, upcomingReviews } from "@/server/home/pm";
import { listTasks } from "@/server/tasks/queries";
import { q } from "@/server/db";
import { dateOf, fmtDate, fmtTime, relDay, today } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Health } from "@/lib/meta";

export const metadata = { title: "Program Manager" };

export default async function PmMode() {
  const u = await requireUser();
  const [items, waiting, delegated, esc, reviews, missing, projects, decisions] = await Promise.all([
    attention(u),
    listTasks({ waitingOnOthersFor: u.id, open: true, limit: 8 }),
    listTasks({ delegatedBy: u.id, open: true, order: "due", limit: 12 }),
    escalations(), upcomingReviews(), missingUpdates(), projectsWatch(),
    q<{ id: string; title: string; due_date: string | null; maker: string | null; project: string | null }>(
      `select d.id, d.title, d.due_date, u.name as maker, p.name as project from decisions d left join users u on u.id = d.decision_maker_id left join projects p on p.id = d.project_id
       where d.status in ('pending','proposed') order by d.due_date nulls last`),
  ]);
  const atRisk = projects.filter((p) => p.health !== "on_track");
  const byOwner = new Map<string, number>();
  for (const m of missing) byOwner.set(m.who ?? "Unassigned", (byOwner.get(m.who ?? "Unassigned") ?? 0) + 1);

  return (
    <>
      <PageHeader eyebrow="Program Manager mode" title="Run the programs, not the spreadsheets"
        subtitle="Everything that needs coordination today — capture → monitor → follow up → escalate → close."
        actions={<><ButtonLink href="/reports" size="sm">Weekly review</ButtonLink><ButtonLink href="/insights" size="sm" variant="primary"><Sparkles size={13} /> AI suggestions</ButtonLink></>} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Today" subtitle="Top of the attention queue" icon={<Flame size={15} />} action={<ButtonLink href="/" variant="ghost" size="xs">Command Centre <ArrowUpRight size={12} /></ButtonLink>} />
          {items.length ? <AttentionList items={items.slice(0, 6)} /> : <EmptyState compact title="All clear" />}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Escalations" subtitle="Blocked work, escalated risks, urgent decisions" icon={<ShieldAlert size={15} />} />
          {esc.length ? (
            <div className="divide-y divide-line/70">
              {esc.map((e) => (
                <Link key={e.kind + e.id} href={e.href} className="flex gap-3 px-4 py-2.5 hover:bg-subtle/60">
                  <span className="mt-0.5 text-ink-3">{e.kind === "risk" ? <ShieldAlert size={14} className="text-bad" /> : e.kind === "blocked" ? <Ban size={14} className="text-bad" /> : <Gavel size={14} className="text-warn" />}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink">{e.title}</div>
                    {e.detail && <div className="line-clamp-1 text-[11.5px] text-ink-3">{e.detail}</div>}
                  </div>
                </Link>
              ))}
            </div>
          ) : <EmptyState compact title="No escalations" />}
        </Card>

        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Delegated & waiting on others" subtitle={`${plural(delegated.length, "open delegated task")} · ${waiting.length} where you’re waiting`} icon={<Hourglass size={15} />}
            action={<ButtonLink href="/followups" variant="ghost" size="xs">Follow-ups <ArrowUpRight size={12} /></ButtonLink>} />
          <TaskList tasks={[...waiting, ...delegated.filter((d) => !waiting.some((w) => w.id === d.id))].slice(0, 12)} empty={<EmptyState compact title="Nothing delegated yet" />} />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Missing updates" subtitle={`${plural(missing.length, "input")} across ${plural(byOwner.size, "owner")}`} icon={<UserX size={15} />} />
          {missing.length ? (
            <div className="divide-y divide-line/70">
              {missing.slice(0, 10).map((m, i) => (
                <Link key={i} href={m.href} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-subtle/60">
                  <Avatar name={m.who} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{m.what}</div>
                    <div className="text-[11.5px] text-ink-3">{m.who ?? "Unassigned"} · {m.kind}{m.due ? ` · due ${relDay(m.due).toLowerCase()}` : " · no update in 7d+"}</div>
                  </div>
                  {m.due && m.due < today() && <Badge tone="red">Late</Badge>}
                </Link>
              ))}
            </div>
          ) : <EmptyState compact title="Everyone’s up to date" />}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Upcoming reviews" subtitle="Pre-reads compile automatically" icon={<CalendarRange size={15} />} action={<ButtonLink href="/reviews" variant="ghost" size="xs">All <ArrowUpRight size={12} /></ButtonLink>} />
          {reviews.length ? (
            <div className="divide-y divide-line/70">
              {reviews.map((r) => (
                <Link key={r.id} href={`/meetings/${r.id}`} className="block px-4 py-2.5 hover:bg-subtle/60">
                  <div className="flex items-center gap-2"><span className="flex-1 truncate text-[13px] font-medium">{r.title}</span><span className="text-[11.5px] tabular text-ink-3">{fmtDate(dateOf(r.starts_at))} · {fmtTime(r.starts_at)}</span></div>
                  <div className="mt-0.5 text-[11.5px] text-ink-3">MoM: {r.mom_owner ?? "—"} · {r.open_actions} open actions{r.overdue_actions ? <span className="text-bad"> · {r.overdue_actions} overdue</span> : null}</div>
                </Link>
              ))}
            </div>
          ) : <EmptyState compact title="No reviews in the next 10 days" />}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Projects at risk" icon={<ShieldAlert size={15} />} action={<ButtonLink href="/projects" variant="ghost" size="xs">All <ArrowUpRight size={12} /></ButtonLink>} />
          {atRisk.length ? (
            <div className="divide-y divide-line/70">
              {atRisk.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-subtle/60">
                  <span className="flex-1 truncate text-[13px]">{p.name}</span>
                  {p.overdue > 0 && <span className="text-[11.5px] text-bad">{p.overdue} overdue</span>}
                  <HealthBadge health={p.health as Health} />
                </Link>
              ))}
            </div>
          ) : <EmptyState compact title="No projects at risk" />}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Decisions required" icon={<Gavel size={15} />} action={<ButtonLink href="/decisions" variant="ghost" size="xs">Log <ArrowUpRight size={12} /></ButtonLink>} />
          {decisions.length ? (
            <div className="divide-y divide-line/70">
              {decisions.map((d) => (
                <Link key={d.id} href={`/decisions?focus=${d.id}`} className="block px-4 py-2.5 hover:bg-subtle/60">
                  <div className="text-[13px]">{d.title}</div>
                  <div className="text-[11.5px] text-ink-3">{d.maker ?? "—"}{d.project ? ` · ${d.project}` : ""}{d.due_date ? ` · by ${fmtDate(d.due_date)}` : ""}</div>
                </Link>
              ))}
            </div>
          ) : <EmptyState compact title="No pending decisions" />}
        </Card>
      </div>
    </>
  );
}
