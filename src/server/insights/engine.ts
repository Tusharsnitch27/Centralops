import "server-only";
import { createHash } from "node:crypto";
import { one, q } from "../db";
import { addDays, fmtDate, fmtMonth, relDay, today, weekStart } from "@/lib/dates";
import { plural } from "@/lib/format";
import {
  aopState, capacityBreaches, meetingsWithoutMom, milestoneSlips, pendingDecisions, projectsAtRisk, ruleNum, ruleOn, scopeFor, sopLateInputs, staleDelegated,
} from "./signals";
import { firstName, monthLong } from "../reports/util";

export type PrimaryAction = "task" | "review" | "request_updates" | "nudge";
export interface SuggestionPayload {
  primary: PrimaryAction;
  primaryLabel: string;
  ownerId?: string | null;
  ownerName?: string | null;
  taskTitle?: string;
  dueDate?: string;
  projectId?: string | null;
  taskIds?: string[];
  nudge?: { userId: string; kind: string; title: string; href: string }[];
}
interface Gen {
  kind: string; title: string; body: string; recommendation: string; entity_type?: string | null; entity_id?: string | null; href: string;
  severity: "info" | "warning" | "critical"; dedupe: string; payload: SuggestionPayload;
}
export interface Suggestion {
  id: string; kind: string; title: string; body: string | null; recommendation: string | null; entity_type: string | null; entity_id: string | null; href: string | null;
  severity: string; payload: SuggestionPayload; created_at: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const ymd = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? ""));

