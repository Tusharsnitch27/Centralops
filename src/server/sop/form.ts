import "server-only";
import { addMonths } from "@/lib/dates";
import { dayLabels, weekLabels, weekSortKey, type Stream } from "./model";
import { getLines, getValues } from "./queries";

export async function getStreamMonthForm(stream: Stream, period: string) {
  const prevP = addMonths(period, -1);
  const [lines, values] = await Promise.all([getLines(stream.id), getValues(stream.id, prevP, period)]);
  const here = values.filter((v) => v.period === period);
  let labels = [""];
  if (stream.granularity === "day") labels = dayLabels(period);
  else if (stream.granularity === "week") {
    const existing = [...new Set(here.map((v) => v.period_label).filter(Boolean))].sort((a, b) => weekSortKey(a) - weekSortKey(b));
    // keep the stored labels, fill the missing week numbers with defaults so every week of the month can be entered
    const have = new Set(existing.map(weekSortKey));
    labels = [...existing, ...weekLabels(period).filter((l) => !have.has(weekSortKey(l)))].sort((a, b) => weekSortKey(a) - weekSortKey(b));
  }
  const dims = stream.dimensions?.length ? stream.dimensions : [];
  const cells: Record<string, { projection: number | null; revised: number | null; actual: number | null; demo: boolean }> = {};
  for (const v of here) cells[`${v.line_id}|${v.period_label}|${v.dimension}`] = { projection: v.projection, revised: v.revised_projection, actual: v.actual, demo: v.actual_source === "demo" };
  const prev: Record<string, number | null> = {};
  for (const v of values.filter((x) => x.period === prevP)) {
    const k = `${v.line_id}|${v.dimension}`;
    prev[k] = (prev[k] ?? 0) + (v.revised_projection ?? v.projection ?? 0);
  }
  return { lines: lines.map((l) => ({ id: l.id, name: l.name, metric: l.metric })), labels, dims: dims.length ? dims : [""], cells, prev };
}

