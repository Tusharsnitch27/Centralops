import Link from "next/link";
import type { ReactNode } from "react";
import { AlarmClock, AlertOctagon, Boxes, CircleCheck, FolderKanban, Gavel, Hourglass, Milestone, NotebookPen, Target, TriangleAlert, Warehouse } from "lucide-react";
import { Avatar, ButtonLink, PageHeader } from "@/components/ui";
import { RequestUpdatesButton } from "@/components/exceptions/RequestUpdatesButton";
import { requireUser } from "@/server/auth";
import {
  aopState, blockedTasks, capacityBreaches, meetingsWithoutMom, milestoneSlips, openRisks, overdueTasks, pendingDecisions, projectsAtRisk, ruleNum,
  scopeFor, sopLateInputs, staleDelegated,
} from "@/server/insights/signals";
import { monthLong } from "@/server/reports/util";
import { fmtDate, fmtMonth, relDay, dateOf } from "@/lib/dates";
import { inr, pct, plural } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Exceptions" };

type Tone = "red" | "amber" | "info";
interface Row { key: string; primary: ReactNode; secondary?: ReactNode; right?: ReactNode; href?: string }
interface Group { id: string; title: string; icon: ReactNode; tone: Tone; count: number; unit: string; rows: Row[]; cta: ReactNode; more?: number }

