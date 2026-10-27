"use server";
import { revalidatePath } from "next/cache";
import { canManage, requireUser, type User } from "../auth";
import { one, q } from "../db";
import { notify } from "../core/notify";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { loadReport, type DataTable, type Metric } from "./model";
import { draftExecSummary, emailHtml } from "./summary";
import { emailConfig, remindWeeklyOwners, type EmailConfig } from "./delivery";

const refresh = () => revalidatePath("/weekly", "layout");
const MAX_IMG = 4 * 1024 * 1024;

async function entryFor(u: User, entryId: string) {
  const e = await one<{ id: string; status: string; report_status: string; week_of: string; owner_ids: string[]; name: string }>(
    `select e.id, e.status, r.status as report_status, r.week_of, s.owner_ids, s.name
     from weekly_entries e join weekly_reports r on r.id = e.report_id join weekly_sections s on s.id = e.section_id where e.id = $1`, [entryId]);
  if (!e) throw new Error("Section not found");
  if (!canManage(u) && !e.owner_ids.includes(u.id)) throw new Error("Only the section owner or the PM can edit this");
  if (e.report_status === "sent") throw new Error("This update has already been sent");
  return e;
}
async function managedReport(reportId: string) {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only the PM can do this");
  const r = await one<{ id: string; week_of: string; status: string; title: string }>(`select id, week_of, status, title from weekly_reports where id = $1`, [reportId]);
  if (!r) throw new Error("Report not found");
  return { u, r };
}

export interface EntryPatch { metrics?: Metric[]; metrics_note?: string; updates?: string; ahead?: string; blockers?: string; tables?: DataTable[] }

export async function saveEntry(entryId: string, p: EntryPatch, submit = false): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const e = await entryFor(u, entryId);
    const clean = (s?: string) => (s ?? "").replace(/\r/g, "").trim();
    const metrics = (p.metrics ?? []).map((m) => ({ label: clean(m.label), value: clean(m.value), target: clean(m.target) })).filter((m) => m.label || m.value);
    const tables = (p.tables ?? []).map((t) => ({ title: clean(t.title), columns: t.columns.map(clean), rows: t.rows.map((r) => r.map(clean)).filter((r) => r.some(Boolean)) })).filter((t) => t.rows.length || t.columns.some(Boolean));
    if (submit && !clean(p.updates) && !metrics.length && !tables.length && !clean(p.metrics_note))
      throw new Error("Add at least an update, a metric or a table before submitting");
    await q(
      `update weekly_entries set metrics = $2, metrics_note = $3, updates = $4, ahead = $5, blockers = $6, tables = $7, updated_by = $8, updated_at = now(),
         status = case when $9 then 'submitted' when status = 'pending' then 'draft' else status end,
         submitted_by = case when $9 then $8 else submitted_by end, submitted_at = case when $9 then now() else submitted_at end
       where id = $1`,
      [entryId, JSON.stringify(metrics), clean(p.metrics_note), clean(p.updates), clean(p.ahead), clean(p.blockers), JSON.stringify(tables), u.id, submit]);
    if (submit) await logActivity({ actorId: u.id, entityType: "weekly_entry", entityId: entryId, action: "submitted", summary: `${e.name} · week of ${e.week_of}` });
    refresh();
    return ok(undefined, submit ? "Submitted" : "Draft saved");
  } catch (err) { return fail(err); }
}

export async function reopenEntry(entryId: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await entryFor(u, entryId);
    await q(`update weekly_entries set status = 'draft' where id = $1`, [entryId]);
    refresh();
    return ok(undefined, "Reopened for edits");
  } catch (err) { return fail(err); }
}

export async function uploadImage(entryId: string, form: FormData): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await entryFor(u, entryId);
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new Error("Choose an image");
    for (const f of files) {
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) throw new Error(`${f.name}: only PNG, JPG, WebP or GIF`);
      if (f.size > MAX_IMG) throw new Error(`${f.name}: keep screenshots under 4 MB`);
      const buf = Buffer.from(await f.arrayBuffer());
      await q(`insert into weekly_images (entry_id, mime, data, caption, sort, created_by)
               values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from weekly_images where entry_id = $1),$5)`,
        [entryId, f.type, buf, String(form.get("caption") ?? "").trim(), u.id]);
    }
    await q(`update weekly_entries set status = case when status = 'pending' then 'draft' else status end, updated_at = now(), updated_by = $2 where id = $1`, [entryId, u.id]);
    refresh();
    return ok(undefined, files.length > 1 ? `${files.length} screenshots added` : "Screenshot added");
  } catch (err) { return fail(err); }
}

export async function updateImage(imageId: string, caption: string | null): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const img = await one<{ entry_id: string }>(`select entry_id from weekly_images where id = $1`, [imageId]);
    if (!img) throw new Error("Screenshot not found");
    await entryFor(u, img.entry_id);
    if (caption === null) await q(`delete from weekly_images where id = $1`, [imageId]);
    else await q(`update weekly_images set caption = $2 where id = $1`, [imageId, caption.trim()]);
    refresh();
    return ok(undefined, caption === null ? "Screenshot removed" : "Caption saved");
  } catch (err) { return fail(err); }
}

