"use server";
import { revalidatePath } from "next/cache";
import { canManage, requireUser } from "../auth";
import { one, q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import { normType } from "./model";
import { closeMonth } from "./engine";

const refresh = () => revalidatePath("/aop/packaging", "layout");
async function pm() { const u = await requireUser(); if (!canManage(u)) throw new Error("Only program managers can change packaging"); return u; }

/** New rate for a package type from a date onwards; days before keep the earlier rate. Closed months stay as frozen. */
export async function setPackageRate(i: { packageType: string; rate: number; effectiveFrom: string; note?: string }): Promise<ActionResult> {
  try {
    const u = await pm();
    const type = normType(i.packageType);
    if (!type) throw new Error("Package type is required");
    if (!Number.isFinite(i.rate) || i.rate < 0) throw new Error("Enter a rate (₹ per package)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.effectiveFrom)) throw new Error("Pick the date the rate applies from");
    const closed = await one<{ p: string }>(`select period::text as p from pkg_months where status = 'closed' and period = date_trunc('month', $1::date)::date`, [i.effectiveFrom]);
    if (closed) throw new Error(`${closed.p.slice(0, 7)} is already closed — pick a date in an open month`);
    await q(`insert into pkg_rates (package_type, effective_from, rate, note, created_by) values ($1,$2,$3,$4,$5)
             on conflict (package_type, effective_from) do update set rate = excluded.rate, note = excluded.note, created_by = excluded.created_by, created_at = now()`,
      [type, i.effectiveFrom, i.rate, i.note?.trim() || null, u.id]);
    refresh();
    return ok(undefined, `${type}: ₹${i.rate} from ${i.effectiveFrom}`);
  } catch (e) { return fail(e); }
}

export async function deletePackageRate(packageType: string, effectiveFrom: string): Promise<ActionResult> {
  try {
    await pm();
    const closed = await one(`select 1 from pkg_months where status = 'closed' and period = date_trunc('month', $1::date)::date`, [effectiveFrom]);
    if (closed) throw new Error("That month is closed — its rates are part of the frozen numbers");
    await q(`delete from pkg_rates where package_type = $1 and effective_from = $2`, [normType(packageType), effectiveFrom]);
    refresh();
    return ok(undefined, "Rate removed");
  } catch (e) { return fail(e); }
}

/** Admin: freeze a finished month now (normally automatic on the first refresh of the next month). */
export async function closePackagingMonth(period: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    if (period >= `${new Date().toISOString().slice(0, 7)}-01`) throw new Error("Only finished months can be closed");
    await closeMonth(period, u.id);
    refresh(); revalidatePath("/aop", "layout");
    return ok(undefined, `${period.slice(0, 7)} closed and written to the AOP`);
  } catch (e) { return fail(e); }
}
