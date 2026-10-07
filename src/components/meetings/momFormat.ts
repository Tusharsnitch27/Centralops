// MoM sections <-> plain text. The stored MoM is plain text with "## Section" headings so free-text pastes and
// structured writing round-trip, and the extractor understands both.
export const MOM_SECTIONS = [
  { key: "agenda", label: "Agenda", hint: "What was on the table", placeholder: "1. Tunnel install status\n2. Handheld demo results" },
  { key: "notes", label: "Notes", hint: "Paste anything — free text works", placeholder: "Paste your notes, a WhatsApp summary or the doc you wrote during the meeting…" },
  { key: "discussion", label: "Discussion points", hint: "Key points raised", placeholder: "- Reads at 92% vs 98% target\n- Wave 1 store list is ready" },
  { key: "decisions", label: "Decisions", hint: "What was agreed", placeholder: "- Go ahead with wave 1 in November even if the tunnel slips" },
  { key: "actions", label: "Action items", hint: "Person to do X by date", placeholder: "- Nitin to re-test tunnel reads by next Wednesday\n- Faisal to integrate handheld counts by 25th" },
  { key: "blockers", label: "Blockers & risks", hint: "What could slip", placeholder: "- Tag supply lead time is 4 weeks; Diwali rush could delay wave 2" },
] as const;
export type MomSectionKey = (typeof MOM_SECTIONS)[number]["key"];
export type MomSections = Record<MomSectionKey, string>;

export const emptySections = (): MomSections => ({ agenda: "", notes: "", discussion: "", decisions: "", actions: "", blockers: "" });

export function composeMom(s: MomSections): string {
  return MOM_SECTIONS.filter((x) => s[x.key]?.trim()).map((x) => `## ${x.label}\n${s[x.key].trim()}`).join("\n\n");
}

/** Split stored text back into sections. Text without our headings lands in Notes. */
export function parseMom(body: string): { sections: MomSections; structured: boolean } {
  const out = emptySections();
  const rx = new RegExp(`^##\\s*(${MOM_SECTIONS.map((x) => x.label.replace(/[&]/g, "\\&")).join("|")})\\s*$`, "gmi");
  const marks = [...body.matchAll(rx)];
  if (!marks.length) { out.notes = body.trim(); return { sections: out, structured: false }; }
  const lead = body.slice(0, marks[0].index).trim();
  if (lead) out.notes = lead;
  marks.forEach((m, i) => {
    const sec = MOM_SECTIONS.find((x) => x.label.toLowerCase() === m[1].toLowerCase())!;
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const text = body.slice((m.index ?? 0) + m[0].length, end).trim();
    out[sec.key] = out[sec.key] ? `${out[sec.key]}\n${text}` : text;
  });
  return { sections: out, structured: true };
}
