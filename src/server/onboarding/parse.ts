import "server-only";
import { z } from "zod";
import { aiStructured } from "../ai/provider";
import { listPeople, listProjectsLite, listTeams, matchPerson, matchTeam } from "../core/people";
import { parseQuick } from "@/lib/quickParse";
import { today } from "@/lib/dates";

export type CaptureKind = "task" | "project" | "review" | "followup";
export interface CaptureItem {
  key: string;
  kind: CaptureKind;
  title: string;
  owner_id: string | null;
  owner_team_id: string | null;
  owner_label: string | null;
  due_date: string | null;
  priority: "urgent" | "high" | "medium" | "low";
  cadence: "daily" | "weekly" | "fortnightly" | "monthly" | null;
  mom_owner_id: string | null;
  project_id: string | null;
  notes: string | null;
}

const AiItem = z.object({
  kind: z.enum(["task", "project", "review", "followup"]),
  title: z.string(),
  owner_name: z.string().nullable(),
  due_date: z.string().nullable().describe("YYYY-MM-DD, today or later, or null"),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  cadence: z.enum(["daily", "weekly", "fortnightly", "monthly"]).nullable().describe("only for recurring reviews/meetings"),
  mom_owner_name: z.string().nullable().describe("who writes the MoM, for recurring reviews"),
  project_hint: z.string().nullable(),
  notes: z.string().nullable(),
});
const AiOut = z.object({ items: z.array(AiItem) });

/** Turn a free-text brain dump into reviewable items (Claude when configured, rules otherwise). */
export async function parseWorkDump(text: string): Promise<{ items: CaptureItem[]; engine: "claude" | "rules" }> {
  const t = today();
  const [people, teams, projects] = await Promise.all([listPeople(), listTeams(), listProjectsLite()]);
  const ai = await aiStructured({
    system: "You turn a program manager's brain dump of current work into structured items for an operations tool. One input line usually equals one item, but split lines that clearly contain several. Never invent items. Kinds: task (a concrete action — use this for larger initiatives too), review (a recurring meeting/business review), followup (the user is waiting on someone else). Never use 'project'.",
    prompt: `Today is ${t} (dates must be ${t} or later; resolve 'Friday', 'next week', '15th' relative to today).\nPeople: ${people.map((p) => `${p.name} (${p.title ?? p.team_name ?? ""})`).join("; ")}\nTeams: ${teams.map((x) => x.name).join(", ")}\nExisting projects: ${projects.map((p) => p.name).join("; ")}\n\nBrain dump:\n${text}`,
    tool: { name: "capture_items", description: "Return the structured work items." },
    schema: AiOut,
  });
  if (ai) {
    const items: CaptureItem[] = [];
    for (const [i, x] of ai.items.entries()) {
      const person = await matchPerson(x.owner_name);
      const team = person ? null : await matchTeam(x.owner_name);
      const mom = await matchPerson(x.mom_owner_name);
      const proj = x.project_hint ? projects.find((p) => p.name.toLowerCase().includes(x.project_hint!.toLowerCase()) || x.project_hint!.toLowerCase().includes((p.code ?? "~").toLowerCase())) : undefined;
      items.push({
        key: `ai${i}`, kind: x.kind, title: x.title, owner_id: person?.id ?? null, owner_team_id: team?.id ?? null, owner_label: x.owner_name,
        due_date: x.due_date && x.due_date >= t ? x.due_date : x.due_date ? t : null, priority: x.priority, cadence: x.kind === "review" ? x.cadence ?? "weekly" : null,
        mom_owner_id: mom?.id ?? null, project_id: proj?.id ?? null, notes: x.notes,
      });
    }
    return { items, engine: "claude" };
  }
  return { items: await rules(text), engine: "rules" };
}

const RE_FOLLOW = /\b(waiting (on|for)|follow[- ]?up|chase|pending from|awaiting)\b/i;
const RE_REVIEW = /\b(daily|weekly|fortnightly|biweekly|monthly|every (mon|tue|wed|thu|fri|week|month)\w*|stand-?up|sync|review meeting|cadence)\b/i;
// const RE_PROJECT = /\b(project|program(me)?|rollout|roll-out|implementation|launch|setup|set-up|migration|transformation|expansion|initiative|readiness)\b/i;

async function rules(text: string): Promise<CaptureItem[]> {
  const out: CaptureItem[] = [];
  const projects = await listProjectsLite();
  const lines = text.split(/\n|;(?=\s)/).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 2);
  for (const [i, line] of lines.entries()) {
    const p = parseQuick(line);
    let ownerName = p.owner ?? null;
    const m = /\b(?:with|waiting (?:on|for)|from|owner:?|by)\s+([A-Z][a-z]+)\b/.exec(line) ?? /^([A-Z][a-z]+)\s+(?:to|will|is)\b/.exec(line);
    if (!ownerName && m) ownerName = m[1];
    const person = await matchPerson(ownerName);
    const team = person ? null : await matchTeam(ownerName);
    const kind: CaptureKind = RE_FOLLOW.test(line) ? "followup" : RE_REVIEW.test(line) ? "review" : "task";
    const cadence = kind === "review" ? (/daily|stand-?up/i.test(line) ? "daily" : /fortnight|biweekly/i.test(line) ? "fortnightly" : /month/i.test(line) ? "monthly" : "weekly") : null;
    const momM = /\b([A-Z][a-z]+)\s+(?:writes|owns|takes)\s+(?:the\s+)?mom\b/i.exec(line);
    const mom = momM ? await matchPerson(momM[1]) : null;
    const proj = projects.find((x) => line.toLowerCase().includes(x.name.toLowerCase()) || (x.code && new RegExp(`\\b${x.code}\\b`, "i").test(line)));
    out.push({
      key: `r${i}`, kind, title: p.title.replace(/\s*[—-]\s*$/, ""), owner_id: person?.id ?? null, owner_team_id: team?.id ?? null, owner_label: ownerName,
      due_date: p.due ?? null, priority: p.priority ?? (/urgent|asap|critical/i.test(line) ? "urgent" : "medium"), cadence, mom_owner_id: mom?.id ?? null, project_id: proj?.id ?? null, notes: null,
    });
  }
  return out;
}