/** PM feedback on a section; optionally sends it back to the owner. */
export async function pmFeedback(entryId: string, comment: string, sendBack: boolean): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can do this");
    const e = await entryFor(u, entryId);
    await q(`update weekly_entries set pm_comment = $2, status = case when $3 then 'draft' else status end where id = $1`, [entryId, comment.trim(), sendBack]);
    if (sendBack) for (const id of e.owner_ids)
      await notify({ userId: id, kind: "weekly_feedback", title: `Changes requested on ${e.name} weekly update`, body: comment.trim() || null, href: `/weekly?week=${e.week_of}#${entryId}`, actorId: u.id });
    refresh();
    return ok(undefined, sendBack ? "Sent back to the owner" : "Feedback saved");
  } catch (err) { return fail(err); }
}

export async function saveExecSummary(reportId: string, text: string, pmNotes?: string): Promise<ActionResult> {
  try {
    const { r } = await managedReport(reportId);
    if (r.status === "sent") throw new Error("Already sent");
    await q(`update weekly_reports set exec_summary = $2, exec_engine = coalesce(exec_engine, 'manual'), pm_notes = coalesce($3, pm_notes), updated_at = now() where id = $1`, [reportId, text.trim(), pmNotes ?? null]);
    refresh();
    return ok(undefined, "Executive summary saved");
  } catch (err) { return fail(err); }
}

export async function generateExecSummary(reportId: string): Promise<ActionResult<{ text: string; engine: string }>> {
  try {
    const { u, r } = await managedReport(reportId);
    const v = (await loadReport(r.week_of, u))!;
    const d = await draftExecSummary(v);
    return ok(d, d.engine === "claude" ? "Drafted by Claude — review and save" : "Drafted from the updates (AI is off) — review and save");
  } catch (err) { return fail(err); }
}

export async function setReportStatus(reportId: string, status: "collecting" | "review" | "approved"): Promise<ActionResult> {
  try {
    const { u, r } = await managedReport(reportId);
    if (r.status === "sent") throw new Error("Already sent");
    if (status === "approved") {
      const s = await one<{ exec_summary: string }>(`select exec_summary from weekly_reports where id = $1`, [reportId]);
      if (!s?.exec_summary.trim()) throw new Error("Write or generate the executive summary before approving");
    }
    await q(`update weekly_reports set status = $2, approved_by = case when $2 = 'approved' then $3::uuid else null end,
               approved_at = case when $2 = 'approved' then now() else null end, updated_at = now() where id = $1`, [reportId, status, u.id]);
    await logActivity({ actorId: u.id, entityType: "weekly_report", entityId: reportId, action: status, summary: r.title });
    refresh();
    return ok(undefined, status === "approved" ? "Approved — ready to send" : status === "review" ? "Moved to review" : "Reopened for updates");
  } catch (err) { return fail(err); }
}

/** In-app + WhatsApp nudge to owners of sections not yet submitted. */
export async function remindPending(reportId: string): Promise<ActionResult> {
  try {
    const { u, r } = await managedReport(reportId);
    const n = await remindWeeklyOwners(r.week_of, u.id);
    return ok(undefined, n ? `Reminded ${n} owner${n > 1 ? "s" : ""}` : "Everyone has submitted");
  } catch (err) { return fail(err); }
}

