import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/weekly-2026-10-19.json";
import images from "../../db/seed/weekly-2026-10-19-images.json";

/** Weekly-update sections (from the 19 Oct 2026 Central Ops weekly) and that week's report as history. Idempotent. */
export async function seedWeekly(S: RunQ, adminId: string) {
  const users = await S<{ id: string; name: string }>(`select id, name from users`);
  const idOf = (n: string) => users.find((u) => u.name.toLowerCase() === n.toLowerCase())?.id;
  for (const [i, s] of data.sections.entries()) {
    const ids = s.owners.map(idOf).filter(Boolean) as string[];
    const labels = [...s.owner_labels, ...s.owners.filter((n) => !idOf(n))];
    await S(`insert into weekly_sections (key, name, group_name, sort, owner_ids, owner_labels) values ($1,$2,$3,$4,$5,$6)
             on conflict (key) do update set name = excluded.name, group_name = excluded.group_name, sort = excluded.sort, owner_ids = excluded.owner_ids, owner_labels = excluded.owner_labels`,
      [s.key, s.name, s.group, i * 10, ids, labels]);
  }
  const exists = await S(`select 1 from weekly_reports where week_of = $1`, [data.week_of]);
  if (exists.length) return;
  const [rep] = await S<{ id: string }>(
    `insert into weekly_reports (week_of, title, status, exec_summary, exec_engine, approved_by, approved_at, sent_at, sent_by, sent_to)
     values ($1,$2,'sent',$3,'manual',$4, $1::date + time '11:30', $1::date + time '12:10', $4, 'Leadership') returning id`,
    [data.week_of, data.title, data.exec_summary, adminId]);
  for (const s of data.sections) {
    const [sec] = await S<{ id: string }>(`select id from weekly_sections where key = $1`, [s.key]);
    const e = s.entry;
    const owner = s.owners.map(idOf).find(Boolean) ?? null;
    const [en] = await S<{ id: string }>(
      `insert into weekly_entries (report_id, section_id, status, metrics, metrics_note, updates, ahead, blockers, tables, submitted_by, submitted_at, updated_by)
       values ($1,$2,'submitted',$3,$4,$5,$6,$7,$8,$9, $10::date + time '11:00', $9) returning id`,
      [rep.id, sec.id, JSON.stringify(e.metrics), e.metricsNote, e.updates, e.ahead, e.blockers, JSON.stringify(e.tables), owner, data.week_of]);
    for (const [n, img] of ((images as Record<string, { mime: string; caption: string; data: string }[]>)[s.key] ?? []).entries())
      await S(`insert into weekly_images (entry_id, mime, data, caption, sort) values ($1,$2,decode($3,'base64'),$4,$5)`, [en.id, img.mime, img.data, img.caption, n]);
  }
}
