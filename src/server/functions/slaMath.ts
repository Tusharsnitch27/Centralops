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

/** An SLA as cumulative tiers: `share` of each day's arrivals cleared within `tatDays` whole days (last tier share 1). "24 h" = [{ share: 1, tatDays: 1 }]. */
export type Tier = { share: number; tatDays: number };
const hrs = (d: number) => (d === 0 ? "same day" : `${d * 24} h`);
export const tierLabel = (t: Tier[]) => (t.length === 1 ? hrs(t[0]!.tatDays)
  : t.map((x, i) => `${Math.round(100 * (x.share - (t[i - 1]?.share ?? 0)))} % ${x.tatDays === 0 ? "same day" : `within ${hrs(x.tatDays)}`}`).join(", "));

/** The SLA table holds each SLA on 95 % of the period's units, as the SLA % is reported (Malhar M, 25 Nov 2026): a peak day's overflow may be the 5 % late. */
export const ON_TIME = 0.95;

/**
 * Heads a day to hold an SLA: the smallest steady daily capacity that, clearing oldest first, gets onTime of the period's units within
 * every tier (binary search; 1 = every unit of every day), ÷ units per head. Unknown days are skipped; after the last day the same capacity
 * keeps clearing with no new arrivals.
 */
export function mixHeads(volumes: (number | null)[], tiers: Tier[], uph: number | null, onTime = 1) {
  const v = volumes.filter((x): x is number => x != null);
  if (!uph || !v.length || !tiers.length) return null;
  const last = Math.max(...tiers.map((t) => t.tatDays)), days = [...v, ...Array<number>(last).fill(0)];
  const ok = (cap: number) => {
    const left = [...days], done = days.map(() => [] as number[]); // done[i][a] = units of day i cleared by age a
    let head = 0; // oldest day with units still open
    for (let d = 0; d < days.length; d++) {
      let c = cap;
      for (let i = head; i <= d && c > 0; i++) { const take = Math.min(c, left[i]!); left[i]! -= take; c -= take; }
      while (head < d && left[head]! <= 0) head++;
      for (let i = Math.max(0, d - last); i <= d; i++) done[i]![d - i] = days[i]! - left[i]!;
    }
    const tot = v.reduce((a, x) => a + x, 0); // each day counts up to its tier's share, so 1 = every day meets it
    return tiers.every((t) => v.reduce((a, x, i) => a + Math.min(done[i]![t.tatDays]!, t.share * x), 0) >= onTime * t.share * tot - 1e-9 * tot);
  };
  let lo = 0, hi = Math.max(...v);
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return Math.round(hi * 1e4) / 1e4 / uph; // capacity to 1/10,000 of a unit: the search's float tail is not a real difference
}

/** On-time share: Σ within ÷ Σ judged over rows where both are known; null when nothing is judged. */
export function slaShare(rows: { within: number | null; judged: number | null }[]) {
  const ok = rows.filter((r) => r.within != null && r.judged != null);
  const judged = ok.reduce((a, r) => a + r.judged!, 0), within = ok.reduce((a, r) => a + r.within!, 0);
  return judged ? { pct: (100 * within) / judged, judged } : { pct: null, judged: null };
}

export interface Pointers {
  sla: { pct: number | null; judged: number | null; missed: number | null; tatDays: number | null };
  actual: { rupees: number | null; perUnit: number | null; heads: number | null };
  /** a team at the projected average day (B2B Marketplace: the 5,000 items a day capacity), on the floor, over the same days */
  team: { heads: number | null; rupees: number | null; perUnit: number | null; saving: number | null } | null;
  /** with that team: days above its capacity and the units that would miss the TAT */
  above: { exceedDays: number; breachUnits: number; total: number; pct: number | null } | null;
  /** heads (and ₹ over the window) to hold each SLA: all within same day … 96 h, plus the function's own tiered SLA where it has one; current = the function's SLA */
  byTat: { label: string; heads: number | null; rupees: number | null; current: boolean }[];
}
type PRow = { day: string; site: string; projected: number | null; received: number | null; processed: number | null; presentHeads: number | null };

/**
 * The cost-reduction pointers for one function over a window (rows: that window's site-days). Per site and month: team = average projected
 * day of the month (whole month: monthRows) ÷ units per head — or capacityPerDay ÷ uph when the function has a fixed capacity; ₹ = team × salary
 * ÷ 23 per day, counted on the days actual heads are known so it compares with actual ₹. Arrivals = received, else processed.
 */
