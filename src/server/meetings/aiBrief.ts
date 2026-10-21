import "server-only";
import { one, q } from "../db";
import { aiText } from "../ai/provider";
import { getMeeting, getMeetingBrief } from "./queries";
import { dateOf, fmtDate, today } from "@/lib/dates";

/**
 * Pre-meeting brief: what is still open from the last meeting of the series, what the attendees have overdue or blocked,
 * and what this meeting needs to decide — written by Claude, or put together from rules when AI isn't configured.
 * Kept on the meeting (ai_brief) until refreshed.
 */
export async function buildMeetingBrief(meetingId: string) {
  const m = await getMeeting(meetingId);
  if (!m) throw new Error("Meeting not found");
  const td = today();
  const ids = m.attendees.map((a) => a.user_id).filter((x): x is string => !!x);
  const [series, overdue, blockers, goals] = await Promise.all([
    getMeetingBrief(m),
    ids.length ? q<{ number: number; title: string; owner: string | null; due_date: string; goal: string | null }>(
      `select t.number, t.title, u.name as owner, t.due_date::text, g.title as goal from tasks t left join users u on u.id = t.owner_id left join goals g on g.id = t.goal_id
       where t.status not in ('completed','cancelled') and t.due_date < $2 and (t.owner_id = any($1::uuid[]) or exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = any($1::uuid[])))
       order by t.due_date limit 15`, [ids, td]) : Promise.resolve([]),
    ids.length ? q<{ number: number; title: string; body: string; on_name: string | null; raised: string }>(
      `select t.number, t.title, b.body, coalesce(u.name, b.on_label) as on_name, b.created_at::date::text as raised from task_blockers b join tasks t on t.id = b.task_id left join users u on u.id = b.on_user_id
       where b.status = 'open' and (b.on_user_id = any($1::uuid[]) or t.owner_id = any($1::uuid[])) order by b.created_at limit 10`, [ids]) : Promise.resolve([]),
    q<{ title: string; status: string; target_date: string | null }>(`select title, status, target_date::text from goals where status in ('at_risk','off_track') order by target_date nulls last limit 5`),
  ]);
  const openPrev = (series?.actions ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const carried = series?.carried ?? [];
  const facts = [
    `Meeting: ${m.title} on ${fmtDate(dateOf(m.starts_at), { dow: true })}. Attendees: ${m.attendees.map((a) => a.name).join(", ") || "—"}.`,
    m.agenda ? `Agenda: ${m.agenda}` : "", m.prep_notes ? `Prep notes: ${m.prep_notes}` : "",
    series?.previous ? `Last meeting (${dateOf(series.previous.starts_at)}) summary: ${series.previous.summary ?? "—"}` : "No earlier meeting in this series.",
    series?.closure.total ? `Last meeting's actions: ${series.closure.completed}/${series.closure.total} closed, ${series.closure.overdue} overdue.` : "",
    openPrev.length ? `Still open from last time:\n${openPrev.map((t) => `- CO-${t.number} ${t.title} — ${t.owner_name ?? "unassigned"}${t.due_date ? `, due ${t.due_date}` : ""}${t.status === "blocked" ? " (blocked)" : ""}`).join("\n")}` : "",
    carried.length ? `Older open actions from this series:\n${carried.slice(0, 8).map((t) => `- CO-${t.number} ${t.title} — ${t.owner_name ?? "unassigned"}${t.due_date ? `, due ${t.due_date}` : ""}`).join("\n")}` : "",
    series?.decisions.length ? `Decisions last time:\n${series.decisions.map((d) => `- ${d.title}`).join("\n")}` : "",
    overdue.length ? `Attendees' overdue tasks:\n${overdue.map((t) => `- CO-${t.number} ${t.title} — ${t.owner ?? "—"}, due ${t.due_date}${t.goal ? ` (goal: ${t.goal})` : ""}`).join("\n")}` : "",
    blockers.length ? `Open blockers:\n${blockers.map((b) => `- CO-${b.number} ${b.title}: ${b.body}${b.on_name ? ` — on ${b.on_name}` : ""} (since ${b.raised})`).join("\n")}` : "",
    series?.risks.length ? `Open risks:\n${series.risks.map((r) => `- ${r.title} (score ${r.score})${r.owner_name ? ` — ${r.owner_name}` : ""}`).join("\n")}` : "",
    goals.length ? `Goals at risk:\n${goals.map((g) => `- ${g.title} (${g.status.replace("_", " ")}${g.target_date ? `, target ${g.target_date}` : ""})`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const ai = await Promise.race([
    aiText({
      system: "You are the program manager's chief of staff at Snitch Central Operations. Write a crisp pre-meeting brief in Markdown, max ~180 words, " +
        "with exactly these sections: **Where we are** (2 lines), **Chase** (bullets: person — item — how late; most overdue first, max 6), " +
        "**To decide** (bullets: decisions or unblocks this meeting should take, max 4), **Suggested agenda** (numbered, max 5). " +
        "Use only the facts given; never invent numbers, owners or dates. Refer to tasks as CO-<number>. If there is nothing for a section, write 'Nothing pending'.",
      prompt: facts, effort: "low", maxTokens: 1500,
    }),
    new Promise<null>((r) => setTimeout(() => r(null), 30_000)),
  ]);
  const text = ai ?? rulesBrief(openPrev.map((t) => ({ who: t.owner_name, title: `CO-${t.number} ${t.title}`, due: t.due_date })), overdue.map((t) => ({ who: t.owner, title: `CO-${t.number} ${t.title}`, due: t.due_date })), blockers, series?.closure ?? null, td);
  await q(`update meetings set ai_brief = $2, ai_brief_engine = $3, ai_brief_at = now() where id = $1`, [meetingId, text, ai ? "claude" : "rules"]);
  return { text, engine: ai ? "claude" : "rules" };
}

function rulesBrief(prev: { who: string | null; title: string; due: string | null }[], overdue: { who: string | null; title: string; due: string | null }[],
  blockers: { number: number; title: string; body: string; on_name: string | null }[], closure: { total: number; completed: number; overdue: number } | null, td: string) {
  const late = (d: string | null) => (d && d < td ? ` — ${Math.round((Date.parse(td) - Date.parse(d)) / 86400000)}d late` : "");
  const chase = [...overdue, ...prev.filter((p) => !overdue.some((o) => o.title === p.title))].slice(0, 6);
  return [
    "**Where we are**",
    closure?.total ? `${closure.completed} of ${closure.total} actions from last time are closed; ${closure.overdue} overdue.` : "No actions carried from an earlier meeting.",
    "", "**Chase**",
    ...(chase.length ? chase.map((c) => `- ${c.who ?? "Unassigned"} — ${c.title}${late(c.due)}`) : ["- Nothing pending"]),
    "", "**To decide**",
    ...(blockers.length ? blockers.slice(0, 4).map((b) => `- Unblock CO-${b.number} ${b.title}: ${b.body}${b.on_name ? ` (on ${b.on_name})` : ""}`) : ["- Nothing pending"]),
    "", "**Suggested agenda**",
    "1. Last meeting's open actions", ...(blockers.length ? ["2. Blockers to clear"] : []), `${blockers.length ? 3 : 2}. Updates and new actions`,
  ].join("\n");
}

export async function storedBrief(meetingId: string) {
  return one<{ ai_brief: string | null; ai_brief_engine: string | null; ai_brief_at: string | null }>(
    `select ai_brief, ai_brief_engine, ai_brief_at::text from meetings where id = $1`, [meetingId]);
}
