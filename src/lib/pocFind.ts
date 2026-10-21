// Find the point of contact in a typed task. Pure (runs in the browser for live preview and on the server).
//  1. a team member mentioned anywhere — full name, first + last, or a first name only one person has (case-insensitive)
//  2. otherwise anyone after with / ask / via / from / poc / owner / assign to — "Rahul from Delhivery" → "Rahul (Delhivery)"
export interface PocPerson { id: string; name: string }
export interface PocHit { name: string; personId: string | null; phrase: string }

const STOP = new Set(["the", "this", "next", "end", "eod", "eow", "eom", "today", "tomorrow", "tmrw", "week", "month", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec", "team", "all", "everyone", "me", "us", "them", "him", "her",
  "a", "an", "and", "or", "to", "for", "on", "by", "in", "at", "of", "asap", "regarding", "re", "about"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const SKIP = /^(mohd|md|mohammad|mr|ms|e)$/i;

export function findPoc(raw: string, people: PocPerson[]): PocHit | null {
  const text = ` ${raw} `;
  // 1 · directory people, longest alias first
  const firstCount = new Map<string, number>();
  const firstOf = (n: string) => n.toLowerCase().split(/\s+/).find((t) => t.replace(/\./g, "").length > 1 && !SKIP.test(t)) ?? "";
  for (const p of people) { const f = firstOf(p.name); firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
  const aliases: { re: RegExp; p: PocPerson; len: number }[] = [];
  for (const p of people) {
    const parts = p.name.toLowerCase().split(/\s+/).filter((t) => t.replace(/\./g, "").length > 1 && !SKIP.test(t));
    const forms = new Set([p.name.toLowerCase(), parts.join(" "), parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : ""]);
    if (parts[0] && parts[0].length > 2 && firstCount.get(parts[0]) === 1) forms.add(parts[0]);
    for (const f of forms) if (f) aliases.push({ re: new RegExp(`(?:^|[\\s@(,])((?:with|ask|via|from|poc:?|owner:?|assign(?:ed)? to|cc)\\s+)?@?(${esc(f)})(?=$|[\\s,.;:)!?'’])`, "i"), p, len: f.length });
  }
  aliases.sort((a, b) => b.len - a.len);
  for (const a of aliases) {
    const m = a.re.exec(text);
    if (m) return { name: a.p.name, personId: a.p.id, phrase: `${m[1] ?? ""}${m[0].includes("@") ? "@" : ""}${m[2]}`.trim() };
  }
  // 2 · outside the directory: name after a trigger word (any case), optional "from/at/of Company"
  const m = /(?:^|\s)(with|ask|via|from|poc:?|owner:?|assign(?:ed)? to|@)\s*((?:[A-Za-z][\w&.'’-]*\s*){1,6})/i.exec(text);
  if (m) {
    const words = m[2].trim().split(/\s+/);
    const name: string[] = [];
    let i = 0;
    for (; i < words.length && name.length < 3; i++) {
      const w = words[i].replace(/[’']s$/i, "");
      if (STOP.has(w.toLowerCase()) || /^(from|at|of)$/i.test(w)) break;
      name.push(w);
    }
    if (name.length) {
      let company: string | null = null;
      if (/^(from|at|of)$/i.test(words[i] ?? "") && words[i + 1] && !STOP.has(words[i + 1].toLowerCase())) {
        const c = [words[i + 1]];
        if (words[i + 2] && /^[A-Z]/.test(words[i + 2]) && !STOP.has(words[i + 2].toLowerCase())) c.push(words[i + 2]);
        company = c.join(" ");
      }
      const phrase = `${m[1]} ${name.join(" ")}${company ? ` ${words[i]} ${company}` : ""}`.replace(/^@ /, "@");
      return { name: company ? `${title(name.join(" "))} (${title(company)})` : title(name.join(" ")), personId: null, phrase };
    }
  }
  return null;
}
