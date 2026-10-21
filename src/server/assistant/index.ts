import "server-only";
import { q } from "../db";
import { aiConfigured, aiText } from "../ai/provider";
import { addDays, dateOf, fmtDate, fmtMonth, fmtTime, today } from "@/lib/dates";
import { inr, pct, plural } from "@/lib/format";
import {
  aopState, meetingsOn, meetingsWithoutMom, milestoneSlips, momsToReview, openFollowups, openRisks, overdueTasks, pendingDecisions, projectsAtRisk,
  scopeFor, sopDueSoon, sopLateInputs, staleDelegated, type Scope,
} from "../insights/signals";
import { morningBrief } from "../reports/brief";
import { monthLong, withTimeout } from "../reports/util";

export interface AssistantLink { label: string; href: string }
export interface AssistantAnswer { answer: string; links: AssistantLink[]; engine: "claude" | "rules" }
export interface HistoryMsg { role: string; text: string }

const STOP = new Set("what which when where who whom whose why how does did done have has had were was will would could should about regarding with from into that this those these there their them they your yours mine ours what's whats tell show give list summarise summarize decide decided decision decisions anything something today yesterday tomorrow week weekly please latest recent make made need needs required status update updates kind more some much many over under than then also just only been being same other each very the and for are any all our not can".split(" "));
const terms = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9&\s-]/g, " ").split(/\s+/).filter((w) => (w.length >= 3 && !STOP.has(w)) || /^(b2c|b2b|qc|nso|sop|aop|wh|cn|mhe|rfid)$/.test(w)))].slice(0, 6);

/* ---------------- keyword search across decisions / meetings / tasks / projects ---------------- */
async function search(words: string[]) {
  if (!words.length) return { decisions: [], meetings: [], tasks: [], projects: [] };
  const pats = words.map((w) => `%${w}%`);
  const [decisions, meetings, tasks, projects] = await Promise.all([
    q<{ id: string; title: string; status: string; decided_on: string | null; context: string | null; reason: string | null; meeting_id: string | null; meeting: string | null; project: string | null; maker: string | null }>(
      `select d.id, d.title, d.status, d.decided_on, d.context, d.reason, d.meeting_id, m.title as meeting, p.name as project, u.name as maker
       from decisions d left join meetings m on m.id = d.meeting_id left join projects p on p.id = d.project_id left join users u on u.id = d.decision_maker_id
       where (d.title || ' ' || coalesce(d.context,'') || ' ' || coalesce(d.reason,'') || ' ' || coalesce(p.name,'') || ' ' || coalesce(m.title,'')) ilike any($1::text[])
       order by coalesce(d.decided_on, d.created_at::date) desc limit 8`, [pats]),
    q<{ id: string; title: string; starts_at: string; summary: string | null; mom_status: string }>(
      `select m.id, m.title, m.starts_at, m.summary, m.mom_status from meetings m
       where not m.cancelled and (m.title || ' ' || coalesce(m.summary,'') || ' ' || coalesce(m.agenda,'') || ' ' ||
             coalesce((select string_agg(n.body, ' ') from meeting_notes n where n.meeting_id = m.id), '')) ilike any($1::text[])
       order by m.starts_at desc limit 6`, [pats]),
    q<{ id: string; number: number; title: string; status: string; due_date: string | null; owner: string | null }>(
      `select t.id, t.number, t.title, t.status, t.due_date, coalesce(u.name, tm.name) as owner from tasks t left join users u on u.id = t.owner_id left join teams tm on tm.id = t.owner_team_id
       where (t.title || ' ' || coalesce(t.description,'') || ' ' || coalesce(t.last_update_note,'')) ilike any($1::text[]) and t.status <> 'cancelled'
       order by (t.status in ('completed')), t.due_date nulls last limit 8`, [pats]),
    q<{ id: string; name: string; code: string | null; health: string; owner: string | null }>(
      `select p.id, p.name, p.code, p.health, u.name as owner from projects p left join users u on u.id = p.owner_id
       where (p.name || ' ' || coalesce(p.code,'') || ' ' || coalesce(p.objective,'')) ilike any($1::text[]) limit 5`, [pats]),
  ]);
  return { decisions, meetings, tasks, projects };
}

