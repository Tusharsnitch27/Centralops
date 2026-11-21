import "server-only";
import { q } from "../db";
import { addDays, today, weekStart } from "@/lib/dates";
import { parseTarget, ROLE_STAGES } from "./ops";

/**
 * Weekly productivity per process × site (13.4 #2, Maddy: IPP ≥ 8 % QoQ) for S&OP › Productivity › By process.
 *  units per man-hour = stage output (wcm_stage_output, feed event of the stage's IPP row) ÷ man-hours
 *  man-hours          = DE deployed on the stage (wcm_deploy) × shift hours (Day 9 h; Night 8 h South, 9 h North — Malhar 21 Nov)
 *  % of IPP           = output ÷ (DE × the IPP in effect that day)
 *  role-measured      = share of the stage's DE that people with a matching attendance role cover (ROLE_STAGES); the rest is
 *                       placed by workload (Unclassified), which reads ≈ IPP by construction — those rows are shown, not ranked.
 *                       Pick stages aren't ranked either (pick scans are partly captured upstream).
 *  idle               = planner idle lines (reason-coded) ÷ present man-hours. OT % stays open until the attendance /ot endpoint
 *                       is deployed (mp_ot_daily empty) — decision 21 Nov 2026.
 */
export const SHIFT_HOURS = (site: string, shift: string) => (shift === "Night" ? (site === "North" ? 9 : 8) : 9);
const FROM = "2026-10-29"; // deployment (wcm_deploy) starts with the attendance role feed

export interface ProcWeek { week: string; partial: boolean; de: number; hours: number; output: number | null; uph: number | null; pctIpp: number | null; measured: number | null }
export interface ProcRow { site: string; stream: string; stage: string; homeFn: string | null; ipp: number | null; feed: string | null; weeks: ProcWeek[]; change: number | null; bottom: boolean }
export interface SiteWeek { site: string; week: string; presentHours: number; stageHours: number; idleHours: number; partial: boolean }

