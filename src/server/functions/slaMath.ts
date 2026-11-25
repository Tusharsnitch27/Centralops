// SLA maths for the Functions pointers (Malhar, 25 Nov 2026; pure — scripts/check-functions.mjs runs it). The ideal heads are not touched here:
// these size a team at the projected average day and show what it costs and which SLA it would miss.

/** Heads on the floor for the month's average projected day. */
export const projectionTeam = (avgProjectedDay: number | null, uph: number | null) => (avgProjectedDay == null || !uph ? null : avgProjectedDay / uph);

/** ₹ of a team over some days at the month's salary per head (salary ÷ 23 working days per head-day). */
export const teamRupees = (heads: number | null, days: number, salary: number | null) => (heads == null || salary == null ? null : (heads * days * salary) / 23);

/**
 * Day by day with a fixed daily capacity: arrivals queue, each day clears up to capacity oldest first; units still open after their TAT
 * (tatDays whole days after arrival) count once as breaches. Days with unknown volume or capacity are skipped (no arrival, no clearing).
 * exceedDays = days whose arrivals were above that day's capacity.
 */
export function simulateBacklog(days: { day: string; volume: number | null; capacity: number | null }[], tatDays: number) {
  const queue: { age: number; units: number }[] = [];
  let exceedDays = 0, breachUnits = 0, total = 0;
  for (const d of days) {
    if (d.volume == null || d.capacity == null) continue;
    total += d.volume;
    if (d.volume > d.capacity) exceedDays++;
    if (d.volume > 0) queue.push({ age: 0, units: d.volume });
    let cap = d.capacity;
    while (cap > 0 && queue.length) { const q = queue[0]!, take = Math.min(cap, q.units); q.units -= take; cap -= take; if (q.units <= 0) queue.shift(); }
    for (const q of queue) q.age++;
    while (queue.length && queue[0]!.age > tatDays) breachUnits += queue.shift()!.units; // missed: counted once, no longer queued
  }
  return { exceedDays, breachUnits, total };
}

/** Heads to clear every unit within the TAT: the busiest run of tatDays + 1 known days, averaged, ÷ units per head (TAT 0 = the peak day). */
export function tatHeads(volumes: (number | null)[], tatDays: number, uph: number | null) {
  const v = volumes.filter((x): x is number => x != null), w = tatDays + 1;
  if (!uph || !v.length) return null;
  let best = 0;
  for (let i = 0; i + Math.min(w, v.length) <= v.length; i++) { const run = v.slice(i, i + w); best = Math.max(best, run.reduce((a, x) => a + x, 0) / run.length); }
  return best / uph;
}

/** On-time share: Σ within ÷ Σ judged over rows where both are known; null when nothing is judged. */
export function slaShare(rows: { within: number | null; judged: number | null }[]) {
  const ok = rows.filter((r) => r.within != null && r.judged != null);
  const judged = ok.reduce((a, r) => a + r.judged!, 0), within = ok.reduce((a, r) => a + r.within!, 0);
  return judged ? { pct: (100 * within) / judged, judged } : { pct: null, judged: null };
}
