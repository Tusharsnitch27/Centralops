// SLA headroom replay for AOP › Analysis (client-safe, pure). Replays the judged SLA cells (wcm_sla_cell) hour by hour against
// the capacity present DE gives in each shift, earliest deadline first; work not covered by a cut-off rolls past it and counts
// as predicted late. Run once as it was (fit check against the actual SLA_STATUS / HANDOVER_SLA / tracker outcome) and once
// under the levers. When the fit is weak the UI must not turn the replay into an SLA claim — see `fit`.
//
// Shifts (Malhar, 21 Nov 2026): Day 09:00–18:00 (9 h); Night 21:00–05:00 South (8 h), 21:00–06:00 North (9 h). Night DE is the
// attendance day the shift starts. Work per unit = Σ 1 / IPP over stages with an output feed (IPP per shift); B2B Marketplace
// = 5,000 units per day-shift per warehouse, scaled with B2B Forward heads.

export interface SlaCell { deadline: string; created: string; wh: string; stream: string; func: "B2C Forward" | "B2B Forward"; units: number; late: number }
export interface SlaModel {
  from: string; to: string; mpUnitsPerDay: number; cells: SlaCell[];
  de: { day: string; wh: string; func: string; shift: string; de: number }[];
  work: Record<string, { perUnit: number; stages: string[]; version: string | null } | null>; // key `${site}|${stream}`
  unfed: { site: string; stream: string; stage: string; ipp: number }[];
  salary: Record<string, { monthly: number; isDefault: boolean }>;
}
export interface SlaLevers { volume: number; productivity: number; b2cHeads: number; b2bHeads: number; night: number } // heads / night: fractions (−0.2 = −20 %)
export const BASE_SLA: SlaLevers = { volume: 1, productivity: 1, b2cHeads: 0, b2bHeads: 0, night: 0 };

export interface LaneDay { day: string; units: number; actual: number; pred: number; util: number | null }
export interface Fit { n: number; rho: number | null; ratio: number | null; reliable: boolean; reason: string }
export interface Lane { id: string; label: string; site: string; whs: string[]; func: string; days: LaneDay[]; units: number; actual: number; pred: number; peakUtil: number | null; avgUtil: number | null; noDe: number; missing: string | null }

const siteOf = (wh: string) => (wh === "NORTH" ? "North" : "South");
const H = (s: string) => Date.parse(`${s.replace(" ", "T")}:00Z`) / 36e5; // wall-clock hours since epoch (IST read as-is)
const dayOf = (h: number) => new Date(h * 36e5).toISOString().slice(0, 10);
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Lanes: B2C per warehouse building (own staff), B2B Retail and B2B Marketplace per site (South = WH1 + WH2 pooled). */
function laneOf(c: SlaCell) {
  if (c.func === "B2C Forward") return { id: `B2C|${c.wh}`, label: `B2C · ${c.wh === "NORTH" ? "North" : c.wh}`, site: siteOf(c.wh), whs: c.wh === "NORTH" ? ["NORTH"] : [c.wh] };
  const site = siteOf(c.wh);
  return { id: `${c.stream}|${site}`, label: `${c.stream} · ${site}`, site, whs: site === "North" ? ["NORTH"] : ["WH1", "WH2"] };
}