async function yesterdaysMeetings(s: Scope) {
  const y = addDays(today(), -1);
  const ms = await meetingsOn(s, y);
  if (!ms.length) return [];
  const ids = ms.map((m) => m.id);
  const [details, decisions, actions] = await Promise.all([
    q<{ id: string; summary: string | null; ai_summary: string | null }>(`select m.id, m.summary, (select n.ai_output->>'summary' from meeting_notes n where n.meeting_id = m.id order by n.updated_at desc limit 1) as ai_summary from meetings m where m.id = any($1::uuid[])`, [ids]),
    q<{ meeting_id: string; title: string }>(`select meeting_id, title from decisions where meeting_id = any($1::uuid[])`, [ids]),
    q<{ meeting_id: string; title: string; owner: string | null }>(`select t.meeting_id, t.title, u.name as owner from tasks t left join users u on u.id = t.owner_id where t.meeting_id = any($1::uuid[])`, [ids]),
  ]);
  return ms.map((m) => {
    const d = details.find((x) => x.id === m.id);
    return { ...m, summary: d?.summary ?? d?.ai_summary ?? null, decisions: decisions.filter((x) => x.meeting_id === m.id).map((x) => x.title), actions: actions.filter((x) => x.meeting_id === m.id) };
  });
}

/* ---------------- context snapshot for Claude ---------------- */
async function snapshot(s: Scope, question: string) {
  const t = today();
  const [mine, overdue, stale, meetings, noMom, review, atRisk, slips, aop, sopLate, sopSoon, risks, decisions, fus, found, yday] = await Promise.all([
    q<{ id: string; number: number; title: string; status: string; priority: string; due_date: string | null }>(
      `select id, number, title, status, priority, due_date from tasks where owner_id = $1 and status in ('not_started','in_progress','waiting','blocked') order by due_date nulls last limit 25`, [s.userId]),
    overdueTasks(s), staleDelegated(s), meetingsOn(s, t), meetingsWithoutMom(s), momsToReview(s), projectsAtRisk(s), milestoneSlips(s),
    s.manage ? aopState() : null, sopLateInputs(s), sopDueSoon(s, 21), openRisks(s, 5), pendingDecisions(s), openFollowups(s), search(terms(question)), yesterdaysMeetings(s),
  ]);
  return {
    today: t, user: { name: s.name, role: s.role, scope: s.manage ? "organisation" : "own work" },
    my_open_tasks: mine.map((x) => ({ ref: `CO-${x.number}`, href: `/tasks/${x.id}`, title: x.title, status: x.status, priority: x.priority, due: x.due_date })),
    overdue_tasks: overdue.slice(0, 20).map((x) => ({ ref: `CO-${x.number}`, href: `/tasks/${x.id}`, title: x.title, owner: x.owner_name ?? x.owner_team_name, days_overdue: x.days_overdue })),
    stale_delegated_tasks: stale.slice(0, 15).map((x) => ({ href: `/tasks/${x.id}`, title: x.title, owner: x.owner_name ?? x.owner_team_name, days_since_update: x.days_since_update })),
    todays_meetings: meetings.map((m) => ({ href: `/meetings/${m.id}`, title: m.title, time: fmtTime(m.starts_at), prep: m.prep_notes })),
    yesterdays_meetings: yday.map((m) => ({ href: `/meetings/${m.id}`, title: m.title, mom_status: m.mom_status, summary: m.summary, decisions: m.decisions, actions: m.actions.map((a) => `${a.title} (${a.owner ?? "—"})`) })),
    meetings_without_mom: noMom.map((m) => ({ href: `/meetings/${m.id}`, title: m.title, date: dateOf(m.starts_at), mom_owner: m.mom_owner_name })),
    moms_awaiting_review: review.map((m) => ({ href: `/meetings/${m.id}`, title: m.title, suggestions: m.open_suggestions })),
    projects_at_risk: atRisk.map((p) => ({ href: `/tasks/goals#project-${p.id}`, name: p.name, health: p.health, owner: p.owner_name, blocker: p.last_blockers, overdue_tasks: p.overdue_tasks })),
    milestone_slips: slips.map((m) => ({ href: `/tasks/goals#project-${m.project_id}`, project: m.project_code ?? m.project_name, milestone: m.title, slip_days: m.slip_days, overdue_days: m.overdue_days, owner: m.owner_name })),
    aop: aop?.cycle ? {
      href: "/aop", cycle: aop.cycle.name, last_closed_month: aop.lastClosed, fy_budget: Math.round(aop.totals.fy_plan), ytd_budget_reported_lines: Math.round(aop.totals.ytd_plan_reported), ytd_actual: Math.round(aop.totals.ytd_actual),
      missing_inputs: aop.missing.filter((m) => m.days_late > 0 || m.due_date === t).map((m) => ({ function: m.function_name, owner: m.owner_name, month: m.period, kind: m.kind, days_late: m.days_late })),
      top_overspends: aop.overspends.slice(0, 6).map((l) => ({ line: `${l.function_name} · ${l.item}`, month: l.period, budget: Math.round(l.plan), actual: Math.round(l.actual), variance_pct: Math.round((l.variance_pct ?? 0) * 1000) / 10, owner: l.owner_name })),
      top_savings: aop.savings.slice(0, 4).map((l) => ({ line: `${l.function_name} · ${l.item}`, month: l.period, variance: Math.round(l.variance) })),
      persistent_overspends: aop.streaks.map((g) => ({ group: `${g.function_name} ${g.group_name}`, months: g.months.map((m) => `${m.period}: ${(m.pct * 100).toFixed(1)}%`), owner: g.owner_name })),
    } : null,
    sop_late_inputs: sopLate.map((l) => ({ href: "/sop", stream: l.stream, month: l.period, poc: l.poc_name, days_late: l.days_late })),
    sop_inputs_due_soon: sopSoon.map((l) => ({ stream: l.stream, month: l.period, poc: l.poc_name, due: l.due_date })),
    open_risks: risks.map((r) => ({ title: r.title, score: r.score, owner: r.owner_name, status: r.status, mitigation: r.mitigation })),
    pending_decisions: decisions.map((d) => ({ title: d.title, due: d.due_date, days_overdue: d.days_overdue, maker: d.maker_name })),
    open_followups: fus.slice(0, 15).map((f) => ({ title: f.title ?? f.message, person: f.person_name, days_open: f.days_open })),
    search_results_for_question: {
      decisions: found.decisions.map((d) => ({ title: d.title, status: d.status, decided_on: d.decided_on, context: d.context, reason: d.reason, meeting: d.meeting, href: d.meeting_id ? `/meetings/${d.meeting_id}` : "/meetings" })),
      meetings: found.meetings.map((m) => ({ title: m.title, date: dateOf(m.starts_at), summary: m.summary, href: `/meetings/${m.id}` })),
      tasks: found.tasks.map((x) => ({ ref: `CO-${x.number}`, title: x.title, status: x.status, owner: x.owner, due: x.due_date, href: `/tasks/${x.id}` })),
      projects: found.projects.map((p) => ({ name: p.name, health: p.health, owner: p.owner, href: `/tasks/goals#project-${p.id}` })),
    },
  };
}

