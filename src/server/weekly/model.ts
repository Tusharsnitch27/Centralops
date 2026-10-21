import "server-only";
import { one, q } from "../db";
import type { User } from "../auth";
import { canManage } from "../auth";
import { addDays, today } from "@/lib/dates";

export type ReportStatus = "collecting" | "review" | "approved" | "sent";
export type EntryStatus = "pending" | "draft" | "submitted";
export interface Metric { label: string; value: string; target: string }
export interface DataTable { title: string; columns: string[]; rows: string[][] }
export interface WeeklyImage { id: string; caption: string; mime: string }
export interface WeeklySection {
  id: string; key: string; name: string; group_name: string; sort: number;
  owner_ids: string[]; owner_labels: string[]; owners: string[];
}
export interface WeeklyEntry {
  id: string; section_id: string; status: EntryStatus; metrics: Metric[]; metrics_note: string; updates: string; ahead: string; blockers: string;
  tables: DataTable[]; pm_comment: string; updated_at: string; submitted_at: string | null; submitted_by_name: string | null; images: WeeklyImage[];
}
export interface WeeklyReport {
  id: string; week_of: string; title: string; status: ReportStatus; exec_summary: string; exec_engine: string | null; pm_notes: string;
  approved_at: string | null; approved_by_name: string | null; sent_at: string | null; sent_to: string | null;
}
export interface ReportView {
  report: WeeklyReport; deadline: string;
  rows: { section: WeeklySection; entry: WeeklyEntry; lastAhead: string | null; mine: boolean }[];
  counts: { total: number; submitted: number; draft: number; pending: number };
}

const ORD = (d: number) => (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");
export const weekTitle = (weekOf: string) => {
  const d = new Date(`${weekOf}T00:00:00Z`);
  return `Central Ops Weekly Updates - ${d.getUTCDate()}${ORD(d.getUTCDate())} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
};
/** The Monday an update goes out: today if Monday, else the coming Monday. */
export function currentWeekOf(t = today()) {
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay();
  return dow === 1 ? t : addDays(t, (8 - dow) % 7);
}
/** Owners submit by 12:00 IST on the Monday. */
export const deadlineOf = (weekOf: string) => `${weekOf}T12:00:00+05:30`;

export async function listSections(activeOnly = true) {
  return q<WeeklySection>(
    `select s.id, s.key, s.name, s.group_name, s.sort, s.owner_ids, s.owner_labels,
            coalesce((select array_agg(u.name order by array_position(s.owner_ids, u.id)) from users u where u.id = any(s.owner_ids)), '{}') || s.owner_labels as owners
     from weekly_sections s ${activeOnly ? "where s.active" : ""} order by s.sort, s.name`);
}

/** Create the report and an empty entry per active section (idempotent). */
export async function ensureReport(weekOf: string) {
  await q(`insert into weekly_reports (week_of, title) values ($1, $2) on conflict (week_of) do nothing`, [weekOf, weekTitle(weekOf)]);
  const r = (await one<{ id: string; status: ReportStatus }>(`select id, status from weekly_reports where week_of = $1`, [weekOf]))!;
  if (r.status !== "sent")
    await q(`insert into weekly_entries (report_id, section_id) select $1, s.id from weekly_sections s where s.active on conflict do nothing`, [r.id]);
  return r.id;
}

export async function listReports() {
  return q<{ week_of: string; status: ReportStatus; submitted: number; total: number }>(
    `select r.week_of, r.status, count(e.*) filter (where e.status = 'submitted')::int as submitted, count(e.*)::int as total
     from weekly_reports r left join weekly_entries e on e.report_id = r.id group by r.id order by r.week_of desc limit 12`);
}

export async function loadReport(weekOf: string, u: Pick<User, "id" | "role">): Promise<ReportView | null> {
  const report = await one<WeeklyReport>(
    `select r.id, r.week_of, r.title, r.status, r.exec_summary, r.exec_engine, r.pm_notes, r.approved_at::text as approved_at, a.name as approved_by_name, r.sent_at::text as sent_at, r.sent_to
     from weekly_reports r left join users a on a.id = r.approved_by where r.week_of = $1`, [weekOf]);
  if (!report) return null;
  const [sections, entries, images, prev] = await Promise.all([
    listSections(false),
    q<Omit<WeeklyEntry, "images">>(
      `select e.id, e.section_id, e.status, e.metrics, e.metrics_note, e.updates, e.ahead, e.blockers, e.tables, e.pm_comment, e.updated_at::text as updated_at, e.submitted_at::text as submitted_at, su.name as submitted_by_name
       from weekly_entries e left join users su on su.id = e.submitted_by where e.report_id = $1`, [report.id]),
    q<WeeklyImage & { entry_id: string }>(
      `select i.id, i.entry_id, i.caption, i.mime from weekly_images i join weekly_entries e on e.id = i.entry_id where e.report_id = $1 order by i.sort, i.created_at`, [report.id]),
    q<{ section_id: string; ahead: string }>(
      `select e.section_id, e.ahead from weekly_entries e join weekly_reports r on r.id = e.report_id
       where r.week_of = (select max(week_of) from weekly_reports where week_of < $1)`, [weekOf]),
  ]);
  const manage = canManage(u);
  const rows = entries.flatMap((e) => {
    const section = sections.find((s) => s.id === e.section_id);
    if (!section) return [];
    return [{
      section, entry: { ...e, images: images.filter((i) => i.entry_id === e.id).map(({ entry_id: _x, ...i }) => i) },
      lastAhead: prev.find((p) => p.section_id === e.section_id)?.ahead || null,
      mine: manage || section.owner_ids.includes(u.id),
    }];
  }).sort((a, b) => a.section.sort - b.section.sort);
  const c = (s: EntryStatus) => rows.filter((r) => r.entry.status === s).length;
  return { report, deadline: deadlineOf(weekOf), rows, counts: { total: rows.length, submitted: c("submitted"), draft: c("draft"), pending: c("pending") } };
}

/** Sidebar badge: my sections still open for the current week (all open ones for the PM). */
export async function weeklyPendingCount(u: Pick<User, "id" | "role">) {
  const r = await one<{ n: number }>(
    `select count(*)::int as n from weekly_entries e join weekly_reports r on r.id = e.report_id join weekly_sections s on s.id = e.section_id
     where r.week_of = $1 and r.status = 'collecting' and e.status <> 'submitted' and ($3 or $2 = any(s.owner_ids))`,
    [currentWeekOf(), u.id, canManage(u)]);
  return r?.n ?? 0;
}