export async function saveEmailConfig(i: EmailConfig): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    if (i.webhookUrl && !/^https?:\/\/\S+$/.test(i.webhookUrl.trim())) throw new Error("Enter the n8n webhook URL (starts with https://)");
    const cur = await emailConfig();
    const v = { webhookUrl: i.webhookUrl.trim(), secret: i.secret.trim() || cur.secret, recipients: i.recipients.trim(), cc: i.cc.trim() };
    await q(`insert into app_settings (key, value) values ('integrations.email', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(v)]);
    revalidatePath("/settings");
    return ok(undefined, "Email settings saved");
  } catch (err) { return fail(err); }
}

/** Email HTML for "Copy for email" (images inline as data URIs so they paste into Gmail). */
export async function emailHtmlFor(reportId: string): Promise<ActionResult<{ html: string; subject: string }>> {
  try {
    const { u, r } = await managedReport(reportId);
    const v = (await loadReport(r.week_of, u))!;
    let html = emailHtml(v);
    const imgs = await q<{ id: string; mime: string; b64: string }>(
      `select i.id, i.mime, encode(i.data, 'base64') as b64 from weekly_images i join weekly_entries e on e.id = i.entry_id where e.report_id = $1`, [reportId]);
    for (const i of imgs) html = html.replace(`cid:${i.id}`, `data:${i.mime};base64,${i.b64.replace(/\s/g, "")}`);
    return ok({ html, subject: r.title });
  } catch (err) { return fail(err); }
}

/** Send the approved update to leadership through the n8n email webhook. */
export async function sendToLeadership(reportId: string): Promise<ActionResult> {
  try {
    const { u, r } = await managedReport(reportId);
    if (r.status !== "approved") throw new Error("Approve the update before sending");
    const cfg = await emailConfig();
    if (!cfg.webhookUrl || !cfg.recipients) throw new Error("Set up email sending in Settings › Integrations (n8n webhook + leadership recipients), or use Copy for email");
    const v = (await loadReport(r.week_of, u))!;
    const imgs = await q<{ id: string; mime: string; caption: string; b64: string; section: string }>(
      `select i.id, i.mime, i.caption, encode(i.data, 'base64') as b64, s.name as section
       from weekly_images i join weekly_entries e on e.id = i.entry_id join weekly_sections s on s.id = e.section_id where e.report_id = $1 order by s.sort, i.sort`, [reportId]);
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.secret ? { "x-central-ops-secret": cfg.secret } : {}) },
      body: JSON.stringify({
        event: "weekly_update", to: cfg.recipients, cc: cfg.cc, subject: r.title, html: emailHtml(v), from_name: u.name,
        attachments: imgs.map((i, n) => ({ cid: i.id, filename: `${i.section} ${n + 1}.${i.mime.split("/")[1].replace("jpeg", "jpg")}`, mime: i.mime, base64: i.b64.replace(/\s/g, "") })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Email webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await q(`update weekly_reports set status = 'sent', sent_at = now(), sent_by = $2, sent_to = $3, updated_at = now() where id = $1`, [reportId, u.id, cfg.recipients]);
    await logActivity({ actorId: u.id, entityType: "weekly_report", entityId: reportId, action: "sent", summary: `${r.title} → ${cfg.recipients}` });
    refresh();
    return ok(undefined, "Sent to leadership");
  } catch (err) { return fail(err); }
}

/** For when it was emailed by hand (Copy for email). */
export async function markSent(reportId: string, to: string): Promise<ActionResult> {
  try {
    const { u, r } = await managedReport(reportId);
    if (r.status !== "approved") throw new Error("Approve the update first");
    await q(`update weekly_reports set status = 'sent', sent_at = now(), sent_by = $2, sent_to = $3, updated_at = now() where id = $1`, [reportId, u.id, to.trim() || "Leadership (sent manually)"]);
    refresh();
    return ok(undefined, "Marked as sent");
  } catch (err) { return fail(err); }
}

/** PM / admin: re-run the follow-through check (last week's next steps, weak metrics and blockers vs this week). */
export async function runFollowThrough(weekOf: string): Promise<ActionResult<{ sections: number; engine: string }>> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and program managers see the follow-through check");
    const { buildFollowThrough } = await import("./followthrough");
    const { result, engine } = await buildFollowThrough(weekOf, u);
    revalidatePath("/weekly", "layout");
    const n = result.sections.reduce((a, s) => a + s.items.length, 0);
    return ok({ sections: result.sections.length, engine }, result.prev_week_of ? `${n} item${n === 1 ? "" : "s"} to question across ${result.sections.length} function${result.sections.length === 1 ? "" : "s"}` : "No earlier week to compare with");
  } catch (e) { return fail(e); }
}

/**
 * Admin only: wipe every update of a week (entries, screenshots, tables, exec summary, approval / sent state) so it can be rewritten.
 * Second confirmation: the week's date must be typed exactly.
 */
export async function resetWeek(reportId: string, typed: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    const r = await one<{ week_of: string; title: string }>(`select week_of::text as week_of, title from weekly_reports where id = $1`, [reportId]);
    if (!r) throw new Error("Week not found");
    if (typed.trim() !== r.week_of) throw new Error(`Type ${r.week_of} exactly to confirm`);
    const n = (await one<{ n: number }>(`select count(*)::int as n from weekly_entries where report_id = $1 and (status <> 'pending' or updates <> '' or ahead <> '' or metrics <> '[]'::jsonb)`, [reportId]))?.n ?? 0;
    await q(`delete from weekly_entries where report_id = $1`, [reportId]); // images cascade
    await q(`update weekly_reports set status = 'collecting', exec_summary = '', exec_engine = null, pm_notes = '', approved_by = null, approved_at = null,
             sent_at = null, sent_by = null, sent_to = null, followthrough = null, followthrough_engine = null, followthrough_at = null, updated_at = now() where id = $1`, [reportId]);
    await q(`insert into weekly_entries (report_id, section_id) select $1, s.id from weekly_sections s where s.active on conflict do nothing`, [reportId]);
    await logActivity({ actorId: u.id, entityType: "weekly_report", entityId: reportId, action: "reset", summary: `${u.name} cleared all updates of ${r.title} (${n} sections had content) to be rewritten` });
    revalidatePath("/weekly", "layout");
    return ok(undefined, `${r.title}: all updates cleared — owners can fill it in again`);
  } catch (e) { return fail(e); }
}
