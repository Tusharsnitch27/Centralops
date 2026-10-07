import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft, Gavel, ListChecks, ShieldAlert, Target, TrendingUp, Users } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, HealthBadge, PageHeader, Prop } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { CopyText } from "@/components/projects/CopyText";
import { RequestUpdateButton } from "@/components/projects/ProjectControls";
import { ProjectTable } from "@/components/projects/ProjectViews";
import { MomOwnerPicker, ReviewFormButton } from "@/components/reviews/ReviewControls";
import { requireUser, canManage } from "@/server/auth";
import { getReviewPack, type ReviewPack } from "@/server/reviews/queries";
import { pickerOptions } from "@/server/projects/options";
import { pctInt } from "@/server/projects/metrics";
import { RISK_LEVEL, MOM_STATUS, HEALTH, type Tone } from "@/lib/meta";
import { dateOf, fmtDate, fmtMonth, fmtTime, relDay, today } from "@/lib/dates";
import { inr, pct, plural, num } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Review pack" };

function packText(p: ReviewPack) {
  const L: string[] = [];
  const r = p.review;
  L.push(`${r.name} — review pack (${fmtDate(today(), { year: true })})`);
  if (p.nextMeeting) L.push(`Next meeting: ${fmtDate(dateOf(p.nextMeeting.starts_at), { dow: true })}, ${fmtTime(p.nextMeeting.starts_at)} · MoM: ${r.mom_owner_name ?? "not set"}`);
  L.push("", `PREVIOUS ACTIONS — ${p.actions.overdue.length} overdue · ${p.actions.open.length} open · ${p.actions.closed.length} closed`);
  for (const t of p.actions.overdue) L.push(`  ! CO-${t.number} ${t.title} — ${t.owner_name ?? t.owner_team_name ?? "unassigned"}, due ${fmtDate(t.due_date)}`);
  for (const t of p.actions.open) L.push(`  · CO-${t.number} ${t.title} — ${t.owner_name ?? t.owner_team_name ?? "unassigned"}${t.due_date ? `, due ${fmtDate(t.due_date)}` : ""}`);
  for (const t of p.actions.closed) L.push(`  ✓ CO-${t.number} ${t.title}`);
  if (p.aop) {
    L.push("", `BUDGET VS ACTUAL — ${fmtMonth(p.aop.period)} (lines with actuals)`);
    for (const k of p.aop.kpis) L.push(`  ${k.name}: actual ${inr(k.actual)} vs budget ${inr(k.plan)} (${k.plan ? pct((k.actual - k.plan) / k.plan, 1, true) : "—"})${k.missing ? ` · ${k.missing} lines missing actuals` : ""}`);
    if (p.aop.deviations.length) { L.push("  Deviations:"); for (const d of p.aop.deviations) L.push(`   - ${d.section} · ${d.item}: ${inr(d.variance, { sign: true })} over budget`); }
    const pend = p.aop.submissions.filter((s) => s.status === "pending");
    if (pend.length) L.push(`  Actuals pending: ${pend.map((s) => `${s.name} (${s.owner_name ?? "—"})`).join(", ")}`);
  }
  if (p.sop) {
    const pend = p.sop.submissions.filter((s) => s.status === "pending" || s.status === "late");
    L.push("", `S&OP INPUTS — ${fmtMonth(p.sop.period)}: ${p.sop.submissions.length - pend.length}/${p.sop.submissions.length} submitted`);
    if (pend.length) L.push(`  Pending: ${pend.map((s) => `${s.name} (${s.owner_name ?? "—"})`).join(", ")}`);
    for (const a of p.sop.accuracy) if (a.projection) L.push(`  ${a.stream}: actual ${num(a.actual)} vs projection ${num(a.projection)} (${pct((a.actual - a.projection) / a.projection, 0, true)})`);
  }
  if (p.projects.length) {
    L.push("", "PROJECTS");
    for (const u of p.projectUpdates) L.push(`  ${u.project.name}: ${HEALTH[u.project.health].label}, ${pctInt(u.project.progress)}%${u.project.overdue_tasks ? `, ${u.project.overdue_tasks} overdue` : ""} · update ${u.days == null ? "never posted" : `${u.days}d ago`}`);
  }
  if (p.decisions.length) { L.push("", "DECISIONS REQUIRED"); for (const d of p.decisions) L.push(`  · ${d.title}${d.due_date ? ` (by ${fmtDate(d.due_date)})` : ""}${d.maker_name ? ` — ${d.maker_name}` : ""}`); }
  if (p.risks.length) { L.push("", "RISKS"); for (const r2 of p.risks) L.push(`  · [${RISK_LEVEL(r2.score).label} ${r2.score}] ${r2.title} — ${r2.owner_name ?? "no owner"}${r2.status === "escalated" ? " (escalated)" : ""}`); }
  return L.join("\n");
}

