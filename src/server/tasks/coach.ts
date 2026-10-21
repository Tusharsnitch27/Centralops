import "server-only";
import { z } from "zod";
import { aiConfigured, aiStructured } from "../ai/provider";
import { listPeople } from "../core/people";
import { listTasks, type TaskListItem } from "./queries";
import { parseQuick } from "@/lib/quickParse";
import { findPoc } from "@/lib/pocFind";
import { extractLinks } from "@/lib/links";
import { addDays, diffDays, fmtDate, today } from "@/lib/dates";
import type { DraftInput, FocusBrief, FocusItem, Priority, TaskDraft } from "@/lib/taskDraft";

const COACH = `You are the task coach inside Central Ops, the program-management tool of the Central Operations team at Snitch (an Indian D2C fashion brand: warehouses, logistics, packaging, SaaS, catalog, S&OP, AOP budgets).
The user is the team's Program Manager. They type tasks the way they think them. Your job is to make each task precise and impactful WITHOUT inventing facts:
- title: a crisp action starting with a verb, keeping the user's meaning and nouns (max ~10 words). No dates or names in the title.
- details: everything else the user wrote that matters — scope, specifics, quantities, context, conditions — as 1–4 short lines ("- " bullets). Move it out of the title instead of dropping it. Never invent facts; empty string if there is nothing beyond the title.
- outcome: one line "done" definition — observable, measurable where possible (e.g. "All 12 perfume SKUs live on site + app with freebie tag").
- next_step: the very first concrete step the user can take today.
- questions: up to 3 short questions about details that are genuinely missing and would change how the work gets done (scope, which SKUs/channel/vendor, approval needed). Never ask about due date or POC if already given.
- tips: up to 2 short, specific suggestions that raise impact or de-risk it (dependency to unblock, who to loop in, what to measure). No generic advice.
- priority: urgent / high / medium / low from deadline proximity and business impact.
Resolve relative dates against today. Due dates are never in the past.`;

const DraftOut = z.object({
  title: z.string(),
  details: z.string(),
  outcome: z.string(),
  next_step: z.string(),
  due_date: z.string().nullable().describe("YYYY-MM-DD or null if not stated"),
  poc_name: z.string().nullable().describe("person or company named as POC in the text (keep as written), else null"),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  questions: z.array(z.string()).max(3),
  tips: z.array(z.string()).max(2),
});

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const FILLER = /^(i\s+(need|have|want)\s+to|need\s+to|have\s+to|must|should|todo:?|task:?|pls|please)\s+/i;

// "Freebie addition of perfumes into catalog" → "Add freebie perfumes into catalog"
const NOUN_VERB: Record<string, string> = {
  addition: "Add", creation: "Create", update: "Update", review: "Review", setup: "Set up", "set-up": "Set up", removal: "Remove", launch: "Launch",
  onboarding: "Onboard", closure: "Close", renewal: "Renew", finalisation: "Finalise", finalization: "Finalize", preparation: "Prepare", completion: "Complete",
  implementation: "Implement", migration: "Migrate", negotiation: "Negotiate", approval: "Get approval for", submission: "Submit", reconciliation: "Reconcile", audit: "Audit",
};
function verbify(t: string) {
  const m = /^(.*?)\s*\b(addition|creation|update|review|setup|set-up|removal|launch|onboarding|closure|renewal|finalisation|finalization|preparation|completion|implementation|migration|negotiation|approval|submission|reconciliation|audit) of (.+)$/i.exec(t);
  if (!m) return t;
  return `${NOUN_VERB[m[2].toLowerCase()]} ${m[1] ? `${m[1].toLowerCase()} ` : ""}${m[3]}`;
}
/** Split one line into a short title and the detail clauses hanging off it. */
function splitClauses(text: string): { title: string; details: string[] } {
  const details: string[] = [];
  let t = text.replace(/\(([^)]+)\)/g, (_, x: string) => { details.push(x.trim()); return " "; });
  const parts = t.split(/\s+[—–-]\s+|:\s+|;\s*|\.\s+(?=[A-Z])/);
  t = parts.shift() ?? t;
  details.push(...parts);
  // trailing qualifiers: "… for Diwali sale", "… so that …", "… including …"
  const tail = /\s+(so that|so|because|including|incl\.?|to ensure|in order to|as per|for the|for)\s+(.{8,})$/i.exec(t);
  if (tail && t.length - tail[0].length >= 12) { details.unshift(`${cap(tail[1])} ${tail[2]}`); t = t.slice(0, tail.index); }
  return { title: t.replace(/\s+/g, " ").trim(), details: details.map((d) => d.replace(/\s+/g, " ").trim()).filter((d) => d.length > 2) };
}

