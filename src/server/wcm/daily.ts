import "server-only";
import { one, q, tx } from "../db";
import { canManage, type User } from "../auth";
import { autoSplit, HOME_FNS, parseTarget, stageKey, stageKpi, type OpsSite, type StageKpi } from "./ops";

/** Planning rights for a site: admins / PMs everywhere; site leads (wcm_site_lead) for their own site. */
export async function canPlanSite(u: Pick<User, "id" | "role">, site: OpsSite) {
  if (canManage(u)) return true;
  return !!(await one(`select 1 from wcm_site_lead where user_id = $1 and site = $2`, [u.id, site]));
}

export const deployDays = async () =>
  (await q<{ d: string }>(`select distinct day::text as d from mp_daily order by 1 desc limit 60`)).map((r) => r.d);

export const poolKey = (fn: string, shift: string) => `${fn}|${shift}`;
/**
 * Present day-equivalents per home function × shift for a site × day (facilities via mp_site_map, functions via mp_func_map).
 * Uses the attendance shift split (Day / Night) when it was captured for that day; otherwise one "All" pool per function.
 */
export async function availableDe(day: string, site: OpsSite) {
  const join = `join mp_site_map sm on sm.site = d.site and sm.warehouse = $2 join mp_func_map fm on fm.func = d.func and fm.department is not null where d.day = $1`;
  let rows = await q<{ fn: string; shift: string; de: number }>(`select fm.department as fn, d.shift, sum(d.heads)::float8 as de from mp_daily_shift d ${join} group by 1, 2`, [day, site]);
  if (!rows.length) rows = await q(`select fm.department as fn, 'All' as shift, sum(d.heads)::float8 as de from mp_daily d ${join} group by 1, 2`, [day, site]);
  return new Map(rows.map((r) => [poolKey(r.fn, r.shift), r.de]));
}

export interface IppRow { stream: string; stage: string; home_fn: string | null; unit: string; ipp: number | null; feed: string | null; version: string; verified: boolean; sort: number }
export async function activeIpps(day: string, site: OpsSite) {
  // the latest active version in effect that day, and only its stages (a stage a newer version dropped is not carried forward)
  return q<IppRow>(`with v as (select version from wcm_ipp where site = $1 and status = 'active' and effective_from <= $2 order by effective_from desc, version desc limit 1)
    select stream, stage, home_fn, unit, ipp::float8 as ipp, feed, version, verified, sort from wcm_ipp
    where site = $1 and status = 'active' and version = (select version from v) order by sort`, [site, day]);
}

export interface PoolView { homeFn: string; shift: string; available: number; revision: number; lines: { target: string; de: number; reason: string | null }[]; updatedBy: string | null; updatedAt: string | null;
  source: "auto" | "lead" | null; roles: { role: string; de: number }[] }
export interface StageView extends StageKpi { stream: string; stage: string; homeFn: string | null; unit: string; ipp: number | null; verified: boolean; version: string; feed: string | null; output: number | null; de: number; target: string }

export async function dailyView(day: string, site: OpsSite) {
  const [avail, ipps, out, days, lines, roles] = await Promise.all([
    availableDe(day, site), activeIpps(day, site),
    q<{ stream: string; event: string; qty: number; fetched_at: string }>(`select stream, event, qty::float8 as qty, fetched_at::text from wcm_stage_output where day = $1 and site = $2`, [day, site]),
    q<{ home_fn: string; shift: string; available_de: number; revision: number; source: "auto" | "lead"; by: string | null; at: string }>(
      `select d.home_fn, d.shift, d.available_de::float8 as available_de, d.revision, d.source, u.name as by, d.updated_at::text as at from wcm_deploy_day d left join users u on u.id = d.updated_by where d.day = $1 and d.site = $2`, [day, site]),
    q<{ home_fn: string; shift: string; target: string; de: number; reason: string | null }>(`select home_fn, shift, target, de::float8 as de, reason from wcm_deploy where day = $1 and site = $2`, [day, site]),
    rolesOn(day, site),
  ]);
  const keys = [...new Set([...avail.keys(), ...days.map((d) => poolKey(d.home_fn, d.shift))])];
  const order = (k: string) => { const [fn, sh] = k.split("|"); return (HOME_FNS as readonly string[]).indexOf(fn!) * 10 + (sh === "Day" ? 0 : sh === "Night" ? 1 : 2); };
  const pools: PoolView[] = keys.filter((k) => (HOME_FNS as readonly string[]).includes(k.split("|")[0]!)).sort((a, b) => order(a) - order(b)).map((k) => {
    const [f, shift] = k.split("|") as [string, string];
    const d = days.find((x) => x.home_fn === f && x.shift === shift);
    return { homeFn: f, shift, available: avail.get(k) ?? 0, revision: d?.revision ?? 0,
      lines: lines.filter((l) => l.home_fn === f && l.shift === shift).map(({ target, de, reason }) => ({ target, de, reason })),
      updatedBy: d?.by ?? null, updatedAt: d?.at ?? null, source: d?.source ?? null,
      roles: roles.filter((r) => r.fn === f && (shift === "All" || r.shift === shift)).map(({ role, de }) => ({ role, de })) };
  });
  const deBy = new Map<string, number>();
  for (const l of lines) deBy.set(l.target, (deBy.get(l.target) ?? 0) + l.de);
  const outputOf = (stream: string, feed: string | null) => {
    if (!feed) return null;
    const r = out.find((o) => o.stream === stream && o.event === feed);
    return r ? r.qty : out.some((o) => o.event === feed) ? 0 : null; // feed ran for the day but no rows for this stream ⇒ a real zero
  };
  const stages: StageView[] = ipps.sort((a, b) => a.sort - b.sort).map((p) => {
    const target = stageKey(p.stream, p.stage), de = deBy.get(target) ?? 0, output = outputOf(p.stream, p.feed);
    return { stream: p.stream, stage: p.stage, homeFn: p.home_fn, unit: p.unit, ipp: p.ipp, verified: p.verified, version: p.version, feed: p.feed, output, de, target, ...stageKpi(de, p.ipp, output) };
  });
  // feeds with no IPP stage (returns putaway, audit moves, "Other" channel): shown as workload, no KPI
  const unmatched = out.filter((o) => !ipps.some((p) => p.stream === o.stream && p.feed === o.event));
  const totals = pools.reduce((a, p) => {
    const conf = p.lines.reduce((s, l) => s + l.de, 0), idle = p.lines.filter((l) => parseTarget(l.target)?.kind === "idle").reduce((s, l) => s + l.de, 0);
    return { available: a.available + p.available, assigned: a.assigned + conf - idle, idle: a.idle + idle, unassigned: a.unassigned + Math.max(p.available - conf, 0) };
  }, { available: 0, assigned: 0, idle: 0, unassigned: 0 });
  const fetched = out.map((o) => o.fetched_at).sort().at(-1) ?? null;
  return { day, site, pools, stages, unmatched, totals, fetched };
}
export type DailyView = Awaited<ReturnType<typeof dailyView>>;

