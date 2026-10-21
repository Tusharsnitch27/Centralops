import "server-only";
import { z } from "zod";
import { aiStructured } from "../ai/provider";
import { one } from "../db";
import type { ReportView } from "./model";

const bullets = (s: string) => s.split("\n").map((l) => l.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim()).filter((l) => l.length > 2);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

/** Plain-text rendering of one section for the model / email. */
export function sectionText(r: ReportView["rows"][number]) {
  const e = r.entry;
  const parts = [`## ${r.section.name} (${r.section.owners.join(", ") || "no owner"}) — ${r.section.group_name}`];
  if (e.metrics.length) parts.push(`Metrics: ${e.metrics.map((m) => `${m.label} ${m.value}${m.target ? ` (target ${m.target})` : ""}`).join("; ")}`);
  if (e.metrics_note) parts.push(`North star: ${e.metrics_note}`);
  if (e.updates) parts.push(`Updates:\n${e.updates}`);
  for (const t of e.tables) parts.push(`Table ${t.title}:\n${[t.columns, ...t.rows].map((r) => r.join(" | ")).join("\n")}`);
  if (e.ahead) parts.push(`Line items ahead:\n${e.ahead}`);
  if (e.blockers) parts.push(`Blockers:\n${e.blockers}`);
  if (e.images.length) parts.push(`(${e.images.length} screenshot${e.images.length > 1 ? "s" : ""} attached: ${e.images.map((i) => i.caption || "untitled").join("; ")})`);
  return parts.join("\n");
}

const Out = z.object({
  sections: z.array(z.object({ name: z.string(), owners: z.string(), line: z.string() })),
  callouts: z.array(z.string()).max(5),
});

