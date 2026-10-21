import "server-only";
import { one, q } from "../db";
import { notify } from "../core/notify";
import { sendWhatsApp } from "../integrations/whatsapp";

export interface EmailConfig { webhookUrl: string; secret: string; recipients: string; cc: string }
export async function emailConfig(): Promise<EmailConfig> {
  const v = (await one<{ value: Partial<EmailConfig> }>(`select value from app_settings where key = 'integrations.email'`))?.value ?? {};
  return { webhookUrl: v.webhookUrl ?? process.env.EMAIL_WEBHOOK_URL ?? "", secret: v.secret ?? process.env.EMAIL_WEBHOOK_SECRET ?? "", recipients: v.recipients ?? "", cc: v.cc ?? "" };
}
export async function remindWeeklyOwners(weekOf: string, actorId: string | null) {
  const rows = await q<{ entry_id: string; name: string; owner_ids: string[] }>(
    `select e.id as entry_id, s.name, s.owner_ids from weekly_entries e join weekly_reports r on r.id = e.report_id join weekly_sections s on s.id = e.section_id
     where r.week_of = $1 and r.status = 'collecting' and e.status <> 'submitted'`, [weekOf]);
  const by = new Map<string, string[]>();
  for (const x of rows) for (const id of x.owner_ids) by.set(id, [...(by.get(id) ?? []), x.name]);
  const app = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const day = new Date(`${weekOf}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  for (const [id, names] of by) {
    const what = names.join(", ");
    await notify({ userId: id, kind: "weekly_reminder", title: `Weekly update due Mon ${day}, 12 PM`, body: what, href: `/weekly?week=${weekOf}`, actorId });
    const first = (await one<{ name: string }>(`select name from users where id = $1`, [id]))?.name.split(" ")[0] ?? "";
    await sendWhatsApp({ userId: id, params: [first, `Weekly update — ${what}`, `Mon ${day}, 12 PM`, "not submitted yet", "—", `${app}/weekly`],
      text: `Hi ${first}, your Central Ops weekly update (${what}) is due Mon ${day} by 12 PM. ${app}/weekly`, entityType: "weekly_report", dedupeKey: `weekly:${weekOf}:${id}:${new Date().toISOString().slice(0, 13)}`, actorId });
  }
  return by.size;
}

