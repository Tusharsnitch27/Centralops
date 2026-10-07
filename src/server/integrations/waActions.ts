"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { requireUser, canManage } from "../auth";
import { one, q } from "../db";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { normalizePhone, sendWhatsApp, type WaProvider } from "./whatsapp";
import { runAopReminders, type ReminderRun } from "../aop/reminders";
import { parseDeadlines, type DeadlineConfig } from "../aop/deadlines";

async function requireAdmin() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only admins and PMs can change integrations");
  return u;
}

export async function saveWhatsAppConfig(i: { provider: WaProvider; webhookUrl: string; secret: string; template: string; lang: string; metaToken?: string; phoneNumberId?: string }): Promise<ActionResult> {
  try {
    const u = await requireAdmin();
    if (i.provider === "webhook" && !/^https?:\/\/\S+$/.test(i.webhookUrl.trim())) throw new Error("Enter the n8n webhook URL (starts with https://)");
    const cur = (await one<{ value: Record<string, string> }>(`select value from app_settings where key = 'integrations.whatsapp'`))?.value ?? {};
    const v = {
      provider: i.provider, webhookUrl: i.webhookUrl.trim(), secret: i.secret.trim() || cur.secret || "", template: i.template.trim() || "central_ops_reminder", lang: i.lang.trim() || "en",
      metaToken: i.metaToken?.trim() || cur.metaToken || "", phoneNumberId: i.phoneNumberId?.trim() || cur.phoneNumberId || "",
    };
    await q(`insert into app_settings (key, value) values ('integrations.whatsapp', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(v)]);
    await logActivity({ actorId: u.id, entityType: "integration", entityId: null, action: "whatsapp_configured", to: i.provider });
    revalidatePath("/settings");
    return ok(undefined, "WhatsApp settings saved");
  } catch (e) { return fail(e); }
}

export async function generateWebhookSecret(): Promise<ActionResult<{ secret: string }>> {
  try { await requireAdmin(); return ok({ secret: randomBytes(24).toString("base64url") }); } catch (e) { return fail(e) as ActionResult<{ secret: string }>; }
}

export async function sendTestWhatsApp(): Promise<ActionResult<{ status: string; reason?: string }>> {
  try {
    const u = await requireAdmin();
    const me = await one<{ phone: string | null }>(`select phone from users where id = $1`, [u.id]);
    if (!normalizePhone(me?.phone)) throw new Error("Add your WhatsApp number first (field above)");
    const r = await sendWhatsApp({ userId: u.id, params: [u.name.split(" ")[0], "Central Ops test", "today", "test message", "—", process.env.NEXTAUTH_URL ?? ""],
      text: `Hi ${u.name.split(" ")[0]}, this is a test message from Central Ops. Reminders for late AOP inputs will arrive like this.`, entityType: "test", dedupeKey: `test:${u.id}:${Date.now()}`, actorId: u.id });
    revalidatePath("/settings");
    return r.status === "failed" ? { ok: false, error: r.reason ?? "Send failed" } : ok({ status: r.status, reason: r.reason });
  } catch (e) { return fail(e) as ActionResult<{ status: string; reason?: string }>; }
}

export async function saveMyWhatsApp(phone: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const p = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !p) throw new Error("Enter a valid mobile number, e.g. 98765 43210");
    await q(`update users set phone = $2 where id = $1`, [u.id, p]);
    revalidatePath("/settings");
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}

export async function runRemindersNow(i: { force?: boolean }): Promise<ActionResult<ReminderRun>> {
  try {
    const u = await requireAdmin();
    const run = await runAopReminders({ actorId: u.id, force: !!i.force });
    revalidatePath("/settings");
    return ok(run);
  } catch (e) { return fail(e) as ActionResult<ReminderRun>; }
}

export async function saveDeadlines(i: { cycleId: string; config: DeadlineConfig }): Promise<ActionResult> {
  try {
    const u = await requireAdmin();
    const c = parseDeadlines(i.config);
    for (const r of [c.plan, c.forecast, c.actual, ...Object.values(c.overrides).flatMap((o) => Object.values(o))])
      if (!r || r.day < 1 || r.day > 31 || r.monthOffset < -1 || r.monthOffset > 2) throw new Error("Deadline days must be 1–31");
    await q(`update aop_cycles set deadline_config = $2 where id = $1`, [i.cycleId, JSON.stringify(c)]);
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: i.cycleId, action: "deadlines_changed", to: JSON.stringify(c) });
    revalidatePath("/settings"); revalidatePath("/aop", "layout");
    return ok(undefined, "Deadlines saved");
  } catch (e) { return fail(e); }
}
