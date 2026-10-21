"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { one, q } from "../db";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import type { OrgLevel } from "./queries";

async function admin() {
  const u = await requireUser();
  if (u.role !== "admin") throw new Error("Only admins can change the org chart");
  return u;
}

/** Move a person under a new manager (null = top level). Refuses loops. */
export async function setReportsTo(userId: string, managerId: string | null): Promise<ActionResult> {
  try {
    const u = await admin();
    if (managerId === userId) throw new Error("Someone can't report to themselves");
    if (managerId) {
      const loop = await one<{ hit: boolean }>(
        `with recursive up(id, depth) as (select reports_to, 1 from users where id = $1 union all select u.reports_to, depth + 1 from users u join up on u.id = up.id where up.id is not null and depth < 20)
         select exists (select 1 from up where id = $2) as hit`, [managerId, userId]);
      if (loop?.hit) throw new Error("That would create a loop — the new manager already reports to this person");
    }
    await q(`update users set reports_to = $2 where id = $1`, [userId, managerId]);
    await logActivity({ actorId: u.id, entityType: "user", entityId: userId, action: "org_moved", to: managerId });
    revalidatePath("/settings");
    return ok(undefined, "Org chart updated");
  } catch (e) { return fail(e); }
}

export async function setOrgLevel(userId: string, level: OrgLevel, fn?: string | null): Promise<ActionResult> {
  try {
    const u = await admin();
    await q(`update users set org_level = $2, org_function = coalesce($3, org_function) where id = $1`, [userId, level, fn?.trim() || null]);
    await logActivity({ actorId: u.id, entityType: "user", entityId: userId, action: "org_level", to: level });
    revalidatePath("/settings");
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}
