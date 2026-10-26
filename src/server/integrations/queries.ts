import "server-only";
import { one, q } from "../db";
import { waConfig } from "./whatsapp";
import { lateInputs } from "../aop/reminders";
import { loadModel, resolveCycle } from "../aop/model";
import { emailConfig } from "../weekly/delivery";
import { sfConfigured, sfEnv } from "../snowflake";
import { FEEDS, INVENTORY_FEED, PACKAGING_FEED, lastRuns, refreshFrom } from "../sop/sync";
import { PKG_QUERY, PKG_FROM } from "../packaging/engine";

export interface MessageRow { id: string; created_at: string; to_name: string | null; to_phone: string | null; status: string; provider: string | null; body: string | null; error: string | null }

export async function integrationsData(userId: string) {
  const [cfg, me, log, lastRun, cycle, mail, runs] = await Promise.all([
    waConfig(),
    one<{ phone: string | null }>(`select phone from users where id = $1`, [userId]),
    q<MessageRow>(`select l.id, l.created_at, u.name as to_name, l.to_phone, l.status, l.provider, l.body, l.error from message_log l left join users u on u.id = l.to_user_id order by l.created_at desc limit 40`),
    one<{ value: { at: string; sent: number; checked: number } }>(`select value from app_settings where key = 'reminders.last_run'`),
    resolveCycle(),
    emailConfig(),
    lastRuns(),
  ]);
  const m = cycle ? await loadModel(cycle.id) : null;
  const phones = await one<{ total: number; with_phone: number }>(`select count(*)::int as total, count(*) filter (where phone is not null)::int as with_phone from users where active`);
  return {
    wa: { provider: cfg.provider, configured: cfg.configured, webhookUrl: cfg.webhookUrl, hasSecret: !!cfg.secret, template: cfg.template, lang: cfg.lang, phoneNumberId: cfg.phoneNumberId, hasMetaToken: !!cfg.metaToken },
    myPhone: me?.phone ?? null,
    snowflake: { configured: sfConfigured(), env: sfEnv(), chosenWarehouse: await one<{ value: unknown }>(`select value from app_settings where key = 'snowflake.warehouse'`).then((r) => (typeof r?.value === "string" && r.value ? r.value : null)), syncTime: process.env.SOP_SYNC_TIME ?? "07:00", from: await refreshFrom(),
      feeds: [...Object.entries(FEEDS).map(([key, f]) => ({ key, title: f.title, fills: f.fills.join(" · "), sql: f.sql({ slaSku: null, putDate: "‹putaway updated column›" }), last: runs.find((r) => r.feed === key) ?? null })),
        { key: "inventory", title: INVENTORY_FEED.title, fills: INVENTORY_FEED.fills.join(" · "), sql: "DESCRIBE + daily stock query — columns detected at run time (column detection shown after each run)", last: runs.find((r) => r.feed === "inventory") ?? null },
        { key: "packaging", title: PACKAGING_FEED.title, fills: PACKAGING_FEED.fills.join(" · "), sql: PKG_QUERY(PKG_FROM), last: runs.find((r) => r.feed === "packaging") ?? null }] },
    email: { webhookUrl: mail.webhookUrl, hasSecret: !!mail.secret, recipients: mail.recipients, cc: mail.cc },
    log, lastRun: lastRun?.value ?? null, phones: phones!,
    cycle: cycle ? { id: cycle.id, name: cycle.name, deadlines: cycle.deadlines, functions: m?.functions.map((f) => f.name) ?? [] } : null,
    late: m ? lateInputs(m) : [],
    appUrl: (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, ""),
    cronSecretSet: !!process.env.CRON_SECRET,
    persist: (await one<{ since: string | null; boots: number | null; users: number; tasks: number }>(
      `select (select value #>> '{}' from app_settings where key = 'app.first_boot') as since, (select (value #>> '{}')::int from app_settings where key = 'app.boots') as boots,
              (select count(*)::int from users) as users, (select count(*)::int from tasks) as tasks`))!,
    scheduler: (process.env.REMINDER_SCHEDULER ?? (process.env.NODE_ENV === "production" ? "on" : "off")) === "on",
    reminderTime: process.env.REMINDER_TIME ?? "10:00",
  };
}
export type IntegrationsData = Awaited<ReturnType<typeof integrationsData>>;
