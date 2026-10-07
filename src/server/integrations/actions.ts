"use server";
import { revalidatePath } from "next/cache";
import { q } from "../db";
import { requireUser } from "../auth";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { syncCalendar, type SyncResult } from "../meetings/calendarSync";

export async function syncGoogleCalendar(): Promise<ActionResult<SyncResult>> {
  try {
    const u = await requireUser();
    const r = await syncCalendar(u.id);
    revalidatePath("/", "layout");
    return ok(r, r.imported ? `${r.imported} new meeting${r.imported === 1 ? "" : "s"} imported` : "Calendar is up to date");
  } catch (e) { return fail(e); }
}

/** Disconnect: tokens are wiped; imported meetings (and their MoMs) stay. */
export async function disconnectGoogle(): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`update integrations set status = 'disconnected', access_token = null, refresh_token = null, token_expires_at = null where user_id = $1 and provider = 'google_calendar'`, [u.id]);
    await logActivity({ actorId: u.id, entityType: "integration", entityId: null, action: "disconnected", summary: "Google Calendar" });
    revalidatePath("/integrations");
    return ok(undefined, "Google Calendar disconnected");
  } catch (e) { return fail(e); }
}
