import "server-only";
import type { RunQ } from "../db";
import sheet from "../../db/seed/aop-logistics-fy27.json";
import old from "../../db/seed/aop-cost-fy27.json";

type V = { plan: number | null; forecast: number | null; actual: number | null };
const FIELDS = ["plan", "forecast", "actual"] as const;
const k = (section: string, name: string, period: string) => `${section}|${name.trim().toLowerCase()}|${period}`;

/**
 * Cost Master › Logistics re-read in its current layout (4 columns per month, Apr–Nov 2026; see scripts/extract-processing.mjs).
 * The first seed parsed an older 3-column layout, so its Logistics cells were shifted. A cell is replaced only when it still
 * holds that first-seed value (or is empty) — anything an owner edited in the app is kept as is.
 */
export async function seedAopLogistics(S: RunQ) {
  const fn = (await S<{ id: string; cycle_id: string }>(
    `select s.id, s.cycle_id from aop_sections s join aop_cycles c on c.id = s.cycle_id
     where s.parent_id is null and s.name = 'Logistics' order by (c.status = 'active') desc, c.fy_start desc limit 1`))[0];
  if (!fn) return { updated: 0, kept: 0 };
  const seeded = new Map<string, V>();
  for (const f of old.functions) if (f.name === "Logistics")
    for (const s of f.sections) for (const it of s.items) for (const v of it.values) seeded.set(k(s.name, it.name, v.period), v as V);
  const fresh = new Map(sheet.rows.map((r) => [k(r.section, r.name, r.period), r]));

  const sectionId = new Map<string, string>(), itemId = new Map<string, string>();
  const ensure = async (section: string, name: string) => {
    let sid = sectionId.get(section);
    if (!sid) {
      sid = (await S<{ id: string }>(`select id from aop_sections where parent_id = $1 and name = $2`, [fn.id, section]))[0]?.id
        ?? (await S<{ id: string }>(`insert into aop_sections (cycle_id, parent_id, name, kind, sort) values ($1,$2,$3,'group',(select coalesce(max(sort),0)+1 from aop_sections where parent_id = $2)) returning id`, [fn.cycle_id, fn.id, section]))[0].id;
      sectionId.set(section, sid);
    }
    const ik = `${section}|${name.trim().toLowerCase()}`;
    let iid = itemId.get(ik);
    if (!iid) {
      iid = (await S<{ id: string }>(`select id from aop_items where section_id = $1 and lower(trim(name)) = lower(trim($2))`, [sid, name]))[0]?.id
        ?? (await S<{ id: string }>(`insert into aop_items (cycle_id, section_id, name, metric, unit, direction, sort) values ($1,$2,$3,'Cost','inr','lower_better',(select coalesce(max(sort),0)+1 from aop_items where section_id = $2)) returning id`, [fn.cycle_id, sid, name.trim()]))[0].id;
      itemId.set(ik, iid);
    }
    return iid;
  };

  let updated = 0, kept = 0;
  // every cell either the sheet now has, or the first seed wrote (stale shifted values are cleared when untouched)
  for (const key of new Set([...fresh.keys(), ...seeded.keys()])) {
    const [section, , period] = key.split("|");
    const r = fresh.get(key), was = seeded.get(key);
    const name = r?.name ?? old.functions.find((f) => f.name === "Logistics")!.sections.find((s) => s.name === section)!.items.find((i) => k(section, i.name, period) === key)!.name;
    const iid = await ensure(section, name);
    const cur = (await S<V>(`select plan::float8 as plan, forecast::float8 as forecast, actual::float8 as actual from aop_period_values where item_id = $1 and period = $2`, [iid, period]))[0];
    const next: V = { plan: null, forecast: null, actual: null };
    for (const f of FIELDS) {
      const now = cur?.[f] ?? null, seed = was?.[f] ?? null, want = r?.[f] ?? null;
      const untouched = now == null || (seed != null && Math.abs(now - seed) < 0.01);
      next[f] = untouched ? want : now;
      if (untouched && now !== want) updated++; else if (!untouched && now !== want) kept++;
    }
    await S(`insert into aop_period_values (item_id, period, plan, forecast, actual) values ($1,$2,$3,$4,$5)
             on conflict (item_id, period) do update set plan = excluded.plan, forecast = excluded.forecast, actual = excluded.actual`,
      [iid, period, next.plan, next.forecast, next.actual]);
  }
  return { updated, kept };
}