export async function processProductivity(nWeeks = 6) {
  const to = today(), from = [FROM, addDays(weekStart(to), -7 * (nWeeks - 1))].sort().at(-1)!;
  const [dep, pools, out, ipps, roles] = await Promise.all([
    q<{ day: string; site: string; home_fn: string; shift: string; target: string; de: number }>(
      `select day::text as day, site, home_fn, shift, target, de::float8 as de from wcm_deploy where day >= $1::date and day <= $2::date`, [from, to]),
    q<{ day: string; site: string; shift: string; de: number }>(
      `select day::text as day, site, shift, sum(available_de)::float8 as de from wcm_deploy_day where day >= $1::date and day <= $2::date group by 1, 2, 3`, [from, to]),
    q<{ day: string; site: string; stream: string; event: string; qty: number }>(
      `select day::text as day, site, stream, event, qty::float8 as qty from wcm_stage_output where day >= $1::date and day <= $2::date`, [from, to]),
    q<{ site: string; stream: string; stage: string; home_fn: string | null; ipp: number | null; feed: string | null; version: string; eff: string }>(
      `select site, stream, stage, home_fn, ipp::float8 as ipp, feed, version, effective_from::text as eff from wcm_ipp where status = 'active' and unit = 'unit'`),
    q<{ day: string; site: string; func: string; role: string; de: number }>(
      `select day::text as day, case site when 'NORTH' then 'North' else 'South' end as site, func, role, sum(de)::float8 as de
       from mp_role_daily where day >= $1::date and day <= $2::date group by 1, 2, 3, 4`, [from, to]),
  ]);
  // IPP in effect per site × day: the latest active version effective by then (as activeIpps)
  const versions = new Map<string, { v: string; eff: string }[]>();
  for (const r of ipps) { const l = versions.get(r.site) ?? []; if (!l.some((x) => x.v === r.version)) l.push({ v: r.version, eff: r.eff }); versions.set(r.site, l); }
  for (const l of versions.values()) l.sort((a, b) => b.eff.localeCompare(a.eff) || b.v.localeCompare(a.v));
  const ippOn = (site: string, day: string, stream: string, stage: string) => {
    const v = versions.get(site)?.find((x) => x.eff <= day)?.v;
    return ipps.find((r) => r.site === site && r.version === v && r.stream === stream && r.stage === stage) ?? null;
  };
  const outOf = new Map(out.map((o) => [`${o.day}|${o.site}|${o.stream}|${o.event}`, o.qty]));
  const roleDe = new Map<string, number>(); // site|week|func|stage → DE of people whose role works that stage
  for (const r of roles) for (const st of ROLE_STAGES[r.role] ?? []) { const k = `${r.site}|${weekStart(r.day)}|${r.func}|${st}`; roleDe.set(k, (roleDe.get(k) ?? 0) + r.de); }

  type Acc = { de: number; hours: number; out: number; outKnown: boolean; cap: number; ipp: number | null; feed: string | null; homeFn: string; days: Set<string> };
  const acc = new Map<string, Acc>(), stageDe = new Map<string, number>();
  const siteW = new Map<string, SiteWeek>();
  const sw = (site: string, week: string) => siteW.get(`${site}|${week}`) ?? (siteW.set(`${site}|${week}`, { site, week, presentHours: 0, stageHours: 0, idleHours: 0, partial: false }), siteW.get(`${site}|${week}`)!);
  for (const p of pools) sw(p.site, weekStart(p.day)).presentHours += p.de * SHIFT_HOURS(p.site, p.shift);
  // output per stage-day counted once, however many shift lines the stage has that day
  const counted = new Set<string>();
  for (const d of dep) {
    const t = parseTarget(d.target), week = weekStart(d.day), h = d.de * SHIFT_HOURS(d.site, d.shift);
    if (t?.kind === "idle") { sw(d.site, week).idleHours += h; continue; }
    if (t?.kind !== "stage") continue;
    sw(d.site, week).stageHours += h;
    const ipp = ippOn(d.site, d.day, t.stream, t.stage), k = `${d.site}|${t.stream}|${t.stage}|${week}`;
    const a = acc.get(k) ?? { de: 0, hours: 0, out: 0, outKnown: false, cap: 0, ipp: ipp?.ipp ?? null, feed: ipp?.feed ?? null, homeFn: d.home_fn, days: new Set<string>() };
    a.de += d.de; a.hours += h; a.days.add(d.day);
    if (ipp?.ipp) a.cap += d.de * ipp.ipp;
    const ok = `${d.day}|${d.site}|${t.stream}|${ipp?.feed}`;
    if (ipp?.feed && !counted.has(ok)) { counted.add(ok); const v = outOf.get(ok); if (v != null) { a.out += v; a.outKnown = true; } }
    acc.set(k, a);
    const sk = `${d.site}|${week}|${d.home_fn}|${t.stage}`; stageDe.set(sk, (stageDe.get(sk) ?? 0) + d.de);
  }
  const weeks: string[] = [];
  for (let w = weekStart(from); w <= weekStart(to); w = addDays(w, 7)) weeks.push(w);
  const partialWeek = (w: string) => w < FROM || addDays(w, 6) >= to; // starts before the data, or not over yet
  for (const s of siteW.values()) s.partial = partialWeek(s.week);

  const rows = new Map<string, ProcRow>();
  for (const [k, a] of acc) {
    const [site, stream, stage, week] = k.split("|") as [string, string, string, string];
    const rk = `${site}|${stream}|${stage}`;
    const r = rows.get(rk) ?? { site, stream, stage, homeFn: a.homeFn, ipp: a.ipp, feed: a.feed, weeks: weeks.map((w) => ({ week: w, partial: partialWeek(w), de: 0, hours: 0, output: null, uph: null, pctIpp: null, measured: null })), change: null, bottom: false };
    const wk = r.weeks.find((x) => x.week === week)!;
    const output = a.feed && a.outKnown ? a.out : null;
    const sd = stageDe.get(`${site}|${week}|${a.homeFn}|${stage}`) ?? 0, rd = roleDe.get(`${site}|${week}|${a.homeFn}|${stage}`) ?? 0;
    Object.assign(wk, { de: a.de, hours: a.hours, output, uph: output != null && a.hours ? output / a.hours : null, pctIpp: output != null && a.cap ? output / a.cap : null,
      measured: sd ? Math.min(1, rd / sd) : null });
    if (a.ipp != null) r.ipp = a.ipp;
    rows.set(rk, r);
  }
  const list = [...rows.values()];
  const full = weeks.filter((w) => !partialWeek(w)), last = full.at(-1), first = full[0];
  for (const r of list) {
    const a = r.weeks.find((w) => w.week === first)?.uph, b = r.weeks.find((w) => w.week === last)?.uph;
    r.change = a && b != null && first !== last ? b / a - 1 : null;
  }
  // bottom 10 % (at least one per site) on % of IPP in the last full week, among rows mostly covered by role-tagged people
  if (last) for (const site of ["South", "North"]) {
    const ranked = list.filter((r) => r.site === site).map((r) => ({ r, w: r.weeks.find((w) => w.week === last)! }))
      // pick scans are 48–82 % captured upstream: a data gap, not low output — pick rows aren't ranked
      .filter((x) => x.w.pctIpp != null && (x.w.measured ?? 0) >= 0.5 && x.r.feed !== "picked").sort((a, b) => a.w.pctIpp! - b.w.pctIpp!);
    for (const x of ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.1)))) x.r.bottom = true;
  }
  list.sort((a, b) => a.site.localeCompare(b.site) || (a.homeFn ?? "").localeCompare(b.homeFn ?? "") || a.stream.localeCompare(b.stream) || a.stage.localeCompare(b.stage));
  return { rows: list, sites: [...siteW.values()].sort((a, b) => a.site.localeCompare(b.site) || a.week.localeCompare(b.week)), weeks, lastFull: last ?? null, firstFull: first ?? null };
}