export default async function ExceptionsPage() {
  const user = await requireUser();
  const s = await scopeFor(user.id);
  const staleDays = await ruleNum("tasks.no_update", "threshold", 5);
  const [overdue, stale, blocked, slips, atRisk, risks, decisions, aop, sopLate, caps, noMom] = await Promise.all([
    overdueTasks(s), staleDelegated(s), blockedTasks(s), milestoneSlips(s), projectsAtRisk(s), openRisks(s, 10), pendingDecisions(s),
    aopState(), sopLateInputs(s), capacityBreaches(), meetingsWithoutMom(s),
  ]);
  const showAop = s.manage || aop.functions.some((f) => f.owner_id === s.userId);

  // Overdue by owner
  const byOwner = new Map<string, { name: string; tasks: typeof overdue }>();
  for (const t of overdue) {
    const k = t.owner_id ?? `team:${t.owner_team_name ?? "none"}`;
    const g = byOwner.get(k) ?? { name: t.owner_name ?? t.owner_team_name ?? "Unassigned", tasks: [] };
    g.tasks.push(t); byOwner.set(k, g);
  }
  const owners = [...byOwner.entries()].sort((a, b) => b[1].tasks.length - a[1].tasks.length);
  const pastDue = decisions.filter((d) => d.days_overdue > 0);
  const missing = aop.missing.filter((m) => m.days_late > 0 || m.due_date === dateOf(new Date()));
  const overdueMoms = noMom;
  const missingByFn = [...missing.reduce((m, x) => m.set(x.section_id, [...(m.get(x.section_id) ?? []), x]), new Map<string, typeof missing>()).entries()];

  const groups: Group[] = [
    { id: "overdue", title: "Overdue tasks", icon: <AlarmClock size={15} />, tone: "red", count: overdue.length, unit: "task",
      rows: owners.slice(0, 6).map(([k, g]) => ({ key: k, primary: <span className="flex items-center gap-2"><Avatar name={g.name} size={20} />{g.name}</span>,
        secondary: g.tasks.slice(0, 2).map((t) => t.title).join(" · "), right: <span className="font-medium text-bad">{g.tasks.length} · oldest {g.tasks[0].days_overdue}d</span>,
        href: g.tasks.length === 1 ? `/tasks/${g.tasks[0].id}` : k.startsWith("team:") ? "/tasks" : `/people/${k}#tasks` })),
      more: Math.max(0, owners.length - 6), cta: <RequestUpdatesButton taskIds={overdue.map((t) => t.id)} label="Follow up on all" /> },
    { id: "stale", title: `Delegated, no update in ${staleDays}+ days`, icon: <Hourglass size={15} />, tone: "amber", count: stale.length, unit: "task",
      rows: stale.slice(0, 6).map((t) => ({ key: t.id, primary: t.title, secondary: `${t.owner_name ?? t.owner_team_name ?? "—"}${t.last_update_note ? ` · last: “${t.last_update_note}”` : ""}`, right: `${t.days_since_update}d silent`, href: `/tasks/${t.id}` })),
      more: Math.max(0, stale.length - 6), cta: <RequestUpdatesButton taskIds={stale.map((t) => t.id)} /> },
    { id: "blocked", title: "Blocked tasks", icon: <AlertOctagon size={15} />, tone: "red", count: blocked.length, unit: "task",
      rows: blocked.slice(0, 6).map((t) => ({ key: t.id, primary: t.title, secondary: `${t.owner_name ?? t.owner_team_name ?? "—"}${t.blocker ? ` · ${t.blocker}` : ""}`, right: t.due_date ? relDay(t.due_date) : undefined, href: `/tasks/${t.id}` })),
      cta: <ButtonLink href="/tasks?status=blocked" size="xs" variant="primary">Unblock</ButtonLink> },
    { id: "milestones", title: "Slipped or overdue milestones", icon: <Milestone size={15} />, tone: "red", count: slips.length, unit: "milestone",
      rows: slips.slice(0, 6).map((m) => ({ key: m.id, primary: `${m.project_code ?? m.project_name} · ${m.title}`, secondary: `${m.owner_name ?? "—"} · baseline ${fmtDate(m.baseline_date)} → ${fmtDate(m.due_date)}`,
        right: m.overdue_days > 0 ? <span className="font-medium text-bad">{m.overdue_days}d overdue</span> : <span className="text-warn">+{m.slip_days}d slip</span>, href: `/projects/${m.project_id}` })),
      cta: <ButtonLink href="/projects" size="xs" variant="primary">Review projects</ButtonLink> },
    { id: "projects", title: "Projects at risk", icon: <FolderKanban size={15} />, tone: "amber", count: atRisk.length, unit: "project",
      rows: atRisk.map((p) => ({ key: p.id, primary: p.name, secondary: [p.owner_name, p.last_blockers ? `blocker: ${p.last_blockers}` : null, p.overdue_tasks ? `${p.overdue_tasks} overdue` : null].filter(Boolean).join(" · "),
        right: <span className={p.health === "delayed" ? "font-medium text-bad" : "text-warn"}>{p.health === "delayed" ? "Delayed" : "At risk"}</span>, href: `/projects/${p.id}` })),
      cta: <ButtonLink href="/reports/project" size="xs" variant="primary">Status report</ButtonLink> },
    { id: "risks", title: "Critical & high risks", icon: <TriangleAlert size={15} />, tone: "red", count: risks.length, unit: "risk",
      rows: risks.slice(0, 6).map((r) => ({ key: r.id, primary: r.title, secondary: `${r.owner_name ?? "—"}${r.mitigation ? ` · ${r.mitigation}` : " · no mitigation"}`,
        right: <span className={r.score >= 15 ? "font-medium text-bad" : "text-warn"}>{r.score >= 15 ? "Critical" : "High"} · {r.score}</span>, href: r.project_id ? `/projects/${r.project_id}` : "/risks" })),
      cta: <ButtonLink href="/risks" size="xs" variant="primary">Resolve</ButtonLink> },
    { id: "decisions", title: "Decisions past due", icon: <Gavel size={15} />, tone: "amber", count: pastDue.length, unit: "decision",
      rows: pastDue.map((d) => ({ key: d.id, primary: d.title, secondary: [d.maker_name, d.project_name].filter(Boolean).join(" · "), right: <span className="text-bad">{d.days_overdue}d past due</span>, href: "/decisions" })),
      cta: <ButtonLink href="/decisions" size="xs" variant="primary">Decide</ButtonLink> },
    ...(showAop ? [
      { id: "aop-over", title: `AOP overspends (> ${pct(await ruleNum("aop.overspend", "threshold", 0.05))} over budget)`, icon: <Target size={15} />, tone: "red" as Tone, count: aop.overspends.length, unit: "line",
        rows: aop.overspends.slice(0, 6).map((l) => ({ key: l.item_id, primary: `${l.function_name} · ${l.item}`, secondary: `${fmtMonth(l.period)} · ${inr(l.actual)} vs ${inr(l.plan)}${l.owner_name ? ` · ${l.owner_name}` : ""}`,
          right: <span className="font-medium text-bad">{inr(l.variance, { sign: true })} · {pct(l.variance_pct, 0, true)}</span>, href: "/aop" })),
        more: Math.max(0, aop.overspends.length - 6), cta: <ButtonLink href="/aop" size="xs" variant="primary">Review variances</ButtonLink> },
      { id: "aop-missing", title: "AOP inputs missing", icon: <Target size={15} />, tone: "amber" as Tone, count: missing.length, unit: "input",
        rows: missingByFn.slice(0, 6).map(([k, ms]) => ({ key: k, primary: ms[0].function_name, secondary: `${ms[0].owner_name ?? "—"} · ${ms.map((m) => `${monthLong(m.period).slice(0, 3)} ${m.kind}`).join(", ")}`,
          right: <span className={ms[0].days_late ? "font-medium text-bad" : "text-warn"}>{ms.length > 1 ? `${ms.length} inputs · ` : ""}{ms[0].days_late ? `oldest ${ms[0].days_late}d late` : "due today"}</span>, href: "/aop" })),
        more: Math.max(0, missingByFn.length - 6), cta: <ButtonLink href="/aop" size="xs" variant="primary">Chase inputs</ButtonLink> },
    ] : []),
    { id: "sop-late", title: "S&OP projections late", icon: <Boxes size={15} />, tone: "amber", count: sopLate.length, unit: "input",
      rows: sopLate.map((l) => ({ key: l.stream_id + l.period, primary: `${l.stream} — ${fmtMonth(l.period)}`, secondary: l.poc_name ?? "—", right: <span className="font-medium text-bad">{l.days_late}d late</span>, href: "/sop" })),
      cta: <ButtonLink href="/sop" size="xs" variant="primary">Remind POCs</ButtonLink> },
    { id: "capacity", title: "Warehouse capacity breaches", icon: <Warehouse size={15} />, tone: "red", count: caps.reduce((a, c) => a + c.departments, 0), unit: "department",
      rows: caps.map((c) => ({ key: c.period + c.warehouse, primary: `${c.warehouse} · ${fmtMonth(c.period)}`, secondary: `${plural(c.departments, "department")} short · worst ${c.worst_department}`,
        right: <span className="text-bad">−{Math.round(c.required - c.available).toLocaleString("en-IN")}/day</span>, href: "/sop" })),
      cta: <ButtonLink href="/sop" size="xs" variant="primary">Plan capacity</ButtonLink> },
    { id: "mom", title: "Meetings without MoM", icon: <NotebookPen size={15} />, tone: "amber", count: overdueMoms.length, unit: "meeting",
      rows: overdueMoms.slice(0, 6).map((m) => ({ key: m.id, primary: m.title, secondary: `MoM owner ${m.mom_owner_name ?? "—"} · ${m.mom_status === "draft" ? "draft in progress" : "not started"}`,
        right: <span className={m.overdue ? "font-medium text-bad" : "text-warn"}>{relDay(dateOf(m.starts_at))}</span>, href: `/meetings/${m.id}` })),
      cta: <ButtonLink href="/meetings" size="xs" variant="primary">Chase MoMs</ButtonLink> },
  ];
  const live = groups.filter((g) => g.count > 0);
  const clear = groups.filter((g) => g.count === 0);
  const total = live.reduce((a, g) => a + g.count, 0);

  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="Exceptions"
        subtitle={live.length ? `${plural(total, "item")} across ${plural(live.length, "area")} need attention${s.manage ? " — organisation-wide" : ""}.` : "Nothing needs attention right now."} />
      <nav className="mb-5 flex flex-wrap gap-1.5">
        {live.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
            <span className={cn("size-1.5 rounded-full", g.tone === "red" ? "bg-bad" : g.tone === "amber" ? "bg-warn" : "bg-info")} />{g.title.replace(/ \(.*\)$/, "")}<span className="tabular text-ink-4">{g.count}</span>
          </a>
        ))}
      </nav>
      {!live.length && (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-subtle text-ok"><CircleCheck size={18} /></span>
          <div className="text-[13px] font-medium">All clear</div>
          <p className="mt-1 max-w-sm text-[13px] text-ink-3">No overdue work, slipped milestones, budget overspends or late inputs.</p>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {live.map((g) => (
          <section key={g.id} id={g.id} className="card scroll-mt-20 overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <span className={cn("flex size-7 items-center justify-center rounded-lg border border-line", g.tone === "red" ? "text-bad" : g.tone === "amber" ? "text-warn" : "text-info")}>{g.icon}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13px] font-semibold text-ink">{g.title}</h2>
                <p className="text-[12px] text-ink-3">{plural(g.count, g.unit)}</p>
              </div>
              <span className={cn("font-serif text-[20px] leading-none tabular", g.tone === "red" ? "text-bad" : "text-warn")}>{g.count}</span>
            </header>
            <ul className="divide-y divide-line/70">
              {g.rows.map((r) => {
                const inner = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{r.primary}</div>
                      {r.secondary && <div className="truncate text-[12px] text-ink-3">{r.secondary}</div>}
                    </div>
                    {r.right && <div className="shrink-0 text-right text-[12px] tabular">{r.right}</div>}
                  </>
                );
                return <li key={r.key}>{r.href ? <Link href={r.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">{inner}</Link> : <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>}</li>;
              })}
            </ul>
            <footer className="flex items-center justify-between gap-3 border-t border-line bg-subtle/40 px-4 py-2">
              <span className="text-[12px] text-ink-4">{g.more ? `+${g.more} more` : ""}</span>
              {g.cta}
            </footer>
          </section>
        ))}
      </div>
      {clear.length > 0 && live.length > 0 && (
        <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
          <CircleCheck size={13} className="text-ok" />Clear: {clear.map((g) => g.title.replace(/ \(.*\)$/, "")).join(" · ")}
        </p>
      )}
    </div>
  );
}