/** Rule-based generator across modules. Idempotent: dedupe keys make dismissals sticky; stale open suggestions are cleared. */
export async function generateSuggestions(userId: string): Promise<void> {
  const s = await scopeFor(userId);
  const t = today();
  const out: Gen[] = [];
  const [aop, sop, stale, slips, noMom, caps, decisions, atRisk] = await Promise.all([
    s.manage ? aopState() : null, sopLateInputs(s), staleDelegated(s), milestoneSlips(s), meetingsWithoutMom(s),
    s.manage ? capacityBreaches() : Promise.resolve([]), pendingDecisions(s), projectsAtRisk(s),
  ]);

  // AOP: persistent overspend → recovery plan with the owner
  if (aop?.cycle && (await ruleOn("aop.persistent"))) {
    for (const g of aop.streaks.slice(0, 4)) {
      const over = g.months.reduce((a, m) => a + (m.actual - m.plan), 0);
      const last = g.months.at(-1)!;
      out.push({
        kind: "aop_overspend", severity: "critical", href: "/aop", entity_type: "aop_section", entity_id: g.section_id,
        title: `${g.function_name} ${g.group_name} spend over budget ${g.months.length} months running`,
        body: `${g.months.map((m) => `${fmtMonth(m.period, false)} ${m.pct > 0 ? "+" : ""}${(m.pct * 100).toFixed(1)}%`).join(", ")} — about ₹${(over / 1e5).toFixed(1)} L over in total.`,
        recommendation: `Create a recovery plan with ${firstName(g.owner_name)}`,
        dedupe: `aop.persistent:${g.section_id}:${last.period}`,
        payload: { primary: "task", primaryLabel: `Create recovery plan with ${firstName(g.owner_name)}`, ownerId: g.owner_id, ownerName: g.owner_name,
          taskTitle: `Recovery plan: ${g.function_name} ${g.group_name} spend (${g.months.length} months over budget)`, dueDate: addDays(t, 5) },
      });
    }
  }
  // AOP: missing actuals for the last closed month → nudge the owners
  if (aop?.cycle && (await ruleOn("aop.missing_actuals"))) {
    const miss = aop.missing.filter((m) => m.kind === "actuals" && m.period === aop.lastClosed);
    if (miss.length) {
      const owners = [...new Map(miss.filter((m) => m.owner_id && m.owner_id !== s.userId).map((m) => [m.owner_id!, m])).values()];
      out.push({
        kind: "aop_missing", severity: miss.some((m) => m.days_late > 0) ? "critical" : "warning", href: "/aop",
        title: `${plural(miss.length, "function")} ${miss.length === 1 ? "hasn't" : "haven't"} submitted ${monthLong(aop.lastClosed)} actuals`,
        body: `${miss.map((m) => `${m.function_name} (${m.owner_name ?? "—"})`).join(", ")}. ${miss[0].due_date ? `Cut-off ${relDay(miss[0].due_date).toLowerCase()}.` : ""}`,
        recommendation: owners.length ? `Nudge ${owners.map((o) => firstName(o.owner_name)).join(", ")} before the cost review` : "Submit them before the cost review",
        dedupe: `aop.missing:${aop.lastClosed}:${hash(miss.map((m) => m.section_id).sort().join())}`,
        payload: owners.length ? { primary: "nudge", primaryLabel: `Nudge ${owners.length === 1 ? firstName(owners[0].owner_name) : plural(owners.length, "owner")}`,
          nudge: owners.map((o) => ({ userId: o.owner_id!, kind: "aop_input", title: `${monthLong(aop.lastClosed)} actuals needed for ${o.function_name}`, href: "/aop" })) }
          : { primary: "task", primaryLabel: "Add a task to submit them", ownerId: s.userId, taskTitle: `Submit ${monthLong(aop.lastClosed)} AOP actuals`, dueDate: t },
      });
    }
  }
  // S&OP: late projection inputs → escalate to the POC
  if (await ruleOn("sop.late_input")) {
    const byStream = new Map<string, (typeof sop)[number]>();
    for (const l of sop) if (!byStream.has(l.stream_id)) byStream.set(l.stream_id, l);
    for (const l of byStream.values()) {
      const name = l.stream.replace(/-Category Wise/i, "");
      out.push({
        kind: "sop_late", severity: l.late_count > 1 || l.days_late > 7 ? "critical" : "warning", href: "/sop", entity_type: "sop_stream", entity_id: l.stream_id,
        title: `${name} projections late${l.late_count > 1 ? ` for ${l.late_count} months` : ""}`,
        body: `${fmtMonth(l.period)} projection was due ${fmtDate(l.due_date)} — ${plural(l.days_late, "day")} late. Capacity planning for that month is running on fallback ratios.`,
        recommendation: `Escalate to ${firstName(l.poc_name)}`,
        dedupe: `sop.late:${l.stream_id}:${l.period}`,
        payload: { primary: "task", primaryLabel: `Escalate to ${firstName(l.poc_name)}`, ownerId: l.poc_id, ownerName: l.poc_name,
          taskTitle: `Submit ${name.toLowerCase()} projections for ${fmtMonth(l.period)} (overdue)`, dueDate: addDays(t, 1) },
      });
    }
  }
  // Tasks: delegated work without updates → request updates in one go
  if (stale.length && (await ruleOn("tasks.no_update"))) {
    const days = await ruleNum("tasks.no_update", "threshold", 5);
    const owners = [...new Set(stale.map((x) => x.owner_name ?? x.owner_team_name).filter(Boolean))];
    out.push({
      kind: "stale_tasks", severity: stale.length >= 5 ? "warning" : "info", href: "/exceptions#stale",
      title: `${plural(stale.length, "delegated task")} ${stale.length === 1 ? "has" : "have"} no update in ${days}+ days`,
      body: `${stale.slice(0, 3).map((x) => `“${x.title}” (${x.owner_name ?? x.owner_team_name}, ${x.days_since_update}d)`).join("; ")}${stale.length > 3 ? ` and ${stale.length - 3} more` : ""}. Owners: ${owners.join(", ")}.`,
      recommendation: "Request updates from the owners",
      dedupe: `tasks.stale:${hash(stale.map((x) => x.id).sort().join())}`,
      payload: { primary: "request_updates", primaryLabel: `Request ${plural(stale.length, "update")}`, taskIds: stale.map((x) => x.id) },
    });
  }
  // Projects: slipped / overdue milestones → review with the project owner
  if (await ruleOn("projects.milestone_slip")) {
    for (const m of slips.slice(0, 4)) {
      const code = m.project_code ?? m.project_name;
      const what = m.slip_days > 0 ? `slipped ${plural(m.slip_days, "day")}` : `overdue by ${plural(m.overdue_days, "day")}`;
      out.push({
        kind: "milestone_slip", severity: m.overdue_days > 0 ? "critical" : "warning", href: `/projects/${m.project_id}`, entity_type: "milestone", entity_id: m.id,
        title: `${m.title.toLowerCase().includes(code.toLowerCase()) ? m.title : `${code} · ${m.title}`} ${what}`,
        body: `Baseline ${fmtDate(m.baseline_date)}, now due ${fmtDate(m.due_date)}${m.overdue_days > 0 ? ` and ${plural(m.overdue_days, "day")} past due` : ""}. ${m.project_name}.`,
        recommendation: `Review with ${firstName(m.owner_name)}`,
        dedupe: `ms.slip:${m.id}:${m.due_date}`,
        payload: { primary: "review", primaryLabel: `Review with ${firstName(m.owner_name)}`, ownerId: m.owner_id, ownerName: m.owner_name, projectId: m.project_id,
          taskTitle: `Recovery plan for ${code}: ${m.title}`, dueDate: addDays(t, 2) },
      });
    }
  }
  // Meetings: no MoM after the meeting → nudge the MoM owner
  for (const m of noMom.filter((x) => x.overdue || Date.now() - new Date(ymd(x.ends_at ?? x.starts_at)).getTime() > 6 * 3600_000).slice(0, 4)) {
    const when = relDay(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ymd(m.starts_at)))).toLowerCase();
    const mine = m.mom_owner_id === s.userId;
    out.push({
      kind: "mom_missing", severity: m.overdue ? "warning" : "info", href: `/meetings/${m.id}`, entity_type: "meeting", entity_id: m.id,
      title: `${m.title} ${when} has no MoM`,
      body: `${mine ? "You're" : `${m.mom_owner_name ?? "The MoM owner"} is`} the MoM owner${m.overdue ? "; it's past the 24-hour window" : ""}. Actions from this meeting aren't tracked until it's written.`,
      recommendation: mine ? "Write the MoM now" : `Nudge ${firstName(m.mom_owner_name)}`,
      dedupe: `mom.missing:${m.id}`,
      payload: mine || !m.mom_owner_id
        ? { primary: "task", primaryLabel: "Add a task to write it", ownerId: s.userId, taskTitle: `Write MoM: ${m.title}`, dueDate: t }
        : { primary: "nudge", primaryLabel: `Nudge ${firstName(m.mom_owner_name)}`, nudge: [{ userId: m.mom_owner_id, kind: "mom_pending", title: `MoM pending: ${m.title}`, href: `/meetings/${m.id}` }] },
    });
  }
  // S&OP capacity breach → review with the warehousing lead
  if (caps.length && (await ruleOn("sop.capacity_breach"))) {
    const lead = await one<{ id: string; name: string }>(`select u.id, u.name from teams t join users u on u.id = t.lead_id where t.name ilike 'warehous%' limit 1`);
    for (const c of caps.filter((x) => x.departments >= 2).slice(0, 2)) {
      out.push({
        kind: "capacity", severity: "critical", href: "/sop", entity_type: null,
        title: `${c.warehouse} warehouse short of capacity in ${fmtMonth(c.period)} across ${plural(c.departments, "department")}`,
        body: `Worst gap: ${c.worst_department} (${Math.round(c.worst_gap).toLocaleString("en-IN")} units/day). Required ${Math.round(c.required).toLocaleString("en-IN")} vs available ${Math.round(c.available).toLocaleString("en-IN")}.`,
        recommendation: `Review the ramp-up plan with ${firstName(lead?.name)}`,
        dedupe: `cap:${c.period}:${c.warehouse}`,
        payload: { primary: "review", primaryLabel: `Review with ${firstName(lead?.name)}`, ownerId: lead?.id ?? null, ownerName: lead?.name ?? null,
          taskTitle: `Capacity plan for ${c.warehouse} — ${fmtMonth(c.period)}`, dueDate: addDays(t, 3) },
      });
    }
  }
  // Decisions past due
  for (const d of decisions.filter((x) => x.days_overdue > 0).slice(0, 3))
    out.push({
      kind: "decision_due", severity: "warning", href: "/decisions", entity_type: "decision", entity_id: d.id,
      title: `Decision overdue: ${d.title}`, body: `Was due ${fmtDate(d.due_date)}${d.project_name ? ` · ${d.project_name}` : ""}.`,
      recommendation: `Schedule a decision review${d.maker_name ? ` with ${firstName(d.maker_name)}` : ""}`, dedupe: `decision:${d.id}:${d.due_date}`,
      payload: { primary: "review", primaryLabel: "Schedule decision review", ownerId: d.maker_id, ownerName: d.maker_name },
    });
  // At-risk projects without a recent update
  const wk = weekStart(t);
  for (const p of atRisk.filter((x) => !x.last_update_at || Date.now() - new Date(ymd(x.last_update_at)).getTime() > 7 * 864e5).slice(0, 3))
    out.push({
      kind: "project_update", severity: "info", href: `/projects/${p.id}`, entity_type: "project", entity_id: p.id,
      title: `${p.name} is ${p.health === "delayed" ? "delayed" : "at risk"} with no update in a week`, body: `Owner ${p.owner_name ?? "—"} · ${p.open_tasks} open tasks${p.overdue_tasks ? `, ${p.overdue_tasks} overdue` : ""}.`,
      recommendation: `Ask ${firstName(p.owner_name)} for a status update`, dedupe: `project.noupdate:${p.id}:${wk}`,
      payload: { primary: "nudge", primaryLabel: `Ask ${firstName(p.owner_name)} for an update`, nudge: p.owner_id ? [{ userId: p.owner_id, kind: "update_missing", title: `Status update needed: ${p.name}`, href: `/projects/${p.id}` }] : [] },
    });

  for (const g of out) {
    await q(
      `insert into ai_suggestions (user_id, kind, title, body, recommendation, entity_type, entity_id, href, severity, payload, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (user_id, dedupe_key) do update set title = excluded.title, body = excluded.body, recommendation = excluded.recommendation, href = excluded.href,
         severity = excluded.severity, payload = excluded.payload, updated_at = now() where ai_suggestions.status = 'open'`,
      [userId, g.kind, g.title, g.body, g.recommendation, g.entity_type ?? null, g.entity_id ?? null, g.href, g.severity, JSON.stringify(g.payload), g.dedupe]);
  }
  // conditions that no longer hold: drop untouched open suggestions
  await q(`delete from ai_suggestions where user_id = $1 and status = 'open' and not (dedupe_key = any($2::text[]))`, [userId, out.map((g) => g.dedupe)]);
}

const SEV_ORDER = `array_position(array['critical','warning','info'], severity)`;

/** Open suggestions for a user, most severe first. */
export async function listSuggestions(userId: string, limit = 20): Promise<Suggestion[]> {
  return q<Suggestion>(
    `select id, kind, title, body, recommendation, entity_type, entity_id, href, severity, payload, created_at from ai_suggestions
     where user_id = $1 and status = 'open' order by ${SEV_ORDER}, created_at desc limit $2`, [userId, limit]);
}

export async function recentlyHandled(userId: string, limit = 6) {
  return q<{ id: string; title: string; status: string; resolved_at: string | null }>(
    `select id, title, status, coalesce(resolved_at, updated_at) as resolved_at from ai_suggestions where user_id = $1 and status <> 'open' order by coalesce(resolved_at, updated_at) desc limit $2`, [userId, limit]);
}
