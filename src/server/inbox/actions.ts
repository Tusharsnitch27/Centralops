"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";

export async function resolveInboxItem(id: string, how: "done" | "dismissed"): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`update inbox_items set status = $3, resolved_at = now() where id = $1 and user_id = $2`, [id, u.id, how]);
    revalidatePath("/", "layout");
    return ok();
  } catch (e) { return fail(e); }
}

export async function snoozeInboxItem(id: string, days: number): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`update inbox_items set status = 'snoozed', snoozed_until = now() + make_interval(days => $3::int) where id = $1 and user_id = $2`, [id, u.id, Math.max(1, Math.min(30, days))]);
    revalidatePath("/", "layout");
    return ok();
  } catch (e) { return fail(e); }
}