/** Attendance roles per home function × shift for a site × day (mp_role_daily, post-transfer departments). */
const rolesOn = (day: string, site: OpsSite) => q<{ fn: string; shift: string; role: string; de: number }>(
  `select fm.department as fn, r.shift, r.role, sum(r.de)::float8 as de from mp_role_daily r
     join mp_site_map sm on sm.site = r.site and sm.warehouse = $2 join mp_func_map fm on fm.func = r.func and fm.department is not null
    where r.day = $1 and r.de > 0 group by 1, 2, 3 order by 4 desc`, [day, site]);

/**
 * Write the attendance auto-split for every pool of a site × day that no lead has saved (source 'lead' is never touched).
 * Each changed pool is replaced in its own transaction with a revision bump and a history row (actor = none), so a lead
 * with the page open gets the usual "someone saved this pool" guard. Lookups happen before the transaction (PGlite).
 */
export async function autoDeploy(day: string, site: OpsSite) {
  const v = await dailyView(day, site);
  let written = 0;
  for (const p of v.pools) {
    if (p.source === "lead" || !p.roles.length) continue;
    const fnTotal = v.pools.filter((x) => x.homeFn === p.homeFn).reduce((a, x) => a + x.available, 0), share = fnTotal ? p.available / fnTotal : 0;
    const own = v.stages.filter((s) => s.homeFn === p.homeFn).map((s) => ({ target: s.target, stage: s.stage, required: s.required == null ? null : s.required * share }));
    const { lines } = autoSplit(p.available, p.roles, own);
    const same = (a: { target: string; de: number }[], b: { target: string; de: number }[]) =>
      JSON.stringify(a.map((l) => [l.target, l.de]).sort()) === JSON.stringify(b.map((l) => [l.target, l.de]).sort());
    if ((p.source === null && !lines.length) || (p.source === "auto" && same(p.lines, lines))) continue;
    const key = [day, site, p.homeFn, p.shift];
    const done = await tx(async (t) => {
      const cur = await t.one<{ revision: number; source: string }>(`select revision, source from wcm_deploy_day where day = $1 and site = $2 and home_fn = $3 and shift = $4 for update`, key);
      if (cur?.source === "lead") return false; // a lead saved in between: theirs wins
      const before = await t.q(`select target, de::float8 as de, reason from wcm_deploy where day = $1 and site = $2 and home_fn = $3 and shift = $4`, key);
      const rev = (cur?.revision ?? 0) + 1;
      if (cur) await t.q(`update wcm_deploy_day set available_de = $5, revision = $6, source = 'auto', updated_by = null, updated_at = now() where day = $1 and site = $2 and home_fn = $3 and shift = $4`, [...key, p.available, rev]);
      else await t.q(`insert into wcm_deploy_day (day, site, home_fn, shift, available_de, revision, source) values ($1,$2,$3,$4,$5,$6,'auto')`, [...key, p.available, rev]);
      await t.q(`delete from wcm_deploy where day = $1 and site = $2 and home_fn = $3 and shift = $4`, key);
      for (const l of lines) await t.q(`insert into wcm_deploy (day, site, home_fn, shift, target, de, reason) values ($1,$2,$3,$4,$5,$6,null)`, [...key, l.target, l.de]);
      await t.q(`insert into wcm_deploy_history (day, site, home_fn, shift, revision, before, after, actor_id) values ($1,$2,$3,$4,$5,$6,$7,null)`,
        [...key, rev, JSON.stringify(before), JSON.stringify(lines)]);
      return true;
    });
    if (done) written++;
  }
  return written;
}

/** Auto-split every site for the given days (after the attendance pull or a stage-output refresh). */
export async function autoDeployDays(days: string[]) {
  let pools = 0;
  for (const d of days) for (const s of ["South", "North"] as const) pools += await autoDeploy(d, s);
  return pools;
}
