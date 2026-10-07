import "server-only";
import { one, q } from "../db";

/**
 * WhatsApp sender with pluggable providers. Configure in Settings → Integrations (or env vars):
 *   WHATSAPP_PROVIDER = meta | webhook | dry_run (default dry_run — logs what would be sent, sends nothing)
 *   meta    → WhatsApp Business Cloud API: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE (approved template name),
 *             WHATSAPP_TEMPLATE_LANG (default en). Business-initiated messages must use an approved template.
 *   webhook → POST JSON to WHATSAPP_WEBHOOK_URL (n8n / Interakt / Gupshup / AiSensy relay), optional WHATSAPP_WEBHOOK_SECRET header.
 * Every attempt is written to message_log (dedupe_key prevents double sends).
 */
export type WaProvider = "meta" | "webhook" | "dry_run";
export interface WaConfig {
  provider: WaProvider; webhookUrl: string; secret: string; template: string; lang: string; metaToken: string; phoneNumberId: string;
}
/** Settings → Integrations values (app_settings 'integrations.whatsapp'), falling back to env vars. */
export async function waConfig(): Promise<WaConfig & { configured: boolean }> {
  const row = await one<{ value: Partial<WaConfig> }>(`select value from app_settings where key = 'integrations.whatsapp'`);
  const v = row?.value ?? {};
  const c: WaConfig = {
    provider: (v.provider ?? (process.env.WHATSAPP_PROVIDER as WaProvider) ?? "dry_run") as WaProvider,
    webhookUrl: v.webhookUrl ?? process.env.WHATSAPP_WEBHOOK_URL ?? "",
    secret: v.secret ?? process.env.WHATSAPP_WEBHOOK_SECRET ?? "",
    template: v.template || process.env.WHATSAPP_TEMPLATE || "central_ops_reminder",
    lang: v.lang || process.env.WHATSAPP_TEMPLATE_LANG || "en",
    metaToken: v.metaToken ?? process.env.WHATSAPP_TOKEN ?? "",
    phoneNumberId: v.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  };
  const effective: WaProvider = c.provider === "webhook" && c.webhookUrl ? "webhook" : c.provider === "meta" && c.metaToken && c.phoneNumberId ? "meta" : "dry_run";
  return { ...c, provider: effective, configured: effective !== "dry_run" };
}
export const waProvider = async (): Promise<WaProvider> => (await waConfig()).provider;

/** Indian mobile → E.164 digits (91XXXXXXXXXX). Returns null if it doesn't look like a mobile number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 10) d = `91${d}`;
  if (d.length === 11 && d.startsWith("0")) d = `91${d.slice(1)}`;
  return /^\d{11,15}$/.test(d) ? d : null;
}

export interface WaMessage {
  userId: string;
  /** Template body variables, in order (matches the approved template's {{1}}, {{2}}…). */
  params: string[];
  /** Plain-text rendering (used for the log, dry runs and webhook providers). */
  text: string;
  entityType?: string;
  entityId?: string | null;
  dedupeKey?: string;
  actorId?: string | null;
}
export interface WaResult { status: "sent" | "dry_run" | "failed" | "skipped"; reason?: string }

export async function sendWhatsApp(m: WaMessage): Promise<WaResult> {
  const u = await one<{ name: string; phone: string | null; whatsapp_opt_in: boolean; active: boolean }>(`select name, phone, whatsapp_opt_in, active from users where id = $1`, [m.userId]);
  const cfg = await waConfig();
  const provider = cfg.provider;
  const to = normalizePhone(u?.phone);
  const log = async (status: WaResult["status"], extra: { error?: string; providerId?: string } = {}) => {
    await q(
      `insert into message_log (channel, provider, to_user_id, to_phone, template, body, status, provider_message_id, error, entity_type, entity_id, dedupe_key, created_by)
       values ('whatsapp',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (dedupe_key) do nothing`,
      [provider, m.userId, to, cfg.template, m.text, status, extra.providerId ?? null, extra.error ?? null, m.entityType ?? null, m.entityId ?? null, m.dedupeKey ?? null, m.actorId ?? null]);
  };
  if (m.dedupeKey && (await one(`select 1 from message_log where dedupe_key = $1`, [m.dedupeKey]))) return { status: "skipped", reason: "already sent" };
  if (!u || !u.active) { await log("skipped", { error: "inactive user" }); return { status: "skipped", reason: "inactive user" }; }
  if (!u.whatsapp_opt_in) { await log("skipped", { error: "opted out" }); return { status: "skipped", reason: "opted out" }; }
  if (!to) { await log("skipped", { error: "no WhatsApp number" }); return { status: "skipped", reason: `${u.name} has no WhatsApp number` }; }
  if (provider === "dry_run") { await log("dry_run"); return { status: "dry_run" }; }
  try {
    if (provider === "meta") {
      const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.metaToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "template",
          template: { name: cfg.template, language: { code: cfg.lang }, components: [{ type: "body", parameters: m.params.map((t) => ({ type: "text", text: t.slice(0, 1000) })) }] },
        }),
      });
      const body = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      if (!r.ok) { await log("failed", { error: body.error?.message ?? `HTTP ${r.status}` }); return { status: "failed", reason: body.error?.message ?? `HTTP ${r.status}` }; }
      await log("sent", { providerId: body.messages?.[0]?.id });
      return { status: "sent" };
    }
    const r = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.secret ? { "x-central-ops-secret": cfg.secret } : {}) },
      body: JSON.stringify({ event: m.entityType === "test" ? "test" : "reminder", to, name: u.name, template: cfg.template, language: cfg.lang, params: m.params, text: m.text, entity: { type: m.entityType ?? null, id: m.entityId ?? null } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) { await log("failed", { error: `Webhook HTTP ${r.status}` }); return { status: "failed", reason: `Webhook HTTP ${r.status}` }; }
    await log("sent");
    return { status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed";
    await log("failed", { error: msg });
    return { status: "failed", reason: msg };
  }
}
