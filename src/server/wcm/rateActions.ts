"use server";
import { revalidatePath } from "next/cache";
import { q } from "../db";
import { canManage, requireUser } from "../auth";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";

/** Add / replace a salary-master rate for a site from a date (admins / PMs). Earlier days keep their rate. */
export async function saveMpRate(site: string, effectiveFrom: string, monthlySalary: number, daysBasis: number, otHourly: number | null, note: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and program managers can set salary rates");
    if (site !== "South" && site !== "North") throw new Error("Pick South or North");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error("Pick the date the rate applies from");
    if (!(monthlySalary > 0)) throw new Error("Monthly ₹ per head must be above 0");
    if (!(daysBasis >= 20 && daysBasis <= 31)) throw new Error("Days basis must be 20–31");
    if (otHourly != null && !(otHourly > 0)) throw new Error("OT ₹ / hour must be above 0, or left blank");
    if (!note.trim()) throw new Error("Say where the rate comes from (e.g. Quess billing Oct'26)");
    await q(`insert into wcm_mp_rate (site, effective_from, monthly_salary, days_basis, ot_hourly, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (site, effective_from) do update set monthly_salary = excluded.monthly_salary, days_basis = excluded.days_basis, ot_hourly = excluded.ot_hourly,
               note = excluded.note, created_by = excluded.created_by, created_at = now()`, [site, effectiveFrom, monthlySalary, daysBasis, otHourly, note.trim(), u.id]);
    await logActivity({ actorId: u.id, entityType: "aop_section", entityId: null, action: "wcm_mp_rate_saved", from: null, to: { site, effectiveFrom, monthlySalary, daysBasis, otHourly },
      summary: `${site} salary master from ${effectiveFrom}: ₹${monthlySalary} / ${daysBasis} days${otHourly ? `, OT ₹${otHourly}/h` : ""} (${note.trim()})` });
    revalidatePath("/aop/cost"); revalidatePath("/aop/data");
    return ok(undefined, "Rate saved");
  } catch (e) { return fail(e); }
}
