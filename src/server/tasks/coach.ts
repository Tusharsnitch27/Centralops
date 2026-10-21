import "server-only";
import { z } from "zod";
import { aiConfigured, aiStructured } from "../ai/provider";
import { listPeople, matchPerson } from "../core/people";
import { listTasks, type TaskListItem } from "./queries";
import { parseQuick } from "@/lib/quickParse";
import { addDays, diffDays, fmtDate, today } from "@/lib/dates";
import type { FocusBrief, FocusItem, Priority, TaskDraft } from "@/lib/taskDraft";

const COACH = `You are the task coach inside Central Ops, the program-management tool of the Central Operations team at Snitch (an Indian D2C fashion brand: warehouses, logistics, packaging, SaaS, catalog, S&OP, AOP budgets).
The user is the team's Program Manager. They type tasks the way they think them. Your job is to make each task precise and impactful WITHOUT inventing facts:
- title: a crisp action starting with a verb, keeping the user's meaning and nouns. No dates or names in the title.
- outcome: one line "done" definition — observable, measurable where possible (e.g. "All 12 perfume SKUs live on site + app with freebie tag").
- next_step: the very first concrete step the user can take today.
- questions: up to 3 short questions about details that are genuinely missing and would change how the work gets done (scope, which SKUs/channel/vendor, approval needed). Never ask about due date or POC if already given.
- tips: up to 2 short, specific suggestions that raise impact or de-risk it (dependency to unblock, who to loop in, what to measure). No generic advice.
- priority: urgent / high / medium / low from deadline proximity and business impact.
Resolve relative dates against today. Due dates are never in the past.`;

const DraftOut = z.object({
  title: z.string(),
  outcome: z.string(),
  next_step: z.string(),
  due_date: z.string().nullable().describe("YYYY-MM-DD or null if not stated"),
  poc_name: z.string().nullable().describe("person named as owner/POC in the text, else null"),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  questions: z.array(z.string()).max(3),
  tips: z.array(z.string()).max(2),
});

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const FILLER = /^(i\s+(need|have|want)\s+to|need\s+to|have\s+to|must|should|todo:?|task:?|pls|please)\s+/i;

/** Turn one free-text line into a refined draft. Claude when configured, rules otherwise. */
export async function draftTask(raw: string): Promise<TaskDraft> {
  const t = today();
  const p = parseQuick(raw.trim(), t);
  // POC: @name, "with X", "ask X", "X to …"
  const m = /\b(?:with|ask|via|poc:?|owner:?|assign(?:ed)? to)\s+([A-Z][a-z]+)/.exec(raw) ?? /^([A-Z][a-z]+)\s+(?:to|will)\s/.exec(raw);
  let ownerName = p.owner ?? m?.[1] ?? null;
  const base = cap(p.title.replace(FILLER, "").replace(/\s+(?:with|ask|via)\s+[A-Z][a-z]+\b/, "").trim());

  const people = aiConfigured() ? await listPeople() : [];
  const ai = aiConfigured() ? await aiStructured({
    system: COACH,
    prompt: `Today is ${t} (${fmtDate(t, { dow: true })}).\nPeople in the team: ${people.map((x) => `${x.name}${x.title ? ` (${x.title})` : ""}`).join("; ")}\n\nTask as typed:\n${raw}`,
    tool: { name: "refine_task", description: "Return the refined task." },
    schema: DraftOut,
  }) : null;

  if (ai) {
    ownerName = ai.poc_name ?? ownerName;
    const person = await matchPerson(ownerName);
    const due = ai.due_date && ai.due_date >= t ? ai.due_date : p.due ?? null;
    return {
      raw, title: ai.title || base, details: "", outcome: ai.outcome, nextStep: ai.next_step, dueDate: due, dueLabel: due ? fmtDate(due, { dow: true }) : null,
      ownerId: person?.id ?? null, ownerName: person?.name ?? ownerName, priority: ai.priority, questions: ai.questions, tips: ai.tips, engine: "claude",
    };
  }

  const person = await matchPerson(ownerName);
  const due = p.due ?? null;
  const days = due ? diffDays(due, t) : null;
  const priority: Priority = p.priority ?? (/\b(urgent|asap|critical|today)\b/i.test(raw) ? "urgent" : days != null && days <= 2 ? "high" : "medium");
  const questions: string[] = [];
  questions.push("What exactly is in scope — which items, SKUs, channel or vendor?");
  if (!due) questions.push("When does this need to be done?");
  if (!person) questions.push("Who is the point of contact you depend on?");
  const tips: string[] = [];
  if (/\b(catalog|listing|sku|launch|live)\b/i.test(raw)) tips.push("Confirm images, pricing and inventory are ready before it goes live — those usually hold up catalog changes.");
  if (/\b(vendor|contract|rate|negotiat|po\b|invoice)/i.test(raw)) tips.push("Note the current rate or baseline so the saving or change can be measured.");
  if (days != null && days <= 2) tips.push("This is due very soon — block time on your calendar for it today.");
  return {
    raw, title: base, details: "", outcome: "", nextStep: "", dueDate: due, dueLabel: due ? fmtDate(due, { dow: true }) : null,
    ownerId: person?.id ?? null, ownerName: person?.name ?? ownerName, priority, questions: questions.slice(0, 3), tips: tips.slice(0, 2), engine: "rules",
  };
}

/** My open work, soonest due first (overdue on top, undated last). */
export function myPending(userId: string) {
  return listTasks({ involving: userId, open: true, order: "due", limit: 300 });
}

/** Rule-based "what to focus on" from the pending list. */
export function ruleFocus(tasks: TaskListItem[], userId: string): FocusBrief {
  const t = today();
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
export async function aiFocus(tasks: TaskListItem[], userId: string): Promise<FocusBrief> {
  const t = today();
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
