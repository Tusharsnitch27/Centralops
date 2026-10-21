import "server-only";
import { z } from "zod";
import { aiStructured } from "../ai/provider";
import { listPeople, listProjectsLite, listTeams, matchPerson, matchTeam } from "../core/people";
import { goalOptions, projectOptions } from "../goals/queries";
import { addDays, today, weekStart } from "@/lib/dates";
import type { Priority } from "@/lib/meta";

/**
 * MoM → structured suggestions (actions, decisions, risks, follow-ups) for the PM to review.
 * Claude when configured; otherwise (or on failure) a rule-based parser that handles the way people actually write MoMs:
 * bullets, "X to <verb> … by <date>", "Decision:/Decided/Agreed", "Risk:", "Action:", "Next steps:", relative dates.
 */

export interface ExtractCtx {
  meetingDate: string;              // IST 'YYYY-MM-DD' — relative dates ("by Friday") resolve from here
  meetingTitle?: string;
  attendees?: string[];
  projectId?: string | null;
  programId?: string | null;
  defaultOwnerId?: string | null;   // used for follow-ups with no clear owner (usually the PM)
  defaultOwnerName?: string | null;
}

export type SuggestionKind = "action" | "decision" | "risk" | "followup";
export interface SuggestionPayload {
  title: string;
  owner_id?: string | null;
  owner_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  waiting_on_id?: string | null;
  waiting_on_name?: string | null;
  due_date?: string | null;
  due_note?: string | null;
  priority?: Priority;
  project_id?: string | null;
  dependency?: string | null;
  depends_on?: string | null;       // another suggestion id in the same meeting
  context?: string | null;
  decision_maker?: string | null;
  decision_maker_id?: string | null;
  probability?: number;
  impact?: number;
  mitigation?: string | null;
  // task structure: the goal the action serves, people working on it with the owner, and what it is blocked on
  goal_id?: string | null;
  assignee_ids?: string[];
  assignee_names?: string[];        // named in the minutes but not matched to the directory
  blocker?: string | null;
  blocker_on_id?: string | null;
  blocker_on_name?: string | null;
}
export interface ExtractResult {
  engine: "claude" | "rules";
  summary: string;
  discussion: string[];
  suggestions: { kind: SuggestionKind; payload: SuggestionPayload }[];
}

/* ---------------- AI ---------------- */

const priorityZ = z.enum(["urgent", "high", "medium", "low"]);
const MomSchema = z.object({
  summary: z.string().describe("2–3 sentence executive summary of the meeting"),
  discussion: z.array(z.string()).describe("Key discussion points, short phrases"),
  decisions: z.array(z.object({ title: z.string(), context: z.string().nullable(), decision_maker_name: z.string().nullable() })),
  actions: z.array(z.object({
    title: z.string().describe("Imperative, specific, ≤ 12 words"),
    owner_name: z.string().nullable(),
    team_name: z.string().nullable().describe("Team when the action is owned by a team rather than a person"),
    due_date: z.string().nullable().describe("YYYY-MM-DD or null"),
    priority: priorityZ,
    project_hint: z.string().nullable().describe("Exact project name from the list, only when the action clearly belongs to it"),
    goal_hint: z.string().nullable().describe("Exact goal title from the list, only when the action clearly moves that goal"),
    co_owner_names: z.array(z.string()).describe("Other people named as working on it with the owner (not the owner)"),
    blocker: z.string().nullable().describe("What the action is stuck on, if the minutes say it is blocked / waiting"),
    blocker_on_name: z.string().nullable().describe("Person or function it is blocked on"),
    dependency: z.string().nullable(),
  })),
  risks: z.array(z.object({
    title: z.string(), owner_name: z.string().nullable(),
    probability: z.number().int().min(1).max(5), impact: z.number().int().min(1).max(5), mitigation: z.string().nullable(),
  })),
  followups: z.array(z.object({ title: z.string(), person_name: z.string().nullable(), due_date: z.string().nullable() })),
});
type MomAI = z.infer<typeof MomSchema>;

