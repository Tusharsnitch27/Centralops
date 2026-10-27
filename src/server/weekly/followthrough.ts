import "server-only";
import { z } from "zod";
import { aiStructured } from "../ai/provider";
import { q } from "../db";
import type { User } from "../auth";
import { loadReport, type ReportView } from "./model";
import { sectionText } from "./summary";

/**
 * Follow-through: what last week's update promised (line items ahead), flagged (metrics off target) or was stuck on (blockers),
 * checked against this week's update per function. Only the misses come back, each with a question for the reader to ask.
 */
export type FollowKind = "next_step" | "metric" | "blocker";
export interface FollowItem { kind: FollowKind; last_week: string; status: "skipped" | "no_progress" | "worse" | "repeated"; this_week: string; question: string }
export interface FollowSection { section_id: string; section: string; owners: string; items: FollowItem[] }
export interface FollowThrough { week_of: string; prev_week_of: string | null; sections: FollowSection[] }

const Out = z.object({
  sections: z.array(z.object({
    section: z.string().describe("Function / section name exactly as given"),
    items: z.array(z.object({
      kind: z.enum(["next_step", "metric", "blocker"]),
      last_week: z.string().describe("What last week said (short, quote the essence)"),
      status: z.enum(["skipped", "no_progress", "worse", "repeated"]).describe("skipped: not mentioned at all this week; no_progress: mentioned but not moved; worse: metric moved the wrong way; repeated: same blocker still open"),
      this_week: z.string().describe("What this week says about it, or 'not mentioned'"),
      question: z.string().describe("One sharp question the reader should ask the owner"),
    })),
  })),
});

