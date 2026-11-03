import "server-only";
import { addMonths } from "@/lib/dates";
import { dayLabels, isDayLabel, MONTH_ONLY_STREAMS, weekLabels, weekSortKey, type Stream } from "./model";
import { getLines, getValues } from "./queries";

export async function getStreamMonthForm(stream: Stream, period: string) {
  const prevP = addMonths(period, -1);
  const [lines, values] = await Promise.all([getLines(stream.id), getValues(stream.id, prevP, period)]);
  const here = values.filter((v) => v.period === period);
  let labels = [""];
  const monthOnly = !!stream.code && MONTH_ONLY_STREAMS.has(stream.code);
  if (monthOnly) labels = [`${period.slice(0, 7)}-01`];
  else if (stream.granularity === "day") labels = dayLabels(period);
  else if (stream.granularity === "week") {
    const existing = [...new Set(here.map((v) => v.period_label).filter(Boolean))].sort((a, b) => weekSortKey(a) - weekSortKey(b));
    // keep the stored labels, fill the missing week numbers with defaults so every week of the month can be entered
    const have = new Set(existing.map(weekSortKey));
    labels = [...existing, ...weekLabels(period).filter((l) => !have.has(weekSortKey(l)))].sort((a, b) => weekSortKey(a) - weekSortKey(b));
  }
  const dims = stream.dimensions?.length ? stream.dimensions : [];
  const cells: Record<string, { projection: number | null; revised: number | null; actual: number | null; demo: boolean }> = {};
  for (const v of here) {
    // month-only streams: whatever days hold a value add up into the month total (on the 1st)
    const label = monthOnly && isDayLabel(v.period_label) ? labels[0]! : v.period_label;
    const k = `${v.line_id}|${label}|${v.dimension}`, c = cells[k];
    const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
    cells[k] = c && monthOnly
      ? { projection: add(c.projection, v.projection), revised: c.revised != null || v.revised_projection != null ? add(c.revised ?? c.projection, v.revised_projection ?? v.projection) : null, actual: add(c.actual, v.actual), demo: c.demo || v.actual_source === "demo" }
      : { projection: v.projection, revised: v.revised_projection, actual: v.actual, demo: v.actual_source === "demo" };
  }
  const prev: Record<string, number | null> = {};
  for (const v of values.filter((x) => x.period === prevP)) {
    const k = `${v.line_id}|${v.dimension}`;
    prev[k] = (prev[k] ?? 0) + (v.revised_projection ?? v.projection ?? 0);
  }
  // category inward lines read A → Z
  const ordered = stream.code === "inbound-category-wise" ? [...lines].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })) : lines;
  return { monthOnly, lines: ordered.map((l) => ({ id: l.id, name: l.name, metric: l.metric })), labels, dims: dims.length ? dims : [""], cells, prev };
}