async function extractWithAI(text: string, ctx: ExtractCtx): Promise<MomAI | null> {
  const [people, teams, projects, goals] = await Promise.all([listPeople(), listTeams(), projectOptions(), goalOptions()]);
  const prompt = [
    `Today is ${today()} (IST). The meeting "${ctx.meetingTitle ?? "Meeting"}" happened on ${ctx.meetingDate}. Resolve relative dates ("by Friday", "next Wednesday", "by 25th", "this week", "EOD") from the meeting date.`,
    ctx.attendees?.length ? `Attendees: ${ctx.attendees.join(", ")}` : "",
    `People (use these exact names for owners): ${people.map((p) => `${p.name}${p.team_name ? ` (${p.team_name})` : ""}`).join("; ")}`,
    `Teams: ${teams.map((t) => t.name).join("; ")}`,
    `Goals: ${goals.map((g) => g.title).join("; ") || "none"}`,
    `Projects: ${projects.map((p) => `${p.name}${p.goal_id ? ` (goal: ${goals.find((g) => g.id === p.goal_id)?.title ?? "—"})` : ""}`).join("; ") || "none"}`,
    "",
    "Minutes of meeting:",
    "<<<",
    text.slice(0, 24000),
    ">>>",
  ].filter(Boolean).join("\n");
  return aiStructured({
    system:
      "You are the program management office of Snitch (Indian menswear retailer), Central Operations. Extract a precise, de-duplicated set of " +
      "action items, decisions, risks and follow-ups from meeting minutes. Only include what the minutes actually say — never invent owners or dates. " +
      "Actions are concrete deliverables with an owner (a person, or a team when no individual is named); list everyone else named on it as co-owners, " +
      "link it to a goal / project from the lists only when the minutes make the link clear, and record a blocker when the minutes say it is stuck or waiting on someone. " +
      "Follow-ups are things someone is waiting on " +
      "from another person/function (confirmations, approvals, inputs). Decisions are things that were agreed. Risks are threats to plan/timeline/cost.",
    prompt,
    tool: { name: "record_mom", description: "Record the structured extraction of the minutes" },
    schema: MomSchema,
  });
}

/* ---------------- dates ---------------- */

