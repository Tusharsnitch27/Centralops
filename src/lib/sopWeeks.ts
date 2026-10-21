// Week of the month as the S&OP workbook counts it: Monday-start weeks cut at the month boundary
// (Wk_01 = the 1st → first Sunday; a month can have Wk_05 or Wk_06).
export function weekOfMonth(day: string) {
  const d = Number(day.slice(8, 10));
  const first = new Date(`${day.slice(0, 8)}01T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const toMonday = (8 - first) % 7; // days from the 1st to the first Monday (0 when the 1st is a Monday)
  const wk = toMonday === 0 ? Math.ceil(d / 7) : d <= toMonday ? 1 : 1 + Math.ceil((d - toMonday) / 7);
  return `Wk_${String(wk).padStart(2, "0")}`;
}
