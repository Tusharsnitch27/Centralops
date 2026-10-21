// Task links: pulled out of typed text, labelled by where they point.
export interface TaskLink { url: string; label: string }
export const URL_RE = /\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/gi;

export function linkLabel(url: string) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "docs.google.com") return u.pathname.startsWith("/spreadsheets") ? "Google Sheet" : u.pathname.startsWith("/presentation") ? "Google Slides" : u.pathname.startsWith("/forms") ? "Google Form" : "Google Doc";
    if (h === "drive.google.com") return "Drive file";
    if (h.endsWith("slack.com")) return "Slack";
    if (h.endsWith("notion.so") || h.endsWith("notion.site")) return "Notion";
    if (h.endsWith("snitch-workflow.com")) return h.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
    return h;
  } catch { return url; }
}
/** Split URLs out of text. */
export function extractLinks(text: string): { text: string; links: TaskLink[] } {
  const links: TaskLink[] = [];
  const rest = text.replace(URL_RE, (u) => { if (!links.some((l) => l.url === u)) links.push({ url: u, label: linkLabel(u) }); return " "; });
  return { text: rest.replace(/\s+/g, " ").trim(), links };
}
export const cleanLinks = (ls: TaskLink[]) => ls
  .map((l) => ({ url: l.url.trim(), label: l.label.trim() }))
  .filter((l) => /^https?:\/\/\S+$/i.test(l.url))
  .map((l) => ({ url: l.url, label: l.label || linkLabel(l.url) }))
  .slice(0, 20);