export function simulate(m: SlaModel, l: SlaLevers): Lane[] {
  const deIdx = new Map<string, number>();
  for (const r of m.de) { const k = `${r.day}|${r.wh}|${r.func}|${r.shift}`; deIdx.set(k, (deIdx.get(k) ?? 0) + r.de); }
  const groups = new Map<string, { meta: ReturnType<typeof laneOf>; func: string; cells: SlaCell[]; missing: Set<string> }>();
  for (const c of m.cells) {
    const meta = laneOf(c), g = groups.get(meta.id) ?? { meta, func: c.func, cells: [], missing: new Set<string>() };
    if (c.stream !== "B2B Marketplace" && !m.work[`${meta.site}|${c.stream}`]) { g.missing.add(c.stream); groups.set(meta.id, g); continue; }
    g.cells.push(c); groups.set(meta.id, g);
  }
  const out: Lane[] = [];
  for (const { meta, func, cells, missing } of groups.values()) {
    const isMp = meta.id.startsWith("B2B Marketplace"), headsF = 1 + (func === "B2C Forward" ? l.b2cHeads : l.b2bHeads);
    const nightLen = meta.site === "North" ? 9 : 8;
    const deOf = (day: string, shift: string) => { let v = 0, any = false; for (const wh of meta.whs) { const x = deIdx.get(`${day}|${wh}|${func}|${shift}`); if (x != null) { v += x; any = true; } } return any ? v : null; };
    const shifted = (day: string) => { // present DE per shift after the heads and day ↔ night levers
      const d = deOf(day, "Day"), n = deOf(day, "Night");
      if (d == null && n == null) return null;
      let dd = (d ?? 0) * headsF, nn = (n ?? 0) * headsF;
      if (l.night > 0) { const mv = dd * l.night; dd -= mv; nn += mv; } else if (l.night < 0) { const mv = nn * -l.night; nn -= mv; dd += mv; }
      return { day: dd, night: nn };
    };
    // capacity per wall-clock hour, in work units (DE-shifts; B2B MP: warehouse-days)
    const capAt = (h: number) => {
      const day = dayOf(h), hd = ((Math.floor(h) % 24) + 24) % 24;
      if (isMp) return hd >= 9 && hd < 18 && shifted(day) ? headsF / 9 : 0;
      if (hd >= 9 && hd < 18) return (shifted(day)?.day ?? 0) / 9;
      if (hd >= 21) return (shifted(day)?.night ?? 0) / nightLen;
      if (hd < nightLen - 3) return ((shifted(addDay(day, -1)) ?? shifted(day))?.night ?? 0) / nightLen; // night started the evening before
      return 0;
    };
    const t0 = H(`${m.from} 00:00`);
    const jobs = cells.map((c) => {
      const wpu = isMp ? 1 / m.mpUnitsPerDay : m.work[`${meta.site}|${c.stream}`]!.perUnit / l.productivity;
      const units = c.units * l.volume;
      return { arrive: Math.max(t0, Math.floor(H(c.created))), due: H(c.deadline), wpu, rem: units * wpu, units, actual: c.late * l.volume, lateUnits: 0, day: c.deadline.slice(0, 10), checked: false };
    }).sort((a, b) => a.arrive - b.arrive);
    const capDay = new Map<string, number>(), workDay = new Map<string, number>();
    const end = Math.max(t0, ...jobs.map((j) => Math.ceil(j.due))) + 1;
    const q: typeof jobs = [];
    let ji = 0;
    for (let h = t0; h < end; h++) {
      while (ji < jobs.length && jobs[ji]!.arrive <= h) { const j = jobs[ji++]!; q.push(j); }
      q.sort((a, b) => a.due - b.due);
      let cap = capAt(h);
      const d = dayOf(h); capDay.set(d, (capDay.get(d) ?? 0) + cap);
      for (const j of q) { if (cap <= 0) break; const use = Math.min(cap, j.rem); j.rem -= use; cap -= use; }
      // ponytail: a deadline is checked at the end of the hour it falls in (≤ 59 min optimistic for MP minute-level TATs)
      for (const j of q) if (!j.checked && h + 1 >= j.due) { j.checked = true; if (j.rem > 1e-9) j.lateUnits = j.rem / j.wpu; }
      for (let i = q.length - 1; i >= 0; i--) if (q[i]!.rem <= 1e-9 && q[i]!.checked) q.splice(i, 1);
    }
    const by = new Map<string, LaneDay>();
    for (const j of jobs) {
      const r = by.get(j.day) ?? { day: j.day, units: 0, actual: 0, pred: 0, util: null };
      r.units += j.units; r.actual += j.actual; r.pred += Math.min(j.lateUnits, j.units);
      workDay.set(j.day, (workDay.get(j.day) ?? 0) + j.units * j.wpu); by.set(j.day, r);
    }
    let noDe = 0;
    const days = [...by.values()].filter((r) => {
      const ok = isMp ? true : shifted(r.day) != null;
      if (!ok) noDe++;
      return ok;
    }).sort((a, b) => a.day.localeCompare(b.day));
    for (const r of days) { const c = capDay.get(r.day) ?? 0; r.util = c > 0 ? (workDay.get(r.day) ?? 0) / c : null; }
    // load ÷ capacity per 7-day block (B2B POs are due on one day but worked over several, so a single day overstates load)
    const weeks = new Map<number, { w: number; c: number }>(), d0 = days[0] ? Date.parse(days[0].day) : 0;
    for (const r of days) { const k = Math.floor((Date.parse(r.day) - d0) / (7 * 864e5)), x = weeks.get(k) ?? { w: 0, c: 0 }; x.w += workDay.get(r.day) ?? 0; x.c += capDay.get(r.day) ?? 0; weeks.set(k, x); }
    const wu = [...weeks.values()].filter((x) => x.c > 0).map((x) => x.w / x.c), tw = [...weeks.values()].reduce((a, x) => ({ w: a.w + x.w, c: a.c + x.c }), { w: 0, c: 0 });
    out.push({ id: meta.id, label: meta.label, site: meta.site, whs: meta.whs, func, days, units: sum(days, "units"), actual: sum(days, "actual"), pred: sum(days, "pred"),
      peakUtil: wu.length ? Math.max(...wu) : null, avgUtil: tw.c > 0 ? tw.w / tw.c : null, noDe,
      missing: missing.size ? `${[...missing].join(", ")}: no IPP stage with an output feed — not replayed` : null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
const sum = (rs: LaneDay[], k: "units" | "actual" | "pred") => rs.reduce((a, r) => a + r[k], 0);

const rank = (a: number[]) => { const s = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]), r: number[] = []; let i = 0;
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1]![0] === s[i]![0]) j++; for (let k = i; k <= j; k++) r[s[k]![1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (x: number[], y: number[]) => { const n = x.length, mx = x.reduce((a, v) => a + v, 0) / n, my = y.reduce((a, v) => a + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sx += (x[i]! - mx) ** 2; sy += (y[i]! - my) ** 2; }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : null; };

/** Gate: reliable only with ≥ 14 days, daily Spearman ρ(predicted, actual late) ≥ 0.6 and predicted total within ±25 % of actual. */
export function fit(lane: Lane): Fit {
  const d = lane.days.slice(1); // first day is warm-up (queue starts empty)
  const n = d.length, rho = n >= 3 ? pearson(rank(d.map((r) => r.pred)), rank(d.map((r) => r.actual))) : null;
  const act = d.reduce((a, r) => a + r.actual, 0), pred = d.reduce((a, r) => a + r.pred, 0), ratio = act ? pred / act : null;
  const reason = n < 14 ? `only ${n} days with judged work and attendance` : act === 0 ? "no actual breaches to fit" : rho == null ? "the replay predicts no day-to-day variation (capacity never binds)"
    : rho < 0.6 ? `predicted late doesn't follow actual (ρ ${rho.toFixed(2)})` : ratio == null || ratio < 0.75 || ratio > 1.25 ? `predicted ${Math.round(pred)} vs actual ${Math.round(act)} late` : "fits history";
  return { n, rho, ratio, reliable: reason === "fits history", reason };
}

// self-check: node --experimental-strip-types src/components/aop/processing/slaSim.ts
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("slaSim.ts")) {
  // one B2C lane, one day: 1,000 lines due 18:00 created 09:00; 1 unit = 1/1000 DE-shift → 1 DE covers it in the day shift
  const mk = (de: number): SlaModel => ({ from: "2026-11-01", to: "2026-11-03", mpUnitsPerDay: 5000,
    cells: [{ deadline: "2026-11-01 18:00", created: "2026-11-01 09:00", wh: "WH2", stream: "B2C Shopify", func: "B2C Forward", units: 1000, late: 0 }],
    de: [{ day: "2026-11-01", wh: "WH2", func: "B2C Forward", shift: "Day", de }], work: { "South|B2C Shopify": { perUnit: 1 / 1000, stages: [], version: null } }, unfed: [], salary: {} });
  const ok = simulate(mk(1), BASE_SLA)[0]!, half = simulate(mk(0.5), BASE_SLA)[0]!, cut = simulate(mk(1), { ...BASE_SLA, b2cHeads: -0.5 })[0]!;
  if (Math.round(ok.pred) !== 0 || Math.abs(ok.peakUtil! - 1) > 1e-9 || Math.abs(ok.avgUtil! - 1) > 1e-9) throw new Error(`slaSim: covered day failed ${JSON.stringify(ok)}`);
  if (Math.round(half.pred) !== 500 || Math.round(cut.pred) !== 500) throw new Error(`slaSim: half capacity should leave 500 late (${half.pred}, ${cut.pred})`);
  // moving all day DE to night leaves nothing before 18:00 → all late
  if (Math.round(simulate(mk(1), { ...BASE_SLA, night: 1 })[0]!.pred) !== 1000) throw new Error("slaSim: night move failed");
  if (fit(ok).reliable) throw new Error("slaSim: a 1-day lane must not fit");
  console.log("slaSim ok");
}