/** Rule-based "done when" / "first step" from the task's leading verb. */
function suggest(title: string, poc: string) {
  const m = /^(\S+)\s+(.*)$/.exec(title);
  const verb = (m?.[1] ?? "").toLowerCase(), obj = m?.[2] ?? title;
  const w = poc ? ` with ${poc.split(" (")[0]}` : "";
  if (/^(share|send|submit|present|circulate|publish)$/.test(verb)) return { outcome: `${cap(obj)} ${verb === "submit" ? "submitted" : "shared"} and acknowledged`, nextStep: `Prepare the first draft of ${obj}` };
  if (/^(finalise|finalize|close|negotiate|sign|renew|approve)$/.test(verb)) return { outcome: `${cap(obj)} agreed and signed off${w}`, nextStep: `List the open points on ${obj}${w}` };
  if (/^(add|launch|set|create|build|implement|deploy|onboard|roll)$/.test(verb)) return { outcome: `${cap(obj)} live and verified`, nextStep: `Collect everything needed for ${obj}` };
  if (/^(review|audit|analyse|analyze|check|reconcile|track)$/.test(verb)) return { outcome: `${cap(obj)} reviewed, gaps and actions noted`, nextStep: `Pull the latest data for ${obj}` };
  if (/^(fix|resolve|clear|reduce|improve)$/.test(verb)) return { outcome: `${cap(obj)} resolved, with the number before vs after`, nextStep: `Find the root cause of ${obj}` };
  if (/^(plan|prepare|draft|design|define)$/.test(verb)) return { outcome: `${cap(obj)} ready for review`, nextStep: `Outline ${obj}` };
  if (/^(follow|chase|discuss|align|sync|call|meet)$/.test(verb)) return { outcome: `Clear answer${w} on ${obj.replace(/^(up|with)\s+/i, "")}`, nextStep: `Message${w || " the owner"} to set a time` };
  return { outcome: "", nextStep: "" };
}