export function pointers(i: {
  rows: PRow[]; monthRows: PRow[]; sites: string[]; uph: (site: string, month: string) => number | null; salary: (site: string, month: string) => number | null;
  tatDays: number | null; tiers?: Tier[] | null; capacityPerDay: number | null; sla: { within: number; judged: number }[]; actual: { rupees: number | null; units: number | null; heads: number | null };
}): Pointers {
  const m7 = (d: string) => d.slice(0, 7);
  const s = slaShare(i.sla);
  const sla = { pct: s.pct, judged: s.judged, missed: s.judged == null ? null : s.judged - i.sla.reduce((a, r) => a + r.within, 0), tatDays: i.tatDays };
  const actual = { rupees: i.actual.rupees, perUnit: i.actual.rupees != null && i.actual.units ? i.actual.rupees / i.actual.units : null, heads: i.actual.heads };
  const avgProj = (site: string, m: string) => { const p = i.monthRows.filter((r) => r.site === site && m7(r.day) === m && r.projected != null).map((r) => r.projected!); return p.length ? p.reduce((a, x) => a + x, 0) / p.length : null; };
  const cap = (site: string, m: string) => i.capacityPerDay ?? avgProj(site, m);
  const teamAt = (site: string, m: string) => projectionTeam(cap(site, m), i.uph(site, m));
  // team ₹ and units on the days actual heads are known; missing team or salary on any such day → no team figure (never a partial ₹)
  const costed = i.rows.filter((r) => r.presentHeads != null);
  let rupees: number | null = costed.length ? 0 : null, units = 0, headDays = 0;
  for (const r of costed) {
    const h = teamAt(r.site, m7(r.day)), sal = i.salary(r.site, m7(r.day));
    if (h == null || sal == null) { rupees = null; break; }
    rupees! += teamRupees(h, 1, sal)!; headDays += h; units += r.processed ?? 0;
  }
  const days = new Set(costed.map((r) => r.day)).size;
  const team = rupees == null ? null : { heads: days ? headDays / days : null, rupees, perUnit: units ? rupees / units : null, saving: actual.rupees == null ? null : actual.rupees - rupees };
  // breaches with that team, per site, then summed
  let above: Pointers["above"] = null as Pointers["above"];
  if (team && (i.tatDays != null || i.capacityPerDay != null)) { // no team shown → no breach line for it
    above = { exceedDays: 0, breachUnits: 0, total: 0, pct: null };
    for (const site of i.sites) {
      const b = simulateBacklog(i.rows.filter((r) => r.site === site).sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, volume: r.received ?? r.processed, capacity: cap(site, m7(r.day)) })), i.tatDays ?? 0);
      above.exceedDays += b.exceedDays; above.breachUnits += b.breachUnits; above.total += b.total;
    }
    above.pct = above.total ? (100 * above.breachUnits) / above.total : null;
    if (!above.total) above = null; // nothing simulated: unknown, not 0
  }
  // heads by TAT: per site at the window's mean units per head and salary; ₹ over the window's days
  const nDays = days; // the same costed days as the team and actual ₹
  const mean = (f: (site: string, m: string) => number | null, site: string) => { const v = [...new Set(i.rows.filter((r) => r.site === site).map((r) => m7(r.day)))].map((m) => f(site, m)).filter((x): x is number => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  // rows: all within same day … 96 h, and the function's own tiered SLA (between its tiers' rows) when it has more than one tier
  const own = i.tiers ?? (i.tatDays == null ? null : [{ share: 1, tatDays: i.tatDays }]);
  const sets = own == null ? [] : [...[0, 1, 2, 3, 4].map((t) => ({ tiers: [{ share: 1, tatDays: t }], key: t })),
    ...(own.length > 1 ? [{ tiers: own, key: own.at(-1)!.tatDays - 0.5 }] : [])].sort((a, b) => a.key - b.key);
  const byTat = sets.map(({ tiers }) => {
    let heads: number | null = 0, rs: number | null = 0;
    for (const site of i.sites) {
      const h = mixHeads(i.rows.filter((r) => r.site === site).sort((a, b) => a.day.localeCompare(b.day)).map((r) => r.received ?? r.processed), tiers, mean(i.uph, site), ON_TIME), sal = mean(i.salary, site);
      heads = h == null || heads == null ? null : heads + h; rs = h == null || sal == null || rs == null ? null : rs + teamRupees(h, nDays, sal)!;
    }
    return { label: tierLabel(tiers), heads, rupees: rs, current: tierLabel(tiers) === tierLabel(own!) };
  });
  return { sla, actual, team, above, byTat };
}

/**
 * Pre-pack ROI over some site-months: inward — pieces in pre-pack and solid ASNs and their gate → putaway hours (piece-weighted over the monthly
 * medians; elapsed time, not labour); retail — pre-pack packs and the pieces they carried, and the saving of handling a pack once instead of
 * each piece: (pieces − packs) ÷ units per head × salary ÷ 23 — the caller passes the per-piece stages' units per head (B2B Retail: Picker + Packer).
 */
export function prepackRoi(rows: { month: string; site: string; kind: string; hours: number | null; pieces: number | null; packs: number | null }[],
  uph: (site: string, month: string) => number | null, salary: (site: string, month: string) => number | null) {
  const w = (kind: string) => { const r = rows.filter((x) => x.kind === kind && x.pieces); const p = r.reduce((a, x) => a + x.pieces!, 0);
    const hr = r.filter((x) => x.hours != null); const hp = hr.reduce((a, x) => a + x.pieces!, 0);
    return { pieces: r.length ? p : null, hours: hp ? hr.reduce((a, x) => a + x.hours! * x.pieces!, 0) / hp : null }; };
  const pp = w("inward_pp"), solid = w("inward_solid");
  const rt = rows.filter((x) => x.kind === "retail_pp" && x.pieces != null && x.packs != null);
  let saving: number | null = rt.length ? 0 : null;
  for (const r of rt) { const u = uph(r.site, r.month.slice(0, 7)), s = salary(r.site, r.month.slice(0, 7)); if (!u || s == null) { saving = null; break; } saving! += ((r.pieces! - r.packs!) / u) * (s / 23); }
  return { inward: { ppPieces: pp.pieces, ppHours: pp.hours, solidPieces: solid.pieces, solidHours: solid.hours },
    retail: { pieces: rt.length ? rt.reduce((a, x) => a + x.pieces!, 0) : null, packs: rt.length ? rt.reduce((a, x) => a + x.packs!, 0) : null, saving } };
}
