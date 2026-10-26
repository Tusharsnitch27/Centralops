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
    if (!(await calendarMaster())) throw new Error("Calendar connections are switched off by the admin");
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

/* ---------------- calendar consent: each user connects their own; admin holds the master switch ---------------- */

/** Master switch (admin): may people connect their own Google Calendar at all? Off hides the prompt and stops syncing. */
export async function calendarMaster(): Promise<boolean> {
  const r = await q<{ value: unknown }>(`select value from app_settings where key = 'integrations.calendar_enabled'`);
  return r[0]?.value !== false; // on unless switched off
}
export async function setCalendarMaster(enabled: boolean): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    await q(`insert into app_settings (key, value) values ('integrations.calendar_enabled', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(enabled)]);
    if (!enabled) await q(`update integrations set status = 'disconnected', access_token = null, refresh_token = null, token_expires_at = null where provider = 'google_calendar' and status <> 'disconnected'`);
    await logActivity({ actorId: u.id, entityType: "integration", entityId: null, action: enabled ? "enabled" : "disabled", summary: "Calendar connections (master)" });
    revalidatePath("/", "layout");
    return ok(undefined, enabled ? "People can connect their calendars" : "Calendar connections switched off — every connection disconnected");
  } catch (e) { return fail(e); }
}
/** Admin: disconnect one person's calendar. Their imported meetings stay. */
export async function adminDisconnectCalendar(userId: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    await q(`update integrations set status = 'disconnected', access_token = null, refresh_token = null, token_expires_at = null where user_id = $1 and provider = 'google_calendar'`, [userId]);
    await logActivity({ actorId: u.id, entityType: "integration", entityId: userId, action: "disconnected", summary: "Google Calendar (by admin)" });
    revalidatePath("/settings");
    return ok(undefined, "Disconnected");
  } catch (e) { return fail(e); }
}
/** "Not now" on the connect prompt. */
export async function dismissCalendarPrompt(): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`insert into app_settings (key, value) values ($1, to_jsonb(now()::text)) on conflict (key) do update set value = excluded.value, updated_at = now()`, [`calendar.prompt_dismissed.${u.id}`]);
    revalidatePath("/");
    return ok();
  } catch (e) { return fail(e); }
}
