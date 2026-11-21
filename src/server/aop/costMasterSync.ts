import "server-only";
import type { RunQ } from "../db";
import { q } from "../db";

/**
 * Warehouse Cost Master → AOP lines (13.4 #1, decided 21 Nov 2026). The Cost Master snapshot (wcm_source_line) is the source for
 *  - Warehousing & Fulfilment › <site section> › each warehousing head: actual (a booked head with no AOP line is added, no plan —
 *    e.g. South Petty Cash, so every booked rupee shows)
 *  - Warehousing & Fulfilment › <site section> › Monthly Manpower Cost / Monthly OT (added): plan = CM budget, actual = CM actual
 *  - Packaging › Channel level › Shopify / Marketplace / Store / B2B MP: actual
 * A cell an owner edited in the app (any aop_updates row for item × period × field) is kept and its difference listed on the
 * Summary; imported or empty cells take the Cost Master figure. A blank Cost Master cell is missing: nothing is written or cleared.
 * Runs once per snapshot from the seed (seed.aop_cm_sync = snapshot id).
 */
const SITE_SECTION: Record<string, string> = { South: "YLK 1 & 2 (South)", North: "North Warehouse" };
const TARGETS = [
  { family: "warehousing", fn: "Warehousing & Fulfilment", fields: { actual: "actual" } },
  { family: "manpower", fn: "Warehousing & Fulfilment", fields: { budget: "plan", actual: "actual" } },
  { family: "ot", fn: "Warehousing & Fulfilment", fields: { budget: "plan", actual: "actual" } },
  { family: "packaging", fn: "Packaging", fields: { actual: "actual" } },
] as const;
type Field = "plan" | "actual";

/** One target cell per AOP item × month × field, with the Cost Master figure. */
async function targets(S: RunQ, snapshot: string) {
  const cyc = (await S<{ id: string; fy_start: string; months: number }>(`select id, fy_start::text, months from aop_cycles where status = 'active' order by fy_start desc limit 1`))[0];
  if (!cyc) return null;
  const lines = await S<{ family: string; basis: string; site: string; head: string; period: string; amount: number | null }>(
    `select family, basis, site, head, period::text as period, case when count(amount) = 0 then null else sum(amount) end::float8 as amount
     from wcm_source_line where snapshot_id = $1 and family = any($2::text[]) and basis in ('actual','budget')
       and period >= $3::date and period < ($3::date + make_interval(months => $4)) group by 1, 2, 3, 4, 5`,
    [snapshot, TARGETS.map((t) => t.family), cyc.fy_start, cyc.months]);
  return { cyc, lines };
}

export async function seedAopCostMaster(S: RunQ, snapshot: string) {
  const t = await targets(S, snapshot);
  if (!t) return { updated: 0, kept: 0, added: 0 };
  const { cyc, lines } = t;
  const edited = new Set((await S<{ k: string }>(`select distinct item_id || '|' || period::text || '|' || field as k from aop_updates`)).map((r) => r.k));
  const sectionId = new Map<string, string | null>(), itemId = new Map<string, string>();
  let updated = 0, kept = 0, added = 0;
  const section = async (fn: string, name: string) => {
    const k = `${fn}|${name}`;
    if (!sectionId.has(k)) sectionId.set(k, (await S<{ id: string }>(
      `select s.id from aop_sections s join aop_sections f on f.id = s.parent_id where s.cycle_id = $1 and f.parent_id is null and f.name = $2 and s.name = $3`, [cyc.id, fn, name]))[0]?.id ?? null);
    return sectionId.get(k)!;
  };
  for (const l of lines) {
    if (l.amount == null) continue;
    const tg = TARGETS.find((x) => x.family === l.family)!, field = (tg.fields as Record<string, Field>)[l.basis];
    if (!field) continue;
    const sid = await section(tg.fn, l.family === "packaging" ? "Channel level" : SITE_SECTION[l.site] ?? "");
    if (!sid) continue;
    const ik = `${sid}|${l.head.trim().toLowerCase()}`;
    let iid = itemId.get(ik) ?? (await S<{ id: string }>(`select id from aop_items where section_id = $1 and lower(trim(name)) = $2`, [sid, l.head.trim().toLowerCase()]))[0]?.id;
    if (!iid) {
      if (l.amount === 0 && l.family !== "manpower" && l.family !== "ot") continue; // a head with no AOP line is added once it carries money (no plan)
      iid = (await S<{ id: string }>(`insert into aop_items (cycle_id, section_id, name, metric, unit, direction, sort)
        values ($1,$2,$3,'Cost','inr','lower_better',(select coalesce(max(sort),0)+1 from aop_items where section_id = $2)) returning id`, [cyc.id, sid, l.head.trim()]))[0].id;
      added++;
    }
    itemId.set(ik, iid);
    if (edited.has(`${iid}|${l.period}|${field}`)) { kept++; continue; }
    const cur = (await S<{ v: number | null }>(`select ${field}::float8 as v from aop_period_values where item_id = $1 and period = $2`, [iid, l.period]))[0]?.v ?? null;
    if (cur != null && Math.abs(cur - l.amount) < 0.005) continue;
    await S(`insert into aop_period_values (item_id, period, ${field}) values ($1,$2,$3) on conflict (item_id, period) do update set ${field} = excluded.${field}`, [iid, l.period, l.amount]);
    updated++;
  }
  return { updated, kept, added };
}

export interface CmDiff { item: string; section: string; period: string; field: Field; owner: number | null; costMaster: number }
/** Owner-edited cells whose value differs from the Cost Master snapshot in use (shown on the AOP Summary). */
export async function costMasterDiffs(): Promise<CmDiff[]> {
  const snap = (await q<{ v: string }>(`select value #>> '{}' as v from app_settings where key = 'wcm.snapshot'`))[0]?.v;
  if (!snap) return [];
  const t = await targets(q, snap);
  if (!t) return [];
  const rows = await q<{ item_id: string; item: string; section: string; fn: string; period: string; field: Field; v: number | null }>(
    `select distinct i.id as item_id, i.name as item, s.name as section, f.name as fn, u.period::text as period, u.field, (case u.field when 'plan' then v.plan when 'actual' then v.actual end)::float8 as v
     from aop_updates u join aop_items i on i.id = u.item_id join aop_sections s on s.id = i.section_id join aop_sections f on f.id = s.parent_id
     left join aop_period_values v on v.item_id = u.item_id and v.period = u.period
     where i.cycle_id = $1 and u.field in ('plan','actual')`, [t.cyc.id]);
  const out: CmDiff[] = [];
  for (const r of rows) {
    const tg = TARGETS.find((x) => x.fn === r.fn && (r.fn === "Packaging" ? r.section === "Channel level" : Object.values(SITE_SECTION).includes(r.section)));
    if (!tg) continue;
    const site = r.fn === "Packaging" ? "Both" : Object.entries(SITE_SECTION).find(([, n]) => n === r.section)![0];
    const l = t.lines.find((x) => x.site === site && x.head.trim().toLowerCase() === r.item.trim().toLowerCase() && x.period === r.period
      && TARGETS.some((y) => y.family === x.family && y.fn === r.fn && (y.fields as Record<string, Field>)[x.basis] === r.field));
    if (l?.amount == null || (r.v != null && Math.abs(r.v - l.amount) < 0.5)) continue;
    out.push({ item: r.item, section: r.section, period: r.period, field: r.field, owner: r.v, costMaster: l.amount });
  }
  return out.sort((a, b) => a.period.localeCompare(b.period) || a.section.localeCompare(b.section));
}