export default async function ReviewPackPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  const [pack, opts] = await Promise.all([getReviewPack(id), pickerOptions()]);
  if (!pack) notFound();
  const r = pack.review;
  const manager = canManage(user);
  const td = today();
  const last = pack.lastMeeting;
  const lastMs = last ? MOM_STATUS[last.mom_status as keyof typeof MOM_STATUS] : null;
  const staleUpdates = pack.projectUpdates.filter((u) => u.days == null || u.days >= 7);

  return (
    <div>
      <Link href="/reviews" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ChevronLeft size={14} />Reviews</Link>
      <PageHeader eyebrow={<span className="capitalize">{r.cadence === "adhoc" ? "Ad hoc" : r.cadence} review{r.program_name ? ` · ${r.program_name}` : ""}</span>} title={r.name}
        subtitle={pack.nextMeeting ? <>Next meeting <Link href={`/meetings/${pack.nextMeeting.id}`} className="font-medium text-ink-2 hover:underline">{relDay(dateOf(pack.nextMeeting.starts_at))}, {fmtTime(pack.nextMeeting.starts_at)}</Link> — this pack is compiled live from the series.</> : "No upcoming meeting scheduled for this series."}
        actions={<>
          <CopyText text={packText(pack)} variant="secondary" />
          {manager && <ReviewFormButton variant="ghost" options={opts} initial={{ id: r.id, name: r.name, cadence: r.cadence, module: r.module ?? "general", description: r.description ?? "", ownerId: r.owner_id, momOwnerId: r.mom_owner_id, programId: r.program_id, projectId: r.project_id, calendarMatch: r.calendar_match ?? "", active: r.active }} />}
        </>} />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader icon={<ListChecks size={15} />} title="Previous actions"
              subtitle={`${pack.actions.overdue.length} overdue · ${pack.actions.open.length} open · ${pack.actions.closed.length} closed${pack.meetings.length > 1 ? " since the previous meeting" : ""}`} />
            {pack.actions.overdue.length + pack.actions.open.length + pack.actions.closed.length === 0
              ? <p className="px-4 py-6 text-[13px] text-ink-3">No actions from this series yet. Actions accepted from a MoM appear here automatically.</p>
              : (
                <div>
                  {pack.actions.overdue.length > 0 && <><div className="bg-bad-soft/40 px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-bad">Overdue</div><TaskList tasks={pack.actions.overdue} /></>}
                  {pack.actions.open.length > 0 && <><div className="bg-subtle/60 px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Open</div><TaskList tasks={pack.actions.open} /></>}
                  {pack.actions.closed.length > 0 && <><div className="bg-subtle/60 px-4 py-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Closed</div><TaskList tasks={pack.actions.closed} /></>}
                </div>
              )}
          </Card>

          {pack.aop && (
            <Card>
              <CardHeader icon={<Target size={15} />} title={`Budget vs actual — ${fmtMonth(pack.aop.period)}`} subtitle="Like-for-like on lines with actuals; last closed month" action={<ButtonLink href="/aop" size="xs" variant="ghost">Open AOP</ButtonLink>} />
              {pack.aop.kpis.length ? (
                <table className="table-base">
                  <thead><tr><th>Function</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">Missing actuals</th></tr></thead>
                  <tbody>
                    {pack.aop.kpis.map((k) => {
                      const v = k.plan ? (k.actual - k.plan) / k.plan : null;
                      return (
                        <tr key={k.name}>
                          <td className="font-medium text-ink">{k.name}</td>
                          <td className="text-right tabular text-ink-2">{inr(k.plan)}</td>
                          <td className="text-right tabular text-ink">{k.actual ? inr(k.actual) : "—"}</td>
                          <td className={cn("text-right tabular", v == null ? "text-ink-4" : v > 0.05 ? "font-medium text-bad" : v > 0 ? "text-warn" : "text-ok")}>{v == null ? (k.actual > 0 ? <span className="text-warn">Unbudgeted</span> : "—") : pct(v, 1, true)}</td>
                          <td className={cn("text-right tabular", k.missing ? "text-warn" : "text-ink-4")}>{k.missing ? `${k.missing} of ${k.lines}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="px-4 py-6 text-[13px] text-ink-3">No budget lines for {fmtMonth(pack.aop.period)}.</p>}
              {pack.aop.deviations.length > 0 && (
                <div className="border-t border-line px-4 py-3">
                  <div className="eyebrow mb-2">Deviations &gt; 5% over budget</div>
                  <ul className="space-y-1 text-[13px]">
                    {pack.aop.deviations.map((d) => (
                      <li key={d.section + d.item} className="flex items-center gap-2"><span className="size-1 shrink-0 rounded-full bg-bad" /><span className="min-w-0 flex-1 truncate text-ink-2"><span className="text-ink-3">{d.section} · </span>{d.item}</span><span className="tabular font-medium text-bad">{inr(d.variance, { sign: true })}</span><span className="w-14 text-right text-[12px] tabular text-ink-3">{pct(d.variance / d.plan, 0, true)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {pack.sop && (
            <Card>
              <CardHeader icon={<TrendingUp size={15} />} title={`Projection inputs — ${fmtMonth(pack.sop.period)}`}
                subtitle={`${pack.sop.submissions.filter((s) => s.status === "submitted" || s.status === "not_required").length}/${pack.sop.submissions.length} submitted`} action={<ButtonLink href="/sop" size="xs" variant="ghost">Open S&amp;OP</ButtonLink>} />
              <ul className="divide-y divide-line/70">
                {pack.sop.submissions.map((s) => {
                  const late = (s.status === "pending" && s.due_date && s.due_date < td) || s.status === "late";
                  return (
                    <li key={s.name} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                      <span className="text-ink-3">{s.owner_name ?? "—"}</span>
                      <span className="w-24 text-right text-[12px] tabular text-ink-3">due {fmtDate(s.due_date)}</span>
                      <Badge tone={s.status === "submitted" ? "green" : late ? "red" : s.status === "not_required" ? "muted" : "amber"}>{s.status === "submitted" ? "Submitted" : late ? "Late" : s.status === "not_required" ? "Not required" : "Pending"}</Badge>
                    </li>
                  );
                })}
                {!pack.sop.submissions.length && <li className="px-4 py-6 text-[13px] text-ink-3">No submissions set up for {fmtMonth(pack.sop.period)}.</li>}
              </ul>
              {pack.sop.accuracy.some((a) => a.projection) && (
                <div className="border-t border-line">
                  <div className="eyebrow px-4 pt-3">Projection accuracy — {fmtMonth(pack.sop.accuracyPeriod)}</div>
                  <table className="table-base">
                    <thead><tr><th>Stream</th><th className="text-right">Projection</th><th className="text-right">Actual</th><th className="text-right">Deviation</th></tr></thead>
                    <tbody>
                      {pack.sop.accuracy.filter((a) => a.projection).map((a) => {
                        const d = (a.actual - a.projection) / a.projection;
                        return <tr key={a.stream}><td className="text-ink">{a.stream}</td><td className="text-right tabular text-ink-2">{num(a.projection)}</td><td className="text-right tabular">{num(a.actual)}</td><td className={cn("text-right tabular", Math.abs(d) > 0.2 ? "font-medium text-bad" : Math.abs(d) > 0.1 ? "text-warn" : "text-ok")}>{pct(d, 0, true)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {pack.projects.length > 0 && (
            <section>
              <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Projects in scope</div>
              <ProjectTable projects={pack.projects} />
            </section>
          )}

          <Card>
            <CardHeader icon={<Gavel size={15} />} title={pack.decisions.length ? `${plural(pack.decisions.length, "unresolved decision")}` : "Unresolved decisions"} action={<ButtonLink href="/decisions?status=pending" size="xs" variant="ghost">Decision log</ButtonLink>} />
            {pack.decisions.length ? (
              <ul className="divide-y divide-line/70">
                {pack.decisions.map((d) => (
                  <li key={d.id}><Link href={`/decisions?focus=${d.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-subtle/60">
                    <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                    {d.maker_name && <span className="flex items-center gap-1 text-[12px] text-ink-3"><Avatar name={d.maker_name} color={d.maker_color} size={16} />{d.maker_name}</span>}
                    <span className={cn("w-20 shrink-0 text-right text-[12px] tabular", d.due_date && d.due_date < td ? "font-medium text-bad" : "text-ink-3")}>{d.due_date ? relDay(d.due_date) : "—"}</span>
                  </Link></li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-[13px] text-ink-3">Nothing waiting on a decision.</p>}
          </Card>

          <Card>
            <CardHeader icon={<ShieldAlert size={15} />} title="Risks" action={<ButtonLink href="/risks" size="xs" variant="ghost">Risk register</ButtonLink>} />
            {pack.risks.length ? (
              <ul className="divide-y divide-line/70">
                {pack.risks.map((rk) => {
                  const lvl = RISK_LEVEL(rk.score);
                  return (
                    <li key={rk.id}><Link href={`/risks?focus=${rk.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-subtle/60">
                      <Badge tone={lvl.tone}>{rk.score}</Badge>
                      <span className="min-w-0 flex-1 truncate text-ink">{rk.title}</span>
                      {rk.status === "escalated" && <Badge tone="red" dot>Escalated</Badge>}
                      <span className="text-[12px] text-ink-3">{rk.owner_name ?? "—"}</span>
                    </Link></li>
                  );
                })}
              </ul>
            ) : <p className="px-4 py-6 text-[13px] text-ink-3">No open risks in this review’s scope.</p>}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <Prop label="Owner"><span className="flex items-center gap-1.5"><Avatar name={r.owner_name} color={r.owner_color} size={20} />{r.owner_name ?? "—"}</span></Prop>
            <Prop label="MoM owner"><MomOwnerPicker reviewId={r.id} value={r.mom_owner_id} name={r.mom_owner_name} color={r.mom_owner_color} people={opts.people} disabled={!manager} /></Prop>
            <Prop label="Cadence"><span className="capitalize">{r.cadence === "adhoc" ? "Ad hoc" : r.cadence}</span></Prop>
            {r.calendar_match && <Prop label="Calendar match"><span className="font-mono text-[12px]">“{r.calendar_match}”</span></Prop>}
            {r.program_id && <Prop label="Program"><Link href={`/programs/${r.program_id}`} className="hover:underline">{r.program_name}</Link></Prop>}
            {r.project_id && <Prop label="Project"><Link href={`/projects/${r.project_id}`} className="hover:underline">{r.project_name}</Link></Prop>}
            {r.description && <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-3">{r.description}</p>}
          </Card>

          <Card className="p-4">
            <div className="eyebrow mb-2 flex items-center gap-1.5"><CalendarClock size={12} />Last meeting</div>
            {last ? (
              <div className="text-[13px]">
                <Link href={`/meetings/${last.id}`} className="font-medium text-ink hover:underline">{fmtDate(dateOf(last.starts_at), { dow: true })}</Link>
                <div className="mt-1.5 flex items-center gap-2">{lastMs && <Badge tone={lastMs.tone as Tone}>{lastMs.label}</Badge>}<span className="text-[12px] text-ink-3">{last.mom_owner_name ?? ""}</span></div>
              </div>
            ) : <p className="text-[13px] text-ink-3">No meetings held yet.</p>}
            {pack.meetings.length > 1 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px]">
                {pack.meetings.slice(0, 6).map((m) => {
                  const s = MOM_STATUS[m.mom_status as keyof typeof MOM_STATUS];
                  return <li key={m.id}><Link href={`/meetings/${m.id}`} className="flex justify-between gap-2 text-ink-2 hover:text-ink"><span>{fmtDate(dateOf(m.starts_at))}</span><span className={cn(s?.tone === "amber" ? "text-warn" : s?.tone === "green" ? "text-ok" : "text-ink-3")}>{new Date(m.starts_at).getTime() > Date.now() ? "Upcoming" : s?.label}</span></Link></li>;
                })}
              </ul>
            )}
          </Card>

          {(pack.projectUpdates.length > 0 || pack.aop) && (
            <Card className="p-4">
              <div className="eyebrow mb-2 flex items-center gap-1.5"><Users size={12} />Updates</div>
              {pack.aop && (() => {
                const subs = pack.aop.submissions; const pend = subs.filter((s) => s.status === "pending");
                return (
                  <div className="mb-3 text-[13px]">
                    <div className="text-ink-2">{fmtMonth(pack.aop.period)} actuals: <span className="font-medium">{subs.length - pend.length}/{subs.length}</span> received</div>
                    {pend.map((s) => <div key={s.name} className="mt-0.5 flex justify-between text-[12.5px]"><span className="text-ink-3">{s.name}</span><span className="text-warn">{s.owner_name ?? "—"}</span></div>)}
                  </div>
                );
              })()}
              {pack.projectUpdates.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[13px] text-ink-2">Project updates: <span className="font-medium">{pack.projectUpdates.length - staleUpdates.length}/{pack.projectUpdates.length}</span> this week</div>
                  {pack.projectUpdates.map((u) => (
                    <div key={u.project.id} className="flex items-center gap-2 text-[12.5px]">
                      <Link href={`/projects/${u.project.id}?tab=updates`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">{u.project.code ?? u.project.name}</Link>
                      <HealthBadge health={u.project.health} />
                      {u.days != null && u.days < 7 ? <span className="w-14 text-right text-ok">{u.days === 0 ? "today" : `${u.days}d ago`}</span>
                        : <span className="w-14 text-right text-warn">{u.days == null ? "none" : `${u.days}d ago`}</span>}
                    </div>
                  ))}
                  {staleUpdates.length > 0 && staleUpdates[0].project.owner_id !== user.id && (
                    <div className="pt-1"><RequestUpdateButton projectId={staleUpdates[0].project.id} ownerName={staleUpdates[0].project.owner_name} size="xs" /></div>
                  )}
                </div>
              )}
            </Card>
          )}
          {!pack.aop && !pack.sop && !pack.projects.length && (
            <Card><EmptyState compact title="No KPIs for this review" body="Link a program or project, or pick the AOP / S&OP pack, to compile KPIs automatically." /></Card>
          )}
        </aside>
      </div>
    </div>
  );
}