/* ---------------- rules engine ---------------- */
type R = { answer: string; links: AssistantLink[] };
const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

async function rules(s: Scope, question: string): Promise<R> {
  const qn = question.toLowerCase();
  const has = (...k: (string | RegExp)[]) => k.some((x) => (typeof x === "string" ? qn.includes(x) : x.test(qn)));

  if (has("weekly review", "week review", /weekly (report|summary)/, "create my weekly")) {
    const b = await morningBrief(s.userId);
    return { answer: `Your **Weekly Program Manager Review** is ready as a document — meetings attended, tasks created/closed, decisions, risks, wins, issues and next week's priorities.\n\nRight now: **${plural(b.counts.overdue, "overdue task")}**, **${plural(b.counts.projectsAtRisk, "project")} at risk**, **${plural(b.counts.decisionsPending, "decision")} pending**. Open it to copy as text, paste into WhatsApp or print to PDF.`, links: [{ label: "Weekly review", href: "/reports/weekly" }] };
  }
  if (has("yesterday")) {
    const ms = await yesterdaysMeetings(s);
    if (!ms.length) return { answer: "There were no meetings on your calendar yesterday.", links: [{ label: "Meetings", href: "/meetings" }] };
    const parts = ms.map((m) => {
      const lines = [`**${m.title}** (${fmtTime(m.starts_at)})`];
      if (m.summary) lines.push(m.summary);
      else lines.push(m.mom_status === "pending" || m.mom_status === "draft" ? `No MoM yet — ${m.mom_owner_name ?? "the MoM owner"} owes it.` : "No summary recorded.");
      if (m.decisions.length) lines.push(`Decisions: ${m.decisions.join("; ")}`);
      if (m.actions.length) lines.push(`Actions: ${m.actions.map((a) => `${a.title} (${a.owner ?? "—"})`).join("; ")}`);
      return lines.join("\n");
    });
    return { answer: parts.join("\n\n"), links: ms.map((m) => ({ label: m.title, href: `/meetings/${m.id}` })) };
  }
  if (has(/what (did )?we decide/, "decided", "decision on", "decision about", "decisions regarding", "decision regarding")) {
    const w = terms(question);
    const found = await search(w);
    if (!w.length || !found.decisions.length) {
      const recent = await q<{ title: string; decided_on: string | null }>(`select title, decided_on from decisions where status = 'made' order by decided_on desc nulls last limit 5`);
      return { answer: `${w.length ? `I couldn't find a recorded decision about **${w.join(" ")}**. ` : ""}Most recent decisions:\n\n${bullets(recent.map((d) => `${d.title} (${fmtDate(d.decided_on)})`))}`, links: [{ label: "Decision log", href: "/meetings" }] };
    }
    return {
      answer: `Here's what's on record about **${w.join(" ")}**:\n\n${bullets(found.decisions.map((d) => `**${d.title}** — ${d.status === "made" ? `decided ${fmtDate(d.decided_on)}` : d.status}${d.meeting ? ` in ${d.meeting}` : ""}${d.reason ? `. Why: ${d.reason}` : d.context ? `. Context: ${d.context}` : ""}`))}`,
      links: [...found.decisions.filter((d) => d.meeting_id).slice(0, 3).map((d) => ({ label: d.meeting ?? "Meeting", href: `/meetings/${d.meeting_id}` })), { label: "Decision log", href: "/meetings" }],
    };
  }
  if (has("aop") && has("updated", "submitted", "haven't", "havent", "missing", "pending", "input")) {
    const a = await aopState();
    const miss = a.missing.filter((m) => m.days_late > 0 || m.due_date === today());
    if (!miss.length) return { answer: "Every AOP owner is up to date — no actuals or projections are past their cut-off.", links: [{ label: "AOP", href: "/aop" }] };
    const by = new Map<string, typeof miss>();
    for (const m of miss) { const k = `${m.function_name}|${m.owner_name ?? "—"}`; by.set(k, [...(by.get(k) ?? []), m]); }
    return {
      answer: `**${plural(by.size, "function")}** ${by.size === 1 ? "has" : "have"} AOP inputs past the cut-off:\n\n${bullets([...by.entries()].map(([k, ms]) => { const [fn, owner] = k.split("|"); return `**${fn}** (${owner}) — ${ms.map((m) => `${monthLong(m.period)} ${m.kind}${m.days_late ? `, ${m.days_late}d late` : ", due today"}`).join("; ")}`; }))}\n\nActuals for ${monthLong(a.lastClosed)} are what the cost review needs first.`,
      links: [{ label: "AOP inputs", href: "/aop" }, { label: "Exceptions", href: "/exceptions#aop-missing" }],
    };
  }
  if (has("aop", "budget", "overspend", "deviation", "variance", "cost")) {
    const a = await aopState();
    if (!a.cycle) return { answer: "There's no active AOP cycle yet.", links: [{ label: "AOP", href: "/aop" }] };
    const v = a.totals.ytd_plan_reported ? (a.totals.ytd_actual - a.totals.ytd_plan_reported) / a.totals.ytd_plan_reported : 0;
    return {
      answer: `**${a.cycle.name}** — YTD actuals ${inr(a.totals.ytd_actual)} vs ${inr(a.totals.ytd_plan_reported)} budget on reported lines (**${pct(v, 1, true)}**), through ${monthLong(a.lastClosed)}.\n\n**Top deviations (latest reported month)**\n${bullets(a.overspends.slice(0, 5).map((l) => `${l.function_name} · ${l.item} — ${fmtMonth(l.period)} ${inr(l.actual)} vs ${inr(l.plan)} (**${pct(l.variance_pct, 0, true)}**)${l.owner_name ? `, ${l.owner_name}` : ""}`))}${a.streaks.length ? `\n\n**Persistent:** ${a.streaks.map((g) => `${g.function_name} ${g.group_name} over budget ${g.months.length} months running`).join("; ")}.` : ""}${a.savings.length ? `\n\nBiggest saving: ${a.savings[0].function_name} · ${a.savings[0].item} (${inr(a.savings[0].variance, { sign: true })}).` : ""}`,
      links: [{ label: "AOP", href: "/aop" }, { label: "AOP summary", href: "/aop" }],
    };
  }
  if (has("slipping", "slip", "at risk", "delayed", "behind")) {
    const [p, m] = await Promise.all([projectsAtRisk(s), milestoneSlips(s)]);
    if (!p.length && !m.length) return { answer: "Nothing is slipping — all active projects are on track and no milestone has moved past its threshold.", links: [{ label: "Projects", href: "/tasks/goals" }] };
    const msLine = (x: (typeof m)[number]) => [x.overdue_days ? `${x.overdue_days}d overdue` : null, x.slip_days ? `slipped ${x.slip_days}d vs baseline` : null].filter(Boolean).join(", ");
    return {
      answer: [
        p.length ? `**${plural(p.length, "project")} at risk or delayed:**\n${bullets(p.map((x) => `**${x.name}** — ${x.health === "delayed" ? "delayed" : "at risk"}, owner ${x.owner_name ?? "—"}${x.last_blockers ? `; blocker: ${x.last_blockers}` : ""}${x.overdue_tasks ? `; ${x.overdue_tasks} overdue tasks` : ""}`))}` : "",
        m.length ? `**Milestones that moved:**\n${bullets(m.map((x) => `${x.project_code ?? x.project_name}: ${x.title} — ${msLine(x)}`))}` : "",
      ].filter(Boolean).join("\n\n"),
      links: p.slice(0, 4).map((x) => ({ label: x.code ?? x.name, href: `/tasks/goals#project-${x.id}` })).concat([{ label: "Exceptions", href: "/exceptions#milestones" }]),
    };
  }
  if (has("follow up", "follow-up", "followup", "chase", "nudge")) {
    const [stale, fus, overdue] = await Promise.all([staleDelegated(s), openFollowups(s), overdueTasks(s)]);
    const waiting = new Set(fus.map((f) => f.entity_id));
    const chase = [...overdue.map((t) => ({ t, why: `${t.days_overdue}d overdue` })), ...stale.filter((t) => !overdue.some((o) => o.id === t.id)).map((t) => ({ t, why: `no update for ${t.days_since_update}d` }))];
    if (!chase.length && !fus.length) return { answer: "No one needs chasing today — delegated work is current.", links: [{ label: "Follow-ups", href: "/tasks/all?view=delegated" }] };
    return {
      answer: `**Follow up today (${chase.length}):**\n${bullets(chase.slice(0, 10).map(({ t, why }) => `${t.title} — ${t.owner_name ?? t.owner_team_name ?? "Unassigned"}, ${why}${waiting.has(t.id) ? " (already asked, no reply)" : ""}`))}${fus.length ? `\n\n**${plural(fus.length, "request")} still waiting for a reply**, oldest ${fus[0].days_open}d (${fus[0].person_name ?? "—"}).` : ""}`,
      links: [{ label: "Request updates", href: "/exceptions#stale" }, { label: "Follow-ups", href: "/tasks/all?view=delegated" }, ...chase.slice(0, 2).map(({ t }) => ({ label: `CO-${t.number}`, href: `/tasks/${t.id}` }))],
    };
  }
  if (has("s&op", "sop", "projection", "capacity")) {
    const [late, soon] = await Promise.all([sopLateInputs(s), sopDueSoon(s, 21)]);
    return {
      answer: `${late.length ? `**Late inputs:**\n${bullets(late.map((l) => `${l.stream} — ${fmtMonth(l.period)} projection, ${l.days_late}d late (${l.poc_name ?? "—"})`))}` : "No S&OP inputs are late."}${soon.length ? `\n\n**Due in the next 3 weeks:** ${soon.map((l) => `${l.stream} (${l.poc_name ?? "—"}, ${fmtDate(l.due_date)})`).join(", ")}.` : ""}`,
      links: [{ label: "S&OP", href: "/sop" }],
    };
  }
  if (has("risk")) {
    const rs = await openRisks(s, 0);
    return { answer: rs.length ? `**${plural(rs.length, "open risk")}**, highest first:\n${bullets(rs.slice(0, 8).map((r) => `${r.title} — score ${r.score}, ${r.owner_name ?? "—"}${r.mitigation ? `; mitigation: ${r.mitigation}` : "; no mitigation"}`))}` : "No open risks.", links: [{ label: "Risks", href: "/risks" }, { label: "Risk report", href: "/reports/risks" }] };
  }
  if (has("attention", "today", "priorit", "focus", "morning", "brief", "what should i")) {
    const b = await morningBrief(s.userId);
    const c = b.counts;
    return {
      answer: `${b.greeting}. **${plural(c.meetings, "meeting")} today**, ${plural(c.overdue, "overdue task")}, ${plural(c.momPending, "MoM")} pending, ${plural(c.decisionsPending, "decision")} waiting.\n\n**Priorities**\n${b.priorities.map((p) => `- **${p.rank}. ${p.title}** — ${p.detail}`).join("\n") || "- Nothing urgent."}`,
      links: b.priorities.slice(0, 4).map((p) => ({ label: p.title.length > 38 ? `${p.title.slice(0, 36)}…` : p.title, href: p.href })),
    };
  }
  // generic: keyword search
  const w = terms(question);
  const f = await search(w);
  const n = f.decisions.length + f.meetings.length + f.tasks.length + f.projects.length;
  if (!n)
    return { answer: `I couldn't find anything in Central Ops about **${w.join(" ") || question}**. Try asking:\n\n${bullets(["What requires my attention today?", "Which projects are slipping?", "What did we decide about Bluedart?", "Which owners haven't updated AOP?", "Top AOP deviations", "Summarise yesterday's meetings"])}`, links: [] };
  const out: string[] = [`Here's what I found for **${w.join(" ")}**:`];
  if (f.projects.length) out.push(`**Projects**\n${bullets(f.projects.map((p) => `${p.name} — ${p.health.replace("_", " ")}, ${p.owner ?? "—"}`))}`);
  if (f.decisions.length) out.push(`**Decisions**\n${bullets(f.decisions.map((d) => `${d.title} (${d.status === "made" ? fmtDate(d.decided_on) : d.status})`))}`);
  if (f.tasks.length) out.push(`**Tasks**\n${bullets(f.tasks.map((t) => `CO-${t.number} ${t.title} — ${t.owner ?? "—"}, ${t.status.replace("_", " ")}`))}`);
  if (f.meetings.length) out.push(`**Meetings**\n${bullets(f.meetings.map((m) => `${m.title} (${fmtDate(dateOf(m.starts_at))})`))}`);
  return {
    answer: out.join("\n\n"),
    links: [...f.projects.slice(0, 2).map((p) => ({ label: p.code ?? p.name, href: `/tasks/goals#project-${p.id}` })), ...f.tasks.slice(0, 2).map((t) => ({ label: `CO-${t.number}`, href: `/tasks/${t.id}` })), ...f.meetings.slice(0, 2).map((m) => ({ label: m.title, href: `/meetings/${m.id}` }))],
  };
}

const SYSTEM = `You are the Central Ops assistant for the Program Manager of Central Operations at Snitch (Indian menswear retailer).
Answer ONLY from the JSON snapshot of Central Ops data you are given. Rules:
- Never invent tasks, numbers, names, dates or decisions. If the data doesn't contain the answer, say so plainly and suggest where to look.
- Cite the specific items you rely on (task refs like CO-123, meeting titles, project names, AOP lines).
- Be brief and decisive: lead with the answer, then at most ~8 bullets. Use **bold** for key items, '- ' bullets, short paragraphs. No headings, no tables.
- Money is INR; write ₹ with Indian units (L = lakh, Cr = crore). Dates like 'Oct 7'.
- When asked what to do, rank by urgency (overdue, cut-offs today, critical items first).`;

/** Answer a question grounded in Central Ops data. Claude when configured; rules otherwise (and as fallback). */
export async function answer(userId: string, question: string, history: HistoryMsg[] = []): Promise<AssistantAnswer> {
  const s = await scopeFor(userId);
  const r = await rules(s, question);
  if (!aiConfigured()) return { ...r, engine: "rules" };
  const ctx = await snapshot(s, question);
  const hist = history.slice(-6).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${String(h.text).slice(0, 1200)}`).join("\n");
  const text = await withTimeout(aiText({
    system: SYSTEM,
    prompt: `Central Ops data snapshot (JSON):\n${JSON.stringify(ctx)}\n\n${hist ? `Conversation so far:\n${hist}\n\n` : ""}Question: ${question}`,
    maxTokens: 1500,
  }), 25000);
  if (!text) return { ...r, engine: "rules" };
  const extra: AssistantLink[] = [];
  const scan = (title: string, href: string) => { if (title && text.includes(title) && !r.links.some((l) => l.href === href) && !extra.some((l) => l.href === href)) extra.push({ label: title.length > 40 ? `${title.slice(0, 38)}…` : title, href }); };
  for (const p of ctx.projects_at_risk) scan(p.name, p.href);
  for (const m of [...ctx.todays_meetings, ...ctx.yesterdays_meetings, ...ctx.meetings_without_mom]) scan(m.title, m.href);
  for (const t of [...ctx.overdue_tasks, ...ctx.my_open_tasks]) scan(t.title, t.href);
  return { answer: text, links: [...r.links, ...extra].slice(0, 6), engine: "claude" };
}
