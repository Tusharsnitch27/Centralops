// Week of the month as the S&OP workbook counts it: Monday-start weeks cut at the month boundary
// (Wk_01 = the 1st → first Sunday; a month can have Wk_05 or Wk_06).
export function weekOfMonth(day: string) {
  const d = Number(day.slice(8, 10));
  const first = new Date(`${day.slice(0, 8)}01T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const toMonday = (8 - first) % 7; // days from the 1st to the first Monday (0 when the 1st is a Monday)
  const wk = toMonday === 0 ? Math.ceil(d / 7) : d <= toMonday ? 1 : 1 + Math.ceil((d - toMonday) / 7);
  return `Wk_${String(wk).padStart(2, "0")}`;
}

/**
 * Days a projection-sheet week covers (the sheet's weeks are not the calendar weeks above): a 4-week month is 1–7, 8–15, 16–23,
 * 24 → month end; with 5 weeks they are 7-day blocks (1–7 … 22–28) and the 5th runs to month end.
 */
export function sheetWeekDays(period: string, week: number, weeks: number): string[] {
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const starts = weeks <= 4 ? [1, 8, 16, 24] : Array.from({ length: weeks }, (_, i) => 7 * i + 1);
  const a = starts[week - 1], b = week >= weeks ? last : (starts[week] ?? last + 1) - 1;
  if (a == null || a > last) return [];
  return Array.from({ length: Math.min(b, last) - a + 1 }, (_, i) => `${period.slice(0, 8)}${String(a + i).padStart(2, "0")}`);
}