/** Turn free text into a refined draft. Claude when configured, rules otherwise. `cur` = a re-sharpen pass over the user's edits. */
export async function draftTask(raw: string, cur?: DraftInput): Promise<TaskDraft> {
  const t = today();
  const people = await listPeople();
  const { text: noUrl, links } = extractLinks(raw);
  const allLinks = [...(cur?.links ?? []), ...links.filter((l) => !cur?.links?.some((c) => c.url === l.url))];
  const source = cur ? [cur.title || noUrl, cur.details].filter(Boolean).join("\n") : noUrl;
  const p = parseQuick(source.split("\n")[0], t);
  const hit = findPoc(noUrl, people);
  let pocName = cur?.pocName?.trim() || hit?.name || "";
  const dueFixed = cur?.dueDate ?? null;

  const ai = aiConfigured() ? await aiStructured({
    system: COACH,
    prompt: `Today is ${t} (${fmtDate(t, { dow: true })}).\nPeople in the team: ${people.map((x) => `${x.name}${x.title ? ` (${x.title})` : ""}`).join("; ")}\n\n${cur
      ? `The user's draft so far — sharpen it, keep everything they added:\nOriginally typed: ${noUrl}\nTitle: ${cur.title ?? ""}\nDetails: ${cur.details || "(none)"}\nPOC: ${cur.pocName || "(none)"}\nDue: ${cur.dueDate ?? "(none)"}`
      : `Task as typed:\n${noUrl}`}${pocName ? `\n(POC detected: ${pocName})` : ""}`,
    tool: { name: "refine_task", description: "Return the refined task." },
    schema: DraftOut,
  }) : null;

  if (ai) {
    pocName = cur?.pocName?.trim() || pocName || ai.poc_name || "";
    const person = await directoryPoc(pocName);
    const due = dueFixed ?? (ai.due_date && ai.due_date >= t ? ai.due_date : p.due ?? null);
    return {
      raw, title: ai.title || p.title, details: ai.details.trim(), outcome: ai.outcome, nextStep: ai.next_step, dueDate: due, startDate: cur?.startDate ?? null, dueLabel: due ? fmtDate(due, { dow: true }) : null,
      pocName: person?.name ?? pocName, ownerId: person?.id ?? null, priority: ai.priority, questions: ai.questions, tips: ai.tips, links: allLinks, engine: "claude",
    };
  }

  // rules: strip the POC phrase and filler, split clauses into details, turn "X addition of Y" into "Add X Y"
  let base = p.title;
  if (hit?.phrase) base = base.replace(new RegExp(`\\s*${hit.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), " ").replace(/\s+/g, " ").trim();
  const sp = splitClauses(base.replace(FILLER, ""));
  const extra = cur ? (cur.details ?? "").split("\n").map((x) => x.replace(/^[-•]\s*/, "").trim()).filter(Boolean) : [];
  const details = [...new Set([...sp.details, ...extra])];
  const title = cap(verbify(sp.title));
  const person = await directoryPoc(pocName);
  const due = dueFixed ?? p.due ?? null;
  const days = due ? diffDays(due, t) : null;
  const priority: Priority = p.priority ?? (/\b(urgent|asap|critical|today)\b/i.test(raw) ? "urgent" : days != null && days <= 2 ? "high" : "medium");
  const questions: string[] = [];
  if (!details.length) questions.push("What exactly is in scope — which items, SKUs, channel or vendor?");
  if (!due) questions.push("When does this need to be done?");
  if (!pocName) questions.push("Who is the point of contact?");
  const tips: string[] = [];
  if (/\b(catalog|listing|sku|launch|live)\b/i.test(raw)) tips.push("Confirm images, pricing and inventory are ready before it goes live — those usually hold up catalog changes.");
  if (/\b(vendor|contract|rate|negotiat|po\b|invoice)/i.test(raw)) tips.push("Note the current rate or baseline so the saving or change can be measured.");
  if (days != null && days <= 2) tips.push("This is due very soon — block time on your calendar for it today.");
  const sg = suggest(title, person?.name ?? pocName);
  return {
    raw, title, details: details.map((x) => `- ${cap(x)}`).join("\n"), outcome: sg.outcome, nextStep: sg.nextStep, dueDate: due, startDate: cur?.startDate ?? null, dueLabel: due ? fmtDate(due, { dow: true }) : null,
    pocName: person?.name ?? pocName, ownerId: person?.id ?? null, priority, questions: questions.slice(0, 3), tips: tips.slice(0, 2), links: allLinks, engine: "rules",
  };
}

/** My open work, soonest due first (overdue on top, undated last). */
export function myPending(userId: string) {
  return listTasks({ involving: userId, open: true, order: "due", limit: 300 });
}

