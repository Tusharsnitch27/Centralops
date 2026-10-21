import "server-only";
import { one, q } from "../db";

/**
 * Warehouse processing cost per unit (structure; the exact method is Tushar's to define).
 * Cost  = included AOP warehouse lines (actual → provision → budget) + manpower input
 * Units = units processed from the S&OP pipeline: inward (category) + returns + outward
 */
export interface CostModel { excluded: string[]; manpower: Record<string, number>; volumes: { inward: boolean; returns: boolean; outward: boolean } }
const DEFAULT: CostModel = { excluded: [], manpower: {}, volumes: { inward: true, returns: true, outward: true } };
export async function costModel(): Promise<CostModel> {
  const v = (await one<{ value: Partial<CostModel> }>(`select value from app_settings where key = 'sop.cost_model'`))?.value;
  return { ...DEFAULT, ...(v ?? {}), volumes: { ...DEFAULT.volumes, ...(v?.volumes ?? {}) } };
}

const WH_SECTION: Record<"North" | "South", RegExp> = { North: /north/i, South: /south|ylk/i };

export async function processingCost(months: string[]) {
  const model = await costModel();
  const lines = await q<{ item_id: string; item: string; section: string; period: string; plan: number | null; forecast: number | null; actual: number | null }>(
    `select i.id as item_id, i.name as item, s.name as section, v.period::text as period, v.plan::float8 as plan, v.forecast::float8 as forecast, v.actual::float8 as actual
     from aop_items i join aop_sections s on s.id = i.section_id join aop_sections p on p.id = s.parent_id
     join aop_cycles c on c.id = p.cycle_id and c.status = 'active'
     left join aop_period_values v on v.item_id = i.id and v.period = any($1::date[])
     where p.name ilike 'warehous%'
     order by s.name, i.name`, [months]);
  const flow = await q<{ period: string; warehouse: "South" | "North"; inward_category: number; inward_returns: number; outward: number }>(
    `select period::text as period, warehouse, coalesce(inward_category,0)::float8 as inward_category, coalesce(inward_returns,0)::float8 as inward_returns, coalesce(outward,0)::float8 as outward
     from sop_inventory_flow where period = any($1::date[])`, [months]);
  const whOf = (section: string) => (WH_SECTION.North.test(section) ? "North" : "South") as "North" | "South";
  const items = [...new Map(lines.map((l) => [l.item_id, { id: l.item_id, name: l.item, wh: whOf(l.section) }])).values()];
  const rows = months.flatMap((p) => (["South", "North"] as const).map((wh) => {
    const ls = lines.filter((l) => l.period === p && whOf(l.section) === wh && !model.excluded.includes(l.item_id));
    let cost = 0, budget = 0; const basis = { actual: 0, provision: 0, budget: 0 };
    for (const l of ls) {
      budget += l.plan ?? 0;
      if (l.actual != null) { cost += l.actual; basis.actual++; } else if (l.forecast != null) { cost += l.forecast; basis.provision++; } else if (l.plan != null) { cost += l.plan; basis.budget++; }
    }
    const manpower = model.manpower[`${p}|${wh}`] ?? null;
    const f = flow.find((x) => x.period === p && x.warehouse === wh);
    const units = f ? (model.volumes.inward ? f.inward_category : 0) + (model.volumes.returns ? f.inward_returns : 0) + (model.volumes.outward ? f.outward : 0) : null;
    const total = cost + (manpower ?? 0);
    return { period: p, wh, cost, budget, manpower, total, basis, units, perUnit: units ? total / units : null, budgetPerUnit: units ? (budget + (manpower ?? 0)) / units : null,
      inward: f?.inward_category ?? null, returns: f?.inward_returns ?? null, outward: f?.outward ?? null };
  }));
  return { model, items, rows };
}