const DOWS: [RegExp, number][] = [
  [/^sun/i, 0], [/^mon/i, 1], [/^tue/i, 2], [/^wed/i, 3], [/^thu/i, 4], [/^fri/i, 5], [/^sat/i, 6],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const dowIdx = (w: string) => DOWS.find(([rx]) => rx.test(w))?.[1] ?? 5;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const lastOfMonth = (d: string) => { const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };
/** Friday of the working week a date belongs to (weekends roll to the coming week). */
const fridayOf = (d: string) => { const dow = dowOf(d); const base = dow === 0 || dow === 6 ? addDays(weekStart(d), 7) : weekStart(d); return addDays(base, 4); };

const DOW_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DOW_ANY = `${DOW_FULL}|mon|tues?|wed|thurs?|thu|fri|sat|sun`;
const MON_RX = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const PRE = "(?:by|before|on|due|till|until|latest by|no later than)";

/** Find a due-date phrase in text. Returns the ISO date and the text with the phrase removed. */
export function findDue(text: string, ref: string): { date: string | null; rest: string } {
  const rules: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => (validIso(m[1]) ? m[1] : null)],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:tomorrow|tmrw|tmr)\\b`, "i"), () => addDays(ref, 1)],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:end of (?:the )?week|eow|this week|week[- ]end)\\b`, "i"), () => fridayOf(ref)],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:end of next week|next week)\\b`, "i"), () => addDays(fridayOf(ref), 7)],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:end of (?:the )?month|eom|month[- ]end)\\b`, "i"), () => lastOfMonth(ref)],
    [/\bin\s+(\d{1,3})\s+(days?|weeks?)\b/i, (m) => addDays(ref, Number(m[1]) * (m[2].toLowerCase().startsWith("week") ? 7 : 1))],
    [new RegExp(`(?:${PRE}\\s+)?\\bnext\\s+(${DOW_ANY})\\b`, "i"), (m) => {
      const ws = dowOf(ref) === 0 ? addDays(weekStart(ref), 7) : weekStart(ref); // a Sunday's "next X" is the coming week
      const nextMon = addDays(ws, 7);
      return addDays(nextMon, (dowIdx(m[1]) + 6) % 7);
    }],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON_RX})[a-z]*\\b`, "i"), (m) => monthDay(Number(m[1]), m[2], ref)],
    [new RegExp(`(?:${PRE}\\s+)?\\b(${MON_RX})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"), (m) => monthDay(Number(m[2]), m[1], ref)],
    [new RegExp(`${PRE}\\s+(?:the\\s+)?(\\d{1,2})(st|nd|rd|th)\\b`, "i"), (m) => {
      const d = Number(m[1]); if (d < 1 || d > 31) return null;
      let y = Number(ref.slice(0, 4)), mo = Number(ref.slice(5, 7));
      if (d < Number(ref.slice(8, 10))) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      return iso(y, mo, Math.min(d, Number(lastOfMonth(iso(y, mo, 1)).slice(8))));
    }],
    [new RegExp(`(?:${PRE}\\s+)?\\b(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?\\b`), (m) => {
      const d = Number(m[1]), mo = Number(m[2]); if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(ref.slice(0, 4));
      let out = iso(y, mo, d);
      if (!m[3] && out < ref) { y += 1; out = iso(y, mo, d); }
      return out;
    }],
    [new RegExp(`(?:${PRE}|this|coming)\\s+(${DOW_ANY})\\b|\\b(${DOW_FULL})\\b`, "i"), (m) => {
      const target = dowIdx(m[1] ?? m[2]);
      return addDays(ref, (target - dowOf(ref) + 7) % 7);
    }],
    [new RegExp(`(?:${PRE}\\s+)?\\b(?:eod|end of (?:the )?day|today|tonight)\\b`, "i"), () => ref],
  ];
  for (const [rx, fn] of rules) {
    const m = text.match(rx);
    if (!m) continue;
    const date = fn(m);
    if (!date) continue;
    const rest = (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).replace(/\b(?:by\s+)?(?:eod|cob|eow)\b/gi, " ").replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
    return { date, rest };
  }
  return { date: null, rest: text };
}
function monthDay(day: number, mon: string, ref: string) {
  const mi = MONTHS.indexOf(mon.toLowerCase().slice(0, 3));
  if (mi < 0 || day < 1 || day > 31) return null;
  let y = Number(ref.slice(0, 4));
  let out = iso(y, mi + 1, day);
  // "15 Jan" said in October means next January
  if (out < addDays(ref, -60)) { y += 1; out = iso(y, mi + 1, day); }
  return out;
}

/** No back-dating: past dates move to today, with a note the PM sees on the suggestion. */
export function clampDue(d: string | null | undefined): { due: string | null; note: string | null } {
  if (!d || !validIso(d)) return { due: null, note: null };
  const t = today();
  return d < t ? { due: t, note: `Suggested ${d} was in the past — moved to today` } : { due: d, note: null };
}

/* ---------------- rule-based parser ---------------- */