/** Rule-based "what to focus on" from the pending list. */
export function ruleFocus(all: TaskListItem[], userId: string): FocusBrief {
  const t = today();
  const tasks = all.filter((x) => !x.start_date || x.start_date <= t);
  const scored: (FocusItem & { score: number })[] = [];
  for (const x of tasks) {
    const pr = { urgent: 30, high: 20, medium: 10, low: 0 }[x.priority];
    const mine = x.owner_id === userId;
    const unowned = !x.owner_id && !x.owner_team_id;
    if (x.due_date && x.due_date < t) {
      const d = diffDays(t, x.due_date);
      scored.push({ taskId: x.id, title: x.title, tone: "red", score: 100 + d + pr, why: `Overdue by ${d} day${d === 1 ? "" : "s"}`, action: mine ? "Finish it, or move the date with a reason" : unowned ? "Assign an owner and a realistic date" : `Chase ${x.owner_name ?? x.owner_team_name} for a revised date` });
    } else if (x.due_date && x.due_date <= addDays(t, 1)) {
      scored.push({ taskId: x.id, title: x.title, tone: "amber", score: 80 + pr, why: x.due_date === t ? "Due today" : "Due tomorrow", action: mine ? "Block time for it today" : `Check in with ${x.owner_name ?? "the owner"} today` });
    } else if (!mine && x.owner_id && x.days_since_update >= 5) {
      scored.push({ taskId: x.id, title: x.title, tone: "amber", score: 50 + x.days_since_update + pr, why: `No update from ${x.owner_name} in ${x.days_since_update} days`, action: "Send a nudge or ask for status" });
    } else if (!x.due_date && (x.priority === "urgent" || x.priority === "high")) {
      scored.push({ taskId: x.id, title: x.title, tone: "info", score: 40 + pr, why: `${x.priority === "urgent" ? "Urgent" : "High priority"} but no due date`, action: "Set a due date so it gets tracked" });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const overdue = tasks.filter((x) => x.due_date && x.due_date < t).length;
  const week = tasks.filter((x) => x.due_date && x.due_date >= t && x.due_date <= addDays(t, 7)).length;
  const undated = tasks.filter((x) => !x.due_date).length;
  const hygiene: string[] = [];
  if (undated) hygiene.push(`${undated} task${undated === 1 ? " has" : "s have"} no due date`);
  const noNext = tasks.filter((x) => !x.next_step).length;
  if (noNext > 3) hygiene.push(`${noNext} tasks have no next step written down`);
  const headline = !tasks.length ? "Your list is clear." : overdue ? `${overdue} overdue and ${week} due this week — clear the overdue ones first.` : week ? `${week} due in the next 7 days, nothing overdue.` : "Nothing urgent — a good day to move bigger items forward.";
  return { headline, items: scored.slice(0, 3).map(({ score: _s, ...i }) => i), hygiene, engine: "rules" };
}

const FocusOut = z.object({
  headline: z.string().describe("one sentence: the shape of today"),
  focus: z.array(z.object({ number: z.number().int(), why: z.string(), action: z.string(), tone: z.enum(["red", "amber", "info"]) })).max(3),
  hygiene: z.array(z.string()).max(3).describe("short list-hygiene suggestions: merge duplicates, split vague tasks, missing dates/owners"),
});

/** Claude's take on the same list: picks the 3 that matter most and says why. */
export async function aiFocus(all: TaskListItem[], userId: string): Promise<FocusBrief> {
  const t = today();
  const tasks = all.filter((x) => !x.start_date || x.start_date <= t);
  const lines = tasks.slice(0, 60).map((x) => `#${x.number} | ${x.title} | due ${x.due_date ?? "none"} | ${x.priority} | owner ${x.owner_id === userId ? "me" : x.owner_name ?? x.owner_team_name ?? "none"} | ${x.days_since_update}d since update${x.next_step ? ` | next: ${x.next_step}` : ""}`);
  const ai = await aiStructured({
    system: `${COACH}\n\nNow act as the user's chief of staff for the day: pick the three tasks that matter most today (deadline, business impact, unblocking others), say why in one short line each and the concrete action. Prefer closing overdue work and unblocking delegated work.`,
    prompt: `Today is ${t} (${fmtDate(t, { dow: true })}).\nOpen tasks:\n${lines.join("\n")}`,
    tool: { name: "plan_day", description: "Return today's focus." },
    schema: FocusOut,
  });
  if (!ai) return ruleFocus(tasks, userId);
  const byNo = new Map(tasks.map((x) => [x.number, x]));
  const items = ai.focus.flatMap((f) => { const x = byNo.get(f.number); return x ? [{ taskId: x.id, title: x.title, why: f.why, action: f.action, tone: f.tone }] : []; });
  return { headline: ai.headline, items, hygiene: ai.hygiene, engine: "claude" };
}

/** A POC counts as a directory user only on a clear match: full name, or a first name only one person has. */
export async function directoryPoc(name?: string) {
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  const people = await listPeople();
  const exact = people.find((p) => p.name.toLowerCase() === n || p.email?.toLowerCase() === n);
  if (exact) return exact;
  if (/\s/.test(n)) return null;
  const firsts = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n);
  return firsts.length === 1 ? firsts[0] : null;
}
