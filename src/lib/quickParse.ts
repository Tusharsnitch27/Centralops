// Natural-language quick add: "Share VM guidelines with stores @rohan fri !high #retail"
//   @person · #tag · !urgent|!high|!low · dates: today, tomorrow, mon..sun, "next week", "in 3 days", "15 oct", "oct 15"
import { addDays, today } from "./dates";

export interface Parsed { title: string; owner?: string; tags: string[]; priority?: "urgent" | "high" | "medium" | "low"; due?: string; dueLabel?: string }

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseQuick(input: string, ref = today()): Parsed {
  let s = ` ${input} `;
  const out: Parsed = { title: "", tags: [] };
  s = s.replace(/\s@([\w.]+)/g, (_, n) => { out.owner = n; return " "; });
  s = s.replace(/\s#([\w-]+)/g, (_, t) => { out.tags.push(t.toLowerCase()); return " "; });
  s = s.replace(/\s!(urgent|high|med|medium|low|p0|p1|p2|p3)\b/gi, (_, p: string) => {
    const k = p.toLowerCase();
    out.priority = k === "p0" || k === "urgent" ? "urgent" : k === "p1" || k === "high" ? "high" : k === "low" || k === "p3" ? "low" : "medium";
    return " ";
  });
  const setDue = (d: string, label: string) => { out.due = d; out.dueLabel = label; return " "; };
  const refDow = new Date(`${ref}T00:00:00Z`).getUTCDay();
  s = s.replace(/\s(?:by |due |on )?(today|tod|tomorrow|tmrw|tmr)\b/i, (_, w: string) => (w.toLowerCase().startsWith("tod") ? setDue(ref, "Today") : setDue(addDays(ref, 1), "Tomorrow")));
  s = s.replace(/\s(?:by |due |on )?in (\d{1,3}) (day|days|week|weeks)\b/i, (_, n: string, u: string) => setDue(addDays(ref, Number(n) * (u.startsWith("week") ? 7 : 1)), `In ${n} ${u}`));
  s = s.replace(/\s(?:by |due )?(next week|eow|end of week)\b/i, (_, w: string) =>
    w.toLowerCase() === "next week" ? setDue(addDays(ref, ((8 - refDow) % 7) || 7), "Next Monday") : setDue(addDays(ref, (5 - refDow + 7) % 7), "Friday"));
  s = s.replace(/\s(?:by |due |on )?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, (m, d: string) => {
    const idx = DOW.indexOf(d.toLowerCase().slice(0, 3));
    const delta = ((idx - refDow + 7) % 7) || 7;
    return setDue(addDays(ref, delta), d[0].toUpperCase() + d.slice(1, 3).toLowerCase());
  });
  s = s.replace(/\s(?:by |due |on )?(\d{1,2})\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\s(?:by |due |on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?(\d{1,2})\b/i,
    (_m, d1, m1, m2, d2) => {
      const day = Number(d1 ?? d2), mon = MONTHS.indexOf(String(m1 ?? m2).toLowerCase());
      let y = Number(ref.slice(0, 4));
      let iso = `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso < ref) { y += 1; iso = `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
      return setDue(iso, `${day} ${MONTHS[mon][0].toUpperCase()}${MONTHS[mon].slice(1)}`);
    });
  out.title = s.replace(/\s+/g, " ").trim();
  return out;
}