type Section = "agenda" | "attendees" | "notes" | "discussion" | "decisions" | "actions" | "blockers" | "risks" | "followups" | "summary" | "followup_date" | null;
const SECTION_MAP: [RegExp, Section][] = [
  [/^agenda$/i, "agenda"], [/^(attendees|participants|present)$/i, "attendees"], [/^(notes|minutes|mom)$/i, "notes"],
  [/^(discussion|discussion points|key points|highlights|updates)$/i, "discussion"], [/^(decisions?|key decisions|decisions made|agreed)$/i, "decisions"],
  [/^(action items?|actions?|next steps|to-?dos?|tasks|owners? & actions)$/i, "actions"], [/^(blockers?|issues|blockers? (?:&|and) risks?)$/i, "blockers"],
  [/^(risks?|risks? & issues|risks and issues|concerns)$/i, "risks"], [/^(follow[- ]?ups?|pending inputs?|waiting on)$/i, "followups"],
  [/^(summary|tl;?dr)$/i, "summary"], [/^(follow[- ]?up date|next review|next meeting)$/i, "followup_date"],
];
function sectionOf(h: string): Section | undefined {
  const k = h.replace(/^#{1,4}\s*/, "").replace(/[:\-–—]\s*$/, "").replace(/\*+/g, "").trim();
  for (const [rx, s] of SECTION_MAP) if (rx.test(k)) return s;
  return undefined;
}
const stripBullet = (l: string) => l.replace(/^\s*(?:[-*•·▪◦‣>]+|\d{1,2}[.)]|[a-z][.)]|\[[ xX]?\])\s*/, "").replace(/\*\*/g, "").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tidy = (s: string) => cap(s.replace(/\s{2,}/g, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").replace(/\.$/, "").trim()).slice(0, 160);

const OWNER_RX = /^@?([A-Z][A-Za-z.'’]+(?:\s(?:&|and)\s[A-Z][A-Za-z.'’]+)?(?:\s[A-Z][A-Za-z.'’]+)?(?:\s(?:team|Team|ops|Ops))?)\s+(?:to|will|should|must|needs? to|has to|is to|owns?|→|->)\s+(.+)$/;
const DASH_OWNER_RX = /^@?([A-Z][A-Za-z.'’]+(?:\s[A-Z][A-Za-z.'’]+)?)\s*[:\-–—]\s+(.+)$/;
const TRAIL_OWNER_RX = /\s*(?:[-–—]\s*|\(\s*(?:owner:?\s*)?)@?([A-Z][A-Za-z.'’]+)\)?\s*$/;
const MENTION_RX = /@([A-Za-z][\w.]*)/;
const FOLLOW_RX = /^(?:need|needs|awaiting|waiting (?:on|for)|pending|get|chase)\s+(confirmation|input|inputs|approval|sign[- ]?off|response|update|numbers|data|clarity|go-ahead)\s+(?:from|with)\s+(?:the\s+)?([A-Za-z&][\w&.' -]*?)\s+(?:on|for|regarding|about|re)\s+(.+)$/i;
const RISK_WORDS = /\b(slips?|slipping|slipped|delay(?:ed|s)?|at risk|shortage|breach(?:es)?|could (?:delay|impact|affect|hit)|may (?:delay|impact|slip|breach)|risk of)\b/i;

interface RawAction { title: string; owner_name: string | null; due_date: string | null; priority: Priority; dependency: string | null; project_hint: string | null; goal_hint?: string | null; co_owner_names?: string[]; blocker?: string | null; blocker_on_name?: string | null }
interface RawExtraction {
  summary: string; discussion: string[];
  decisions: { title: string; context: string | null; decision_maker_name: string | null }[];
  actions: RawAction[];
  risks: { title: string; owner_name: string | null; probability: number; impact: number; mitigation: string | null }[];
  followups: { title: string; person_name: string | null; due_date: string | null }[];
}

function priorityOf(text: string, due: string | null, ref: string): Priority {
  if (/\b(urgent|asap|critical|immediately|p0|top priority)\b/i.test(text)) return "urgent";
  if (/\b(high priority|important|escalate|blocker|p1)\b/i.test(text)) return "high";
  if (due && due <= addDays(ref, 2)) return "high";
  return "medium";
}
function dependencyOf(text: string): { dep: string | null; rest: string } {
  const m = text.match(/[,;]?\s*\b(?:after|once|depends on|dependent on|subject to|pending)\s+([^,;.]+)/i);
  if (!m || (m.index ?? 0) < 8) return { dep: null, rest: text };
  return { dep: tidy(m[1]), rest: text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length) };
}

async function isKnownOwner(name: string) {
  return Boolean((await matchPerson(name)) ?? (await matchTeam(name)));
}

export async function ruleExtract(text: string, ctx: ExtractCtx): Promise<RawExtraction> {
  const ref = ctx.meetingDate;
  const out: RawExtraction = { summary: "", discussion: [], decisions: [], actions: [], risks: [], followups: [] };
  let section: Section = null;
  const narrative: string[] = [];

  const lines = text.replace(/\r/g, "").split("\n");
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    // section headings — "Actions", "## Decisions", "Next steps:" or "Next steps: Nitin to …"
    const head = line.match(/^(?:#{1,4}\s*)?\**([A-Za-z][A-Za-z &/;-]{1,30}?)\**\s*:\s*(.*)$/) ?? line.match(/^(?:#{1,4}\s*)?\**([A-Za-z][A-Za-z &/;-]{1,30}?)\**\s*$/);
    if (head) {
      const name = head[1].trim();
      const s = sectionOf(name);
      const rest = (head[2] ?? "").trim();
      if (s !== undefined && !(rest && /^(decision|risk|action|follow[- ]?up|blocker|issue)$/i.test(name))) {
        section = s;
        if (!rest) continue;
        line = rest;
      }
    }
    if (section === "attendees") continue;
    if (/^.{0,60}\b(attendees|participants|present)\b\s*[:\-–—]?\s/i.test(line) && !OWNER_RX.test(stripBullet(line))) continue;
    if (section === "followup_date") continue;
    if (section === "agenda") continue;
    const body = stripBullet(line);
    if (!body || body.length < 4) continue;

    // explicit prefixes
    let m: RegExpMatchArray | null;
    if ((m = body.match(/^(?:decision|decided|agreed|resolved)\s*[:\-–—]\s*(.+)$/i))) { addDecision(m[1], null); continue; }
    if ((m = body.match(/^(?:risk|issue|concern|blocker)s?\s*[:\-–—]\s*(.+)$/i))) { addRisk(m[1], section === "blockers"); continue; }
    if ((m = body.match(/^(?:action|todo|to-do|ai|task)\s*[:\-–—]\s*(.+)$/i))) { await addAction(m[1], true); continue; }
    if ((m = body.match(/^(?:follow[- ]?up|fu)\s*[:\-–—]\s*(.+)$/i))) { addFollowup(m[1], null); continue; }
    if ((m = body.match(/^(?:(?:we|the team|team|it was|all|everyone)\s+)?(?:([A-Za-z]+)\s+)?(?:decided|agreed|aligned|concluded)\s+(?:to|that|on)\s+(.+)$/i))) {
      const maker = m[1] && /^[A-Z]/.test(m[1]) && (await matchPerson(m[1])) ? m[1] : null;
      addDecision(m[2], maker); continue;
    }

    if (section === "decisions") { addDecision(body, null); continue; }
    if (section === "risks" || section === "blockers") { addRisk(body, section === "blockers"); continue; }

    if ((m = body.match(FOLLOW_RX))) {
      addFollowup(`Get ${m[1].toLowerCase()} from ${m[2].trim()} on ${m[3]}`, m[2].trim());
      continue;
    }
    if (section === "followups") { addFollowup(body, null); continue; }

    const om = body.match(OWNER_RX);
    if (om && (section === "actions" || (await isKnownOwner(om[1].split(/\s(?:&|and)\s/)[0])))) { await addAction(body, section === "actions"); continue; }
    if (section === "actions") { await addAction(body, true); continue; }
    if (MENTION_RX.test(body)) { await addAction(body, true); continue; }
    const inl = body.match(/\s[—–-]\s+([A-Z][A-Za-z.'’]+)\s+(?:to|will|should|must)\s+(.+)$/);
    if (inl && (await isKnownOwner(inl[1]))) {
      const ctxText = body.slice(0, inl.index).trim();
      narrative.push(`${ctxText.replace(/[.;]$/, "")}.`);
      const act = inl[2].replace(/\.$/, "");
      await addAction(`${inl[1]} to ${/\b(this|it)\b/i.test(act) && ctxText.length < 90 ? `${act} (${ctxText})` : act}`, false); continue;
    }

    // a decision / risk sentence buried mid-paragraph
    const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentences.length > 1) {
      let used = false;
      const restS: string[] = [];
      for (const sen of sentences) {
        const dm = sen.match(/^(?:(?:we|the team|team|it was|all|everyone)\s+)?(?:([A-Za-z]+)\s+)?(?:decided|agreed|aligned|concluded)\s+(?:to|that|on)\s+(.+)$/i);
        const rm = sen.match(/^(?:risk|concern)\s*[:\-–—]\s*(.+)$/i);
        if (dm) { addDecision(dm[2].replace(/\.$/, ""), null); used = true; }
        else if (rm) { addRisk(rm[1], false); used = true; }
        else restS.push(sen);
      }
      if (used) { if (restS.length) narrative.push(restS.join(" ")); continue; }
    }
    // narrative: risk-y clauses become risks, the rest is discussion
    if (RISK_WORDS.test(body) && (section === null || section === "notes" || section === "discussion")) {
      const topic = body.match(/^([^:]{3,40}):\s+/)?.[1] ?? null;
      const clauses = body.replace(/^([^:]{3,40}):\s+/, "").split(/(?<=[.;])\s+|;\s*/).map((c) => c.replace(/[.;]$/, "").trim()).filter(Boolean);
      const hit = clauses.find((c) => RISK_WORDS.test(c));
      if (hit) {
        const mit = clauses.find((c) => c !== hit && /\b(need(?:ed|s)?|required|to be done|recalibrat|escalat|plan)\b/i.test(c)) ?? null;
        out.risks.push({ title: tidy(topic ? `${topic}: ${hit}` : hit), owner_name: null, probability: 3, impact: /\b(peak|diwali|go-live|launch|sla)\b/i.test(body) ? 4 : 3, mitigation: mit ? tidy(mit) : null });
      }
      narrative.push(body);
      continue;
    }
    narrative.push(body);
  }

  out.discussion = narrative.map((n) => tidy(n.split(/(?<=\.)\s+/)[0])).filter((n) => n.length > 6).slice(0, 8);
  const sumSrc = narrative.length ? narrative.slice(0, 3).join(" ") : "";
  const counts = [`${out.actions.length} action${out.actions.length === 1 ? "" : "s"}`, `${out.decisions.length} decision${out.decisions.length === 1 ? "" : "s"}`, `${out.risks.length} risk${out.risks.length === 1 ? "" : "s"}`];
  out.summary = sumSrc ? (sumSrc.length > 360 ? `${sumSrc.slice(0, 357).replace(/\s\S*$/, "")}…` : sumSrc) : `MoM recorded with ${counts.join(", ")}.`;
  return out;

  function addDecision(t: string, maker: string | null) {
    const [main, ...why] = t.split(/,?\s+(?:since|because|as|given that)\s+/i);
    out.decisions.push({ title: tidy(main.replace(/^(?:to|that)\s+/i, "")), context: why.length ? tidy(why.join(" ")) : null, decision_maker_name: maker });
  }
  function addRisk(t: string, isBlocker: boolean) {
    const [main, ...rest] = t.split(/\s*(?:;|\. )\s*(?:mitigation|plan|mitigate)\s*[:\-–—]?\s*/i);
    const high = /\b(critical|severe|major|peak|diwali|sla|go-live)\b/i.test(t);
    out.risks.push({ title: tidy(main), owner_name: t.match(MENTION_RX)?.[1] ?? null, probability: isBlocker ? 4 : /\b(likely|will)\b/i.test(t) ? 4 : 3, impact: high ? 4 : 3, mitigation: rest.length ? tidy(rest.join(" ")) : null });
  }
  function addFollowup(t: string, person: string | null) {
    const { date, rest } = findDue(t, ref);
    out.followups.push({ title: tidy(rest), person_name: person, due_date: date });
  }
  async function addAction(t: string, _inActions: boolean) {
    let s = t;
    let owner: string | null = null;
    const om = s.match(OWNER_RX);
    if (om) { owner = om[1]; s = om[2]; }
    else {
      const mm = s.match(MENTION_RX);
      if (mm) { owner = mm[1]; s = s.replace(MENTION_RX, " "); }
      else {
        const dm = s.match(DASH_OWNER_RX);
        if (dm && (await isKnownOwner(dm[1]))) { owner = dm[1]; s = dm[2]; }
        else {
          const tm = s.match(TRAIL_OWNER_RX);
          if (tm && (await isKnownOwner(tm[1]))) { owner = tm[1]; s = s.slice(0, tm.index); }
        }
      }
    }
    const { date, rest } = findDue(s, ref);
    const { dep, rest: rest2 } = dependencyOf(rest);
    const title = tidy(rest2.replace(/\b(?:by|before|on|due)\s*$/i, ""));
    if (!title) return;
    out.actions.push({ title, owner_name: owner, due_date: date, priority: priorityOf(t, date, ref), dependency: dep, project_hint: null });
  }
}

/* ---------------- resolve names → suggestion payloads ---------------- */

async function matchProject(hint: string | null | undefined, fallback: string | null | undefined) {
  if (!hint) return fallback ?? null;
  const h = hint.toLowerCase();
  const projects = await listProjectsLite();
  return projects.find((p) => p.code?.toLowerCase() === h || p.name.toLowerCase() === h)?.id
    ?? projects.find((p) => p.name.toLowerCase().includes(h) || (p.code && h.includes(p.code.toLowerCase())))?.id
    ?? fallback ?? null;
}

async function toSuggestions(r: RawExtraction, ctx: ExtractCtx): Promise<ExtractResult["suggestions"]> {
  const out: ExtractResult["suggestions"] = [];
  const projects = await listProjectsLite();
  const projectFromText = (t: string) => projects.find((p) => p.code && new RegExp(`\\b${p.code}\\b`).test(t))?.id;

  const [goals, projOpts] = await Promise.all([goalOptions(), projectOptions()]);
  const matchGoal = (hint: string | null | undefined) => {
    if (!hint) return null;
    const h = hint.toLowerCase().trim();
    return goals.find((g) => g.title.toLowerCase() === h)?.id ?? goals.find((g) => g.title.toLowerCase().includes(h) || h.includes(g.title.toLowerCase()))?.id ?? null;
  };
  for (const a of r.actions) {
    // "Iqbal & Malhar to …": the first name owns it, the rest work on it with them
    const names = (a.owner_name ?? "").split(/\s*(?:&|,|\band\b)\s*/).filter(Boolean);
    const person = await matchPerson(names[0]);
    const team = person ? null : await matchTeam(a.owner_name);
    const { due, note } = clampDue(a.due_date);
    const projectId = (await matchProject(a.project_hint, null)) ?? projectFromText(a.title) ?? ctx.projectId ?? null;
    const others = [...new Set([...(person ? names.slice(1) : []), ...(a.co_owner_names ?? [])])];
    const assignees: string[] = [], unmatched: string[] = [];
    for (const n of others) { const x = await matchPerson(n); if (x && x.id !== person?.id) assignees.push(x.id); else if (!x) unmatched.push(n); }
    // rules engine: "… blocked on / waiting on Iqbal" in the line itself
    const bm = !a.blocker ? a.title.match(/\b(?:blocked|stuck|waiting)\s+(?:on|by|for)\s+([A-Z][\w.]*(?:\s[A-Z][\w.]*)?)/) : null;
    if (bm) { a.blocker = bm[0]; a.blocker_on_name = bm[1]; }
    const blockerOn = a.blocker_on_name ? await matchPerson(a.blocker_on_name) : null;
    out.push({ kind: "action", payload: {
      title: a.title, owner_id: person?.id ?? null, owner_name: person?.name ?? (team ? null : a.owner_name), team_id: team?.id ?? null, team_name: team?.name ?? null,
      due_date: due, due_note: note, priority: a.priority, project_id: projectId,
      // goal: named in the minutes, else the goal its project serves
      goal_id: matchGoal(a.goal_hint) ?? projOpts.find((p) => p.id === projectId)?.goal_id ?? null,
      assignee_ids: [...new Set(assignees)], assignee_names: unmatched,
      blocker: a.blocker ?? null, blocker_on_id: blockerOn?.id ?? null, blocker_on_name: blockerOn?.name ?? a.blocker_on_name ?? null,
      dependency: a.dependency,
    } });
  }
  for (const f of r.followups) {
    const who = (await matchPerson(f.person_name)) ?? null;
    const team = who ? null : await matchTeam(f.person_name);
    const { due, note } = clampDue(f.due_date ?? addDays(today(), 2));
    out.push({ kind: "followup", payload: {
      title: f.title, owner_id: ctx.defaultOwnerId ?? null, owner_name: ctx.defaultOwnerName ?? null,
      waiting_on_id: who?.id ?? null, waiting_on_name: who?.name ?? team?.name ?? f.person_name ?? null, team_id: null,
      due_date: due, due_note: note, priority: "high", project_id: projectFromText(f.title) ?? ctx.projectId ?? null,
    } });
  }
  for (const d of r.decisions) {
    const maker = await matchPerson(d.decision_maker_name);
    out.push({ kind: "decision", payload: { title: d.title, context: d.context, decision_maker: maker?.name ?? d.decision_maker_name ?? null, decision_maker_id: maker?.id ?? null, project_id: ctx.projectId ?? null } });
  }
  for (const k of r.risks) {
    const owner = await matchPerson(k.owner_name);
    out.push({ kind: "risk", payload: {
      title: k.title, owner_id: owner?.id ?? null, owner_name: owner?.name ?? k.owner_name ?? null,
      probability: Math.max(1, Math.min(5, Math.round(k.probability || 3))), impact: Math.max(1, Math.min(5, Math.round(k.impact || 3))),
      mitigation: k.mitigation, project_id: ctx.projectId ?? null,
    } });
  }
  return out;
}

/** Extract structured suggestions from MoM text. Claude first; rule-based fallback always available. */
export async function extractMom(text: string, ctx: ExtractCtx): Promise<ExtractResult> {
  const body = text.trim();
  if (!body) return { engine: "rules", summary: "", discussion: [], suggestions: [] };
  // a slow / unreachable provider must not stall the MoM submit — fall back to rules after 40s
  const ai = await Promise.race([
    extractWithAI(body, ctx).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), Number(process.env.MOM_AI_TIMEOUT_MS ?? 40_000))),
  ]);
  if (ai && (ai.actions.length || ai.decisions.length || ai.risks.length || ai.followups.length || ai.summary)) {
    const raw: RawExtraction = {
      summary: ai.summary, discussion: ai.discussion,
      decisions: ai.decisions,
      actions: ai.actions.map((a) => ({ title: a.title, owner_name: a.owner_name ?? a.team_name, goal_hint: a.goal_hint, co_owner_names: a.co_owner_names, blocker: a.blocker, blocker_on_name: a.blocker_on_name, due_date: a.due_date && validIso(a.due_date) ? a.due_date : (a.due_date ? findDue(a.due_date, ctx.meetingDate).date : null), priority: a.priority, dependency: a.dependency, project_hint: a.project_hint })),
      risks: ai.risks,
      followups: ai.followups.map((f) => ({ ...f, due_date: f.due_date && validIso(f.due_date) ? f.due_date : null })),
    };
    return { engine: "claude", summary: raw.summary, discussion: raw.discussion, suggestions: await toSuggestions(raw, ctx) };
  }
  const raw = await ruleExtract(body, ctx);
  return { engine: "rules", summary: raw.summary, discussion: raw.discussion, suggestions: await toSuggestions(raw, ctx) };
}