const bullets = (s: string) => s.split("\n").map((l) => l.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 3);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9%₹ ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
const STOP = new Set(["this", "that", "with", "from", "will", "week", "next", "have", "been", "were", "they", "their", "into", "done", "also", "basis", "along", "under", "over", "plan", "team"]);
const hasUpdate = (r: ReportView["rows"][number]) => r.entry.status !== "pending" && !!(r.entry.updates || r.entry.metrics.length || r.entry.ahead || r.entry.tables.length);
const num = (v: string) => { const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

/** Rules fallback: a next step with little word overlap in this week's text is "skipped"; metrics below target that didn't improve; repeated blockers. */
function rules(prev: ReportView, cur: ReportView): FollowSection[] {
  const out: FollowSection[] = [];
  for (const r of cur.rows) {
    const p = prev.rows.find((x) => x.section.id === r.section.id);
    if (!p || !hasUpdate(r)) continue; // only sections that have updated this week
    const e = r.entry, pe = p.entry;
    const now = words([e.updates, e.ahead, e.blockers, e.metrics_note, ...e.metrics.map((m) => `${m.label} ${m.value}`), ...e.tables.flatMap((t) => t.rows.flat())].join(" "));
    const items: FollowItem[] = [];
    for (const step of bullets(pe.ahead)) {
      const w = [...words(step)];
      const hit = w.filter((x) => now.has(x)).length;
      if (w.length && hit / w.length < 0.34)
        items.push({ kind: "next_step", last_week: step, status: "skipped", this_week: "not mentioned", question: `Last week the plan was “${step.slice(0, 90)}” — did it happen, and if not, what moved it?` });
    }
    for (const m of pe.metrics) {
      const t = num(m.target), a = num(m.value);
      const c = e.metrics.find((x) => x.label.trim().toLowerCase() === m.label.trim().toLowerCase());
      const b = c ? num(c.value) : null;
      if (t == null || a == null) continue;
      const higherIsBetter = !/tat|days|delay|pendency|error|rto|return|cost|backlog|aging|ageing/i.test(m.label);
      const missed = higherIsBetter ? a < t : a > t;
      if (!missed) continue;
      if (b == null) items.push({ kind: "metric", last_week: `${m.label}: ${m.value} vs target ${m.target}`, status: "skipped", this_week: "metric not reported", question: `${m.label} was off target last week — why isn't it reported this week?` });
      else if (higherIsBetter ? b <= a : b >= a) items.push({ kind: "metric", last_week: `${m.label}: ${m.value} vs target ${m.target}`, status: b === a ? "no_progress" : "worse", this_week: `${c!.value}`, question: `${m.label} is still off target (${m.value} → ${c!.value}). What is the recovery plan and by when?` });
    }
    for (const bl of bullets(pe.blockers)) {
      const w = [...words(bl)];
      if (w.length && w.filter((x) => words(e.blockers).has(x)).length / w.length >= 0.5)
        items.push({ kind: "blocker", last_week: bl, status: "repeated", this_week: "still listed as a blocker", question: `This blocker is open for a second week — who needs to act, and is leadership help needed?` });
    }
    if (items.length) out.push({ section_id: r.section.id, section: r.section.name, owners: r.section.owners.join(", "), items });
  }
  return out;
}

export async function buildFollowThrough(weekOf: string, u: Pick<User, "id" | "role">) {
  const prevWeek = (await q<{ w: string }>(`select week_of::text as w from weekly_reports where week_of < $1 order by week_of desc limit 1`, [weekOf]))[0]?.w ?? null;
  const [cur, prev] = await Promise.all([loadReport(weekOf, u), prevWeek ? loadReport(prevWeek, u) : null]);
  if (!cur) throw new Error("No update for that week");
  const result: FollowThrough = { week_of: weekOf, prev_week_of: prevWeek, sections: [] };
  let engine: "claude" | "rules" = "rules";
  if (prev) {
    const pairs = cur.rows.filter(hasUpdate).map((r) => {
      const p = prev.rows.find((x) => x.section.id === r.section.id);
      return p ? `### ${r.section.name}\nLAST WEEK (${prevWeek}):\n${sectionText(p)}\n\nTHIS WEEK (${weekOf}):\n${sectionText(r)}` : null;
    }).filter(Boolean);
    const ai = pairs.length ? await Promise.race([
      aiStructured({
        system: `You review the Central Operations weekly update at Snitch for the program manager before it goes to leadership.
For each function, compare LAST WEEK with THIS WEEK and list only what fell through: next steps ("line items ahead") that this week doesn't mention or show no progress on, metrics that were off target last week and are still off / worse / no longer reported, and blockers that are still open. Skip anything that clearly moved or was completed. Quote last week briefly, say what this week says ("not mentioned" if nothing), and give one sharp, specific question the reader should ask the owner. Never invent facts or numbers. Functions with nothing fallen through are omitted.`,
        prompt: pairs.join("\n\n---\n\n"),
        tool: { name: "follow_through", description: "Return what fell through per function" },
        schema: Out, effort: "medium",
      }).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 60_000)),
    ]) : null;
    if (ai) {
      engine = "claude";
      result.sections = ai.sections.filter((s) => s.items.length).map((s) => {
        const row = cur.rows.find((r) => r.section.name.toLowerCase() === s.section.toLowerCase()) ?? cur.rows.find((r) => s.section.toLowerCase().includes(r.section.name.toLowerCase()));
        return { section_id: row?.section.id ?? "", section: row?.section.name ?? s.section, owners: row?.section.owners.join(", ") ?? "", items: s.items };
      });
    } else result.sections = rules(prev, cur);
  }
  await q(`update weekly_reports set followthrough = $2, followthrough_engine = $3, followthrough_at = now() where id = $1`, [cur.report.id, JSON.stringify(result), engine]);
  return { result, engine };
}

export async function storedFollowThrough(weekOf: string) {
  const r = (await q<{ followthrough: FollowThrough | null; followthrough_engine: string | null; followthrough_at: string | null; latest: string | null }>(
    `select r.followthrough, r.followthrough_engine, r.followthrough_at::text, (select max(e.updated_at)::text from weekly_entries e where e.report_id = r.id) as latest
     from weekly_reports r where r.week_of = $1`, [weekOf]))[0];
  return r ? { data: r.followthrough, engine: r.followthrough_engine, at: r.followthrough_at, stale: !!(r.followthrough_at && r.latest && r.latest > r.followthrough_at) } : null;
}