/** Executive summary: one crisp line per function + callouts for leadership. Claude when configured, rules otherwise. */
export async function draftExecSummary(v: ReportView): Promise<{ text: string; engine: "claude" | "rules" }> {
  const rows = v.rows.filter((r) => r.entry.status !== "pending" || r.entry.updates || r.entry.metrics.length);
  const prev = await one<{ exec_summary: string }>(`select exec_summary from weekly_reports where week_of < $1 and exec_summary <> '' order by week_of desc limit 1`, [v.report.week_of]);
  const ai = await aiStructured({
    system: `You write the executive summary of the Central Operations weekly update at Snitch (Indian D2C fashion brand) that goes to leadership every Monday.
For each function write ONE crisp sentence (35–60 words): the biggest progress with its numbers (keep units, ₹, %, WoW exactly as given), then what's next. No fluff, no adjectives like "great" or "significant", never invent numbers.
Then list up to 5 callouts for leadership: decisions needed, risks, blockers needing their help, or targets clearly missed. Each callout one line, starting with the function name.`,
    prompt: `${prev ? `Last week's executive summary (match this voice and length):\n${prev.exec_summary}\n\n` : ""}This week's section updates:\n\n${rows.map(sectionText).join("\n\n")}`,
    tool: { name: "executive_summary", description: "Return the per-function lines and leadership callouts." },
    schema: Out,
    effort: "medium",
  });
  if (ai) {
    const lines = ai.sections.map((s) => `${s.name}${s.owners ? ` (${s.owners})` : ""}: ${s.line}`);
    const call = ai.callouts.length ? `\n\nCallouts for leadership:\n${ai.callouts.map((c) => `- ${c}`).join("\n")}` : "";
    return { text: lines.join("\n\n") + call, engine: "claude" };
  }
  // rules: first two updates + first line item ahead, blockers become callouts
  const lines = rows.map((r) => {
    const e = r.entry;
    const up = [e.metrics_note && clip(e.metrics_note, 180), ...bullets(e.updates)].filter(Boolean).slice(0, 2).map((x) => clip(String(x).replace(/[.;]$/, ""), 160));
    const next = bullets(e.ahead)[0];
    return `${r.section.name} (${r.section.owners.join(", ")}): ${up.join("; ") || "No update submitted"}${next ? `; next: ${clip(next.replace(/[.;]$/, ""), 120)}` : ""}.`;
  });
  const callouts = v.rows.flatMap((r) => bullets(r.entry.blockers).slice(0, 1).map((b) => `${r.section.name}: ${clip(b, 160)}`));
  const pending = v.rows.filter((r) => r.entry.status !== "submitted").map((r) => r.section.name);
  if (pending.length) callouts.push(`Not yet submitted: ${pending.join(", ")}`);
  return { text: (lines.join("\n\n") + (callouts.length ? `\n\nCallouts for leadership:\n${callouts.map((c) => `- ${c}`).join("\n")}` : "")).trim(), engine: "rules" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Bullet-aware text → HTML. */
export function textHtml(s: string) {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(`<ul style="margin:4px 0 8px 18px;padding:0">${list.map((l) => `<li style="margin:2px 0">${l}</li>`).join("")}</ul>`); list = []; } };
  for (const raw of s.split("\n")) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    const m = /^([-•*]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) list.push(esc(m[2])); else { flush(); out.push(`<p style="margin:4px 0">${esc(l)}</p>`); }
  }
  flush();
  return out.join("");
}

/** Email-safe HTML of the compiled update. Screenshots are referenced by cid (sent as attachments). */
export function emailHtml(v: ReportView) {
  const h = (t: string) => `<h3 style="font:600 15px Arial,sans-serif;margin:22px 0 6px;color:#121212">${esc(t)}</h3>`;
  const sub = (t: string) => `<div style="font:600 12px Arial,sans-serif;color:#555;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em">${t}</div>`;
  const groups = [...new Set(v.rows.map((r) => r.section.group_name))];
  const body = groups.map((g) => `<h2 style="font:700 17px Arial,sans-serif;margin:28px 0 4px;border-bottom:2px solid #121212;padding-bottom:4px">${esc(g)}</h2>` +
    v.rows.filter((r) => r.section.group_name === g).map((r) => {
      const e = r.entry;
      const metrics = e.metrics.length ? `<table cellpadding="6" style="border-collapse:collapse;margin:6px 0"><tr>${e.metrics.map((m) => `<td style="border:1px solid #ddd;font:12px Arial"><div style="color:#666">${esc(m.label)}</div><div style="font:700 16px Arial">${esc(m.value)}</div>${m.target ? `<div style="color:#888">Target: ${esc(m.target)}</div>` : ""}</td>`).join("")}</tr></table>` : "";
      const tables = e.tables.map((t) => `${t.title ? sub(esc(t.title)) : ""}<table cellpadding="5" style="border-collapse:collapse;font:12px Arial;margin:4px 0">${[t.columns, ...t.rows].map((row, i) => `<tr>${row.map((c) => `<td style="border:1px solid #ddd;${i === 0 ? "background:#f3f3f1;font-weight:600" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`).join("");
      const imgs = e.images.map((i) => `<div style="margin:6px 0"><img src="cid:${i.id}" alt="${esc(i.caption)}" style="max-width:640px;border:1px solid #ddd"/>${i.caption ? `<div style="font:11px Arial;color:#777">${esc(i.caption)}</div>` : ""}</div>`).join("");
      return h(`${r.section.name} — ${r.section.owners.join(", ")}`) + metrics +
        (e.metrics_note ? sub("North Star Metrics") + textHtml(e.metrics_note) : "") + imgs + tables +
        (e.updates ? sub("Updates") + textHtml(e.updates) : "") + (e.ahead ? sub("Line Items Ahead") + textHtml(e.ahead) : "") +
        (e.blockers ? sub("Blockers / Dependencies") + textHtml(e.blockers) : "") +
        (e.status !== "submitted" && !e.updates ? `<p style="font:12px Arial;color:#b45309">Update not submitted.</p>` : "");
    }).join("")).join("");
  return `<div style="font:13px/1.5 Arial,sans-serif;color:#222;max-width:760px">
<h1 style="font:700 20px Arial,sans-serif;margin:0 0 12px">${esc(v.report.title)}</h1>
<h2 style="font:700 17px Arial,sans-serif;margin:16px 0 4px;border-bottom:2px solid #121212;padding-bottom:4px">Executive Summary</h2>
${textHtml(v.report.exec_summary || "—")}
${body}</div>`;
}
