"use server";
import { revalidatePath } from "next/cache";
import { canManage, requireUser } from "../auth";
import { q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import { pullManpower } from "./feed";

const refresh = () => revalidatePath("/sop/productivity", "layout");
async function pm() { const u = await requireUser(); if (!canManage(u)) throw new Error("Only program managers can change manpower settings"); return u; }

/** Pull now (last 10 days, or from a date when back-filling). */
export async function refreshManpower(from?: string): Promise<ActionResult> {
  try {
    const u = await pm();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Pick a valid date");
    const r = await pullManpower("manual", u.id, from);
    if (!r.ok) throw new Error(r.error);
    refresh();
    return ok(undefined, `Manpower ${r.from} → ${r.to}: ${r.note}`);
  } catch (e) { return fail(e); }
}

export async function mapSite(site: string, warehouse: "South" | "North" | "ignore"): Promise<ActionResult> {
  try {
    const u = await pm();
    if (!["South", "North", "ignore"].includes(warehouse)) throw new Error("Pick South, North or ignore");
    await q(`insert into mp_site_map (site, warehouse, updated_by) values ($1,$2,$3) on conflict (site) do update set warehouse = excluded.warehouse, updated_by = excluded.updated_by, updated_at = now()`, [site, warehouse, u.id]);
    refresh();
    return ok(undefined, `${site} → ${warehouse === "ignore" ? "not counted" : `${warehouse} WH`}`);
  } catch (e) { return fail(e); }
}

/** department = null → not a warehouse function (not counted). */
export async function mapFunction(func: string, department: string | null): Promise<ActionResult> {
  try {
    const u = await pm();
    await q(`insert into mp_func_map (func, department, updated_by) values ($1,$2,$3) on conflict (func) do update set department = excluded.department, updated_by = excluded.updated_by, updated_at = now()`, [func, department?.trim() || null, u.id]);
    refresh();
    return ok(undefined, `${func} → ${department ?? "not counted"}`);
  } catch (e) { return fail(e); }
}

/** Standard units per head per day from a date onwards (earlier days keep the earlier standard). */
export async function setStandard(i: { department: string; warehouses: ("South" | "North")[]; unitsPerHead: number; effectiveFrom: string; note?: string }): Promise<ActionResult> {
  try {
    const u = await pm();
    if (!i.department.trim()) throw new Error("Pick a function");
    if (!i.warehouses.length) throw new Error("Pick at least one warehouse");
    if (!Number.isFinite(i.unitsPerHead) || i.unitsPerHead < 0) throw new Error("Enter units per head per day");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.effectiveFrom)) throw new Error("Pick the date it applies from");
    for (const wh of i.warehouses)
      await q(`insert into mp_rates (department, warehouse, effective_from, units_per_head, note, created_by) values ($1,$2,$3,$4,$5,$6)
               on conflict (department, warehouse, effective_from) do update set units_per_head = excluded.units_per_head, note = excluded.note, created_by = excluded.created_by, created_at = now()`,
        [i.department, wh, i.effectiveFrom, i.unitsPerHead, i.note?.trim() || null, u.id]);
    refresh();
    return ok(undefined, `${i.department}: ${i.unitsPerHead} units / head / day from ${i.effectiveFrom}`);
  } catch (e) { return fail(e); }
}

export async function deleteStandard(department: string, warehouse: string, effectiveFrom: string): Promise<ActionResult> {
  try {
    await pm();
    await q(`delete from mp_rates where department = $1 and warehouse = $2 and effective_from = $3`, [department, warehouse, effectiveFrom]);
    refresh();
    return ok(undefined, "Standard removed");
  } catch (e) { return fail(e); }
}
