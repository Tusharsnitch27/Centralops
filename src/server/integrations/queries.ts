import "server-only";
import { one, q } from "../db";
import { waConfig } from "./whatsapp";
import { lateInputs } from "../aop/reminders";
import { loadModel, resolveCycle } from "../aop/model";

export interface MessageRow { id: string; created_at: string; to_name: string | null; to_phone: string | null; status: string; provider: string | null; body: string | null; error: string | null }

export async function integrationsData(userId: string) {
  const [cfg, me, log, lastRun, cycle] = await Promise.all([
    waConfig(),
    one<{ phone: string | null }>(`select phone from users where id = $1`, [userId]),
    q<MessageRow>(`select l.id, l.created_at, u.name as to_name, l.to_phone, l.status, l.provider, l.body, l.error from message_log l left join users u on u.id = l.to_user_id order by l.created_at desc limit 40`),
    one<{ value: { at: string; sent: number; checked: number } }>(`select value from app_settings where key = 'reminders.last_run'`),
    resolveCycle(),
  ]);
  const m = cycle ? await loadModel(cycle.id) : null;
  const phones = await one<{ total: number; with_phone: number }>(`select count(*)::int as total, count(*) filter (where phone is not null)::int as with_phone from users where active`);
  return {
    wa: { provider: cfg.provider, configured: cfg.configured, webhookUrl: cfg.webhookUrl, hasSecret: !!cfg.secret, template: cfg.template, lang: cfg.lang, phoneNumberId: cfg.phoneNumberId, hasMetaToken: !!cfg.metaToken },
    myPhone: me?.phone ?? null,
    log, lastRun: lastRun?.value ?? null, phones: phones!,
    cycle: cycle ? { id: cycle.id, name: cycle.name, deadlines: cycle.deadlines, functions: m?.functions.map((f) => f.name) ?? [] } : null,
    late: m ? lateInputs(m) : [],
    appUrl: (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, ""),
    cronSecretSet: !!process.env.CRON_SECRET,
    scheduler: (process.env.REMINDER_SCHEDULER ?? (process.env.NODE_ENV === "production" ? "on" : "off")) === "on",
    reminderTime: process.env.REMINDER_TIME ?? "10:00",
  };
}
export type IntegrationsData = Awaited<ReturnType<typeof integrationsData>>;
