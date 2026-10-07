// Report document model + plain-text / WhatsApp serialisers (pure — usable on server and client).
import type { Tone } from "@/lib/meta";

export interface ListItem { text: string; href?: string; meta?: string; tone?: Tone }
export type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: ListItem[]; ordered?: boolean }
  | { type: "stats"; items: { label: string; value: string; tone?: Tone; hint?: string }[] }
  | { type: "table"; columns: string[]; rows: string[][]; align?: ("l" | "r")[]; tones?: (Tone | null)[][] }
  | { type: "pre"; text: string };
export interface Section { heading: string; blocks: Block[]; empty?: string }
export interface ReportDoc { kind: string; title: string; subtitle: string; sections: Section[]; footer?: string }

const hasContent = (s: Section) => s.blocks.some((b) => (b.type === "list" ? b.items.length > 0 : b.type === "table" ? b.rows.length > 0 : b.type === "stats" ? b.items.length > 0 : !!b.text));

/** Plain text: headings in caps, '- ' bullets. */
export function toText(d: ReportDoc) {
  const out: string[] = [d.title, d.subtitle, ""];
  for (const s of d.sections) {
    out.push(s.heading.toUpperCase());
    if (!hasContent(s)) { out.push(s.empty ?? "Nothing to report.", ""); continue; }
    for (const b of s.blocks) {
      if (b.type === "p" || b.type === "pre") out.push(b.text);
      else if (b.type === "list") b.items.forEach((it, i) => out.push(`${b.ordered ? `${i + 1}.` : "-"} ${it.text}${it.meta ? ` (${it.meta})` : ""}`));
      else if (b.type === "stats") out.push(b.items.map((x) => `${x.label}: ${x.value}`).join(" · "));
      else if (b.type === "table") { out.push(b.columns.join(" | ")); for (const r of b.rows) out.push(r.join(" | ")); }
    }
    out.push("");
  }
  if (d.footer) out.push(d.footer);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** WhatsApp: *bold* headings, • bullets, no tables (rows become bullets). */
export function toWhatsApp(d: ReportDoc) {
  const out: string[] = [`*${d.title}*`, `_${d.subtitle}_`, ""];
  const clean = (s: string) => s.replace(/\*/g, "");
  for (const s of d.sections) {
    out.push(`*${clean(s.heading)}*`);
    if (!hasContent(s)) { out.push(s.empty ?? "Nothing to report.", ""); continue; }
    for (const b of s.blocks) {
      if (b.type === "p") out.push(clean(b.text));
      else if (b.type === "pre") out.push(b.text);
      else if (b.type === "list") b.items.forEach((it, i) => out.push(`${b.ordered ? `${i + 1}.` : "•"} ${clean(it.text)}${it.meta ? ` — ${clean(it.meta)}` : ""}`));
      else if (b.type === "stats") for (const x of b.items) out.push(`• ${x.label}: *${clean(x.value)}*`);
      else if (b.type === "table") for (const r of b.rows) out.push(`• *${clean(r[0])}* — ${r.slice(1).map((c, i) => `${b.columns[i + 1]}: ${clean(c)}`).join(", ")}`);
    }
    out.push("");
  }
  if (d.footer) out.push(`_${d.footer}_`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
