"use server";
import { granted, grantsFor } from "../auth/grants";
import { applyInputsToPlan } from "./inputPlan";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { requireUser, canEdit, canManage, type User } from "../auth";
import { link, logActivity } from "../core/activity";
import { notify, resolveInbox, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { createTask } from "../tasks/core";
import { fmtDate, fmtMonth, today } from "@/lib/dates";
import { currentPeriod, dueDateFor, isOpenSub, subState, type ActualSource, type Stream } from "./model";
import { projectionLock } from "./queries";

const refresh = () => revalidatePath("/sop", "layout");
const isPeriod = (p: string) => /^\d{4}-\d{2}-01$/.test(p);

async function loadStream(id: string) {
  const s = await one<Stream>(
    `select s.*, u.name as poc_name, u.avatar_color as poc_color from sop_streams s left join users u on u.id = s.poc_id where s.id = $1`, [id]);
  if (!s) throw new Error("Stream not found");
  return s;
}
/** PMs, the stream's POC, or an edit grant on the stream (Settings › Permissions). */
const canSubmitFor = async (u: User, s: Stream) => canManage(u) || s.poc_id === u.id || granted(await grantsFor(u.id, "sop_stream"), [s.id]);

/* ---------------- reminders ---------------- */

async function remindOne(u: User, s: Stream, periods: string[]) {
  if (!s.poc_id) throw new Error(`${s.name} has no POC to remind`);
  const subs = await q<{ period: string; status: string; due_date: string | null; submitted_at: Date | null }>(
    `select period, status, due_date, submitted_at from sop_submissions where stream_id = $1 and period = any($2::date[])`, [s.id, periods]);
  const open = periods.filter((p) => {
    const r = subs.find((x) => x.period === p);
    return isOpenSub(subState(r?.status ?? "pending", r?.due_date ?? dueDateFor(p, s.due_day), r?.submitted_at ?? null));
  });
  if (!open.length) return 0;
  await tx(async (x) => {
    for (const p of open) {
      const due = subs.find((r) => r.period === p)?.due_date ?? dueDateFor(p, s.due_day);
      await x.q(`insert into sop_submissions (stream_id, period, status, due_date) values ($1,$2,'pending',$3) on conflict (stream_id, period) do nothing`, [s.id, p, due]);
      const late = due < today();
      const msg = `Please submit ${s.name} projections for ${fmtMonth(p)} — ${late ? `was due ${fmtDate(due)}` : `due ${fmtDate(due)}`}.`;
      const href = `/sop/inputs?stream=${s.id}&period=${p}#submit`;
      await x.q(`insert into followups (entity_type, entity_id, person_id, requested_by, channel, message, due_at) values ('sop_stream',$1,$2,$3,'in_app',$4,$5)`,
        [s.id, s.poc_id, u.id, msg, `${due}T18:00:00+05:30`]);
      await notify({ userId: s.poc_id, kind: "sop_input", title: `S&OP input ${late ? "overdue" : "requested"}: ${s.name} · ${fmtMonth(p)}`, body: msg, entityType: "sop_stream", entityId: s.id, href, actorId: u.id }, x);
      await toInbox({ userId: s.poc_id!, kind: "sop_submission", title: `Submit ${s.name} projections for ${fmtMonth(p)}`, body: msg, entityType: "sop_stream", entityId: s.id, href, priority: late ? 80 : 60, dedupeKey: `sop:${s.id}:${p}` }, x);
      await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "followed_up", to: s.poc_name ?? s.poc_id, summary: `${s.name} · ${fmtMonth(p)}` }, x);
    }
  });
  return open.length;
}

export async function remindStream(streamId: string, periods: string[]): Promise<ActionResult<{ sent: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to send reminders");
    const s = await loadStream(streamId);
    const sent = await remindOne(u, s, periods.filter(isPeriod));
    refresh();
    return ok({ sent }, sent ? `Reminder sent to ${s.poc_name ?? s.poc_label}` : "Nothing pending for this stream");
  } catch (e) { return fail(e); }
}

export async function remindAllPending(periods: string[]): Promise<ActionResult<{ sent: number; people: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to send reminders");
    const streams = await q<Stream>(`select s.*, u.name as poc_name from sop_streams s left join users u on u.id = s.poc_id where s.active order by s.sort`);
    let sent = 0;
    const people = new Set<string>();
    for (const s of streams) {
      if (!s.poc_id) continue;
      const n = await remindOne(u, s, periods.filter(isPeriod));
      if (n) { sent += n; people.add(s.poc_id); }
    }
    refresh();
    return ok({ sent, people: people.size }, sent ? `Reminded ${people.size} POC${people.size === 1 ? "" : "s"} (${sent} pending input${sent === 1 ? "" : "s"})` : "Everything is in — nothing to remind");
  } catch (e) { return fail(e); }
}

/* ---------------- projections ---------------- */

export interface ValueEntry { lineId: string; label: string; dimension: string; value: number | null }

export async function submitProjections(input: { streamId: string; period: string; entries: ValueEntry[]; note?: string | null }): Promise<ActionResult<{ changed: number; revised: number }>> {
  try {
    const u = await requireUser();
    const s = await loadStream(input.streamId);
    if (!(await canSubmitFor(u, s))) throw new Error(`Only ${s.poc_name ?? "the POC"} or a PM can submit ${s.name} projections`);
    if (!isPeriod(input.period)) throw new Error("Choose a month");
    // projections lock 24 h after they were first submitted; only an admin can change them after that
    const lock = await projectionLock(s.id, input.period);
    if (lock.locked && u.role !== "admin") throw new Error(`${s.name} · ${fmtMonth(input.period)} projections were submitted ${lock.since} and are locked. Ask an admin to change them.`);
    const started = input.period <= currentPeriod();
    const lineIds = new Set((await q<{ id: string }>(`select id from sop_lines where stream_id = $1`, [s.id])).map((r) => r.id));
    let changed = 0, revised = 0;
    await tx(async (x) => {
      for (const e of input.entries) {
        if (!lineIds.has(e.lineId)) continue;
        const v = e.value == null || !Number.isFinite(e.value) ? null : Math.max(0, e.value);
        const cur = await x.one<{ id: string; projection: number | null; revised_projection: number | null }>(
          `select id, projection, revised_projection from sop_values where line_id = $1 and period = $2 and period_label = $3 and dimension = $4`,
          [e.lineId, input.period, e.label ?? "", e.dimension ?? ""]);
        if (!cur) {
          if (v == null) continue;
          await x.q(`insert into sop_values (line_id, period, period_label, dimension, projection, updated_by) values ($1,$2,$3,$4,$5,$6)`,
            [e.lineId, input.period, e.label ?? "", e.dimension ?? "", v, u.id]);
          changed++;
          continue;
        }
        const eff = cur.revised_projection ?? cur.projection;
        if (v === eff) continue;
        if (started && cur.projection != null) {
          // month already running: keep the locked projection as baseline, record the change as a revision
          await x.q(`update sop_values set revised_projection = $2, updated_by = $3, updated_at = now() where id = $1`, [cur.id, v === cur.projection ? null : v, u.id]);
          revised++;
        } else {
          await x.q(`update sop_values set projection = $2, updated_by = $3, updated_at = now() where id = $1`, [cur.id, v, u.id]);
        }
        changed++;
      }
      await x.q(
        `insert into sop_submissions (stream_id, period, status, due_date, submitted_at, submitted_by, note) values ($1,$2,'submitted',$3,now(),$4,$5)
         on conflict (stream_id, period) do update set status = 'submitted', submitted_at = now(), submitted_by = excluded.submitted_by, note = coalesce(excluded.note, sop_submissions.note)`,
        [s.id, input.period, dueDateFor(input.period, s.due_day), u.id, input.note?.trim() || null]);
      await x.q(`update sop_submissions set first_submitted_at = coalesce(first_submitted_at, now()) where stream_id = $1 and period = $2`, [s.id, input.period]);
      await x.q(`update followups set status = 'responded', responded_at = now(), response = $2 where entity_type = 'sop_stream' and entity_id = $1 and status = 'open'`,
        [s.id, `Submitted ${fmtMonth(input.period)} projections`]);
      await resolveInbox(`sop:${s.id}:${input.period}`, undefined, x);
      await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: revised ? "projection_revised" : "projection_submitted", field: input.period, to: `${changed} values`, summary: `${s.name} · ${fmtMonth(input.period)}` }, x);
      if (input.note?.trim()) await x.q(`insert into sop_notes (stream_id, period, kind, body, author_id) values ($1,$2,'commentary',$3,$4)`, [s.id, input.period, input.note.trim(), u.id]);
      const review = await x.one<{ owner_id: string | null }>(`select owner_id from reviews where module = 'sop' and active order by created_at limit 1`);
      await notify({ userId: review?.owner_id, kind: "sop_input", title: `${s.name} submitted ${fmtMonth(input.period)} projections`, body: revised ? `${revised} in-month revision${revised === 1 ? "" : "s"} vs baseline` : null, entityType: "sop_stream", entityId: s.id, href: `/sop/projections?stream=${s.id}`, actorId: u.id }, x);
    });
    await applyInputsToPlan(s.id, input.period);
    refresh();
    return ok({ changed, revised }, revised ? `Submitted · ${revised} revised vs baseline` : `Submitted ${fmtMonth(input.period)} projections`);
  } catch (e) { return fail(e); }
}

export async function setSubmissionStatus(streamId: string, period: string, status: "pending" | "not_required"): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only a PM can change submission status");
    const s = await loadStream(streamId);
    await q(`insert into sop_submissions (stream_id, period, status, due_date) values ($1,$2,$3,$4)
             on conflict (stream_id, period) do update set status = excluded.status, submitted_at = case when excluded.status = 'pending' then null else sop_submissions.submitted_at end`,
      [s.id, period, status, dueDateFor(period, s.due_day)]);
    if (status === "not_required") await resolveInbox(`sop:${s.id}:${period}`);
    await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "status_changed", field: period, to: status, summary: `${s.name} · ${fmtMonth(period)}` });
    refresh();
    return ok(undefined, status === "not_required" ? "Marked not required" : "Reopened");
  } catch (e) { return fail(e); }
}

/* ---------------- actuals (manual until Snowflake) ---------------- */

export async function saveActuals(input: { streamId: string; period: string; entries: ValueEntry[] }): Promise<ActionResult<{ changed: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to enter actuals");
    const s = await loadStream(input.streamId);
    if (s.actual_source === "snowflake") throw new Error(`${s.name} actuals come from Snowflake — switch the data source to manual to type them`);
    if (input.period > currentPeriod()) throw new Error("Actuals can't be entered for a future month");
    const lineIds = new Set((await q<{ id: string }>(`select id from sop_lines where stream_id = $1`, [s.id])).map((r) => r.id));
    let changed = 0;
    await tx(async (x) => {
      for (const e of input.entries) {
        if (!lineIds.has(e.lineId)) continue;
        const v = e.value == null || !Number.isFinite(e.value) ? null : Math.max(0, e.value);
        const r = await x.one<{ actual: number | null; actual_source: string | null }>(
          `insert into sop_values (line_id, period, period_label, dimension, actual, actual_source, updated_by) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (line_id, period, period_label, dimension) do update set
             actual = excluded.actual, actual_source = excluded.actual_source, updated_by = excluded.updated_by, updated_at = now()
           where sop_values.actual is distinct from excluded.actual
           returning actual, actual_source`,
          [e.lineId, input.period, e.label ?? "", e.dimension ?? "", v, v == null ? null : "manual", u.id]);
        if (r) changed++;
      }
      if (changed) await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "actuals_entered", field: input.period, to: `${changed} values`, summary: `${s.name} · ${fmtMonth(input.period)}` }, x);
    });
    refresh();
    return ok({ changed }, changed ? `Saved ${changed} actual${changed === 1 ? "" : "s"}` : "No changes");
  } catch (e) { return fail(e); }
}

/* ---------------- capacity ---------------- */

export async function saveCapacity(input: { period: string; department: string; warehouse: "North" | "South"; required?: number | null; available?: number | null; remarks?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to edit capacity");
    if (!isPeriod(input.period)) throw new Error("Choose a month");
    const dept = input.department.trim();
    if (!dept) throw new Error("Department is required");
    if (input.warehouse !== "North" && input.warehouse !== "South") throw new Error("Unknown warehouse");
    const cur = await one<{ required: number | null; available: number | null; remarks: string | null }>(
      `select required, available, remarks from sop_capacity where period = $1 and department = $2 and warehouse = $3`, [input.period, dept, input.warehouse]);
    const next = {
      required: input.required !== undefined ? input.required : cur?.required ?? null,
      available: input.available !== undefined ? input.available : cur?.available ?? null,
      remarks: input.remarks !== undefined ? input.remarks?.trim() || null : cur?.remarks ?? null,
    };
    await q(`insert into sop_capacity (period, department, warehouse, required, available, remarks, updated_by) values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (period, department, warehouse) do update set required = excluded.required, available = excluded.available, remarks = excluded.remarks, updated_by = excluded.updated_by, updated_at = now()`,
      [input.period, dept, input.warehouse, next.required, next.available, next.remarks, u.id]);
    for (const f of ["required", "available", "remarks"] as const)
      if (cur?.[f] !== next[f] && (input[f] !== undefined))
        await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: null, action: "capacity_updated", field: f, from: cur?.[f] ?? null, to: next[f], summary: `${dept} · ${input.warehouse} · ${fmtMonth(input.period)}` });
    refresh();
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}

export async function addCapacityDepartment(period: string, department: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to edit capacity");
    const d = department.trim();
    if (!d) throw new Error("Department name is required");
    await q(`insert into sop_capacity (period, department, warehouse, updated_by) values ($1,$2,'South',$3),($1,$2,'North',$3) on conflict do nothing`, [period, d, u.id]);
    refresh();
    return ok(undefined, `Added ${d}`);
  } catch (e) { return fail(e); }
}

/* ---------------- actions & commentary ---------------- */

export async function createSopAction(input: { title: string; description?: string | null; ownerId?: string | null; dueDate?: string | null; priority?: "urgent" | "high" | "medium" | "low"; streamId?: string | null }): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to create actions");
    const review = await one<{ program_id: string | null }>(`select program_id from reviews where module = 'sop' and active order by created_at limit 1`);
    const t = await createTask(u.id, {
      title: input.title, description: input.description ?? null, ownerId: input.ownerId || null, dueDate: input.dueDate || null,
      priority: input.priority ?? "high", programId: review?.program_id ?? null, source: "sop", tags: ["sop"],
    });
    if (input.streamId) await link("sop_stream", input.streamId, "task", t.id, "action", u.id);
    refresh();
    return ok({ id: t.id, number: t.number }, `Created CO-${t.number}`);
  } catch (e) { return fail(e); }
}

export async function addSopNote(input: { streamId: string; period: string; kind: "commentary" | "variance_reason" | "corrective_action"; body: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You don't have permission to comment");
    if (!input.body.trim()) throw new Error("Write a comment");
    const s = await loadStream(input.streamId);
    await q(`insert into sop_notes (stream_id, period, kind, body, author_id) values ($1,$2,$3,$4,$5)`, [s.id, input.period, input.kind, input.body.trim(), u.id]);
    await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "commented", field: input.kind, to: input.body.trim().slice(0, 200), summary: `${s.name} · ${fmtMonth(input.period)}` });
    if (s.poc_id && s.poc_id !== u.id)
      await notify({ userId: s.poc_id, kind: "comment", title: `Comment on ${s.name} · ${fmtMonth(input.period)}`, body: input.body.trim().slice(0, 140), entityType: "sop_stream", entityId: s.id, href: `/sop/projections?stream=${s.id}`, actorId: u.id });
    refresh();
    return ok(undefined, "Comment added");
  } catch (e) { return fail(e); }
}

/* ---------------- stream configuration ---------------- */

export async function updateStreamSource(input: { streamId: string; actualSource: ActualSource; actualQuery?: string | null; headlineMetric?: string | null; pocId?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only a PM or admin can change data sources");
    if (!["manual", "demo", "snowflake"].includes(input.actualSource)) throw new Error("Unknown source");
    const s = await loadStream(input.streamId);
    await q(`update sop_streams set actual_source = $2, actual_query = $3, headline_metric = $4, poc_id = coalesce($5, poc_id) where id = $1`,
      [s.id, input.actualSource, input.actualQuery?.trim() || null, input.headlineMetric || null, input.pocId || null]);
    if (s.actual_source !== input.actualSource)
      await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "updated", field: "actual_source", from: s.actual_source, to: input.actualSource, summary: s.name });
    if (input.pocId && input.pocId !== s.poc_id)
      await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "assigned", field: "poc", from: s.poc_id, to: input.pocId, summary: s.name });
    refresh();
    return ok(undefined, "Data source saved");
  } catch (e) { return fail(e); }
}

export async function addSopLine(input: { streamId: string; name: string; metric: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only a PM or admin can add lines");
    const name = input.name.trim();
    if (!name) throw new Error("Line name is required");
    const s = await loadStream(input.streamId);
    await q(`insert into sop_lines (stream_id, name, metric, unit, sort) values ($1,$2,$3,'units',(select coalesce(max(sort),0)+1 from sop_lines where stream_id = $1))`, [s.id, name, input.metric || "units"]);
    await logActivity({ actorId: u.id, entityType: "sop_stream", entityId: s.id, action: "updated", field: "line", to: name, summary: s.name });
    refresh();
    return ok(undefined, `Added ${name}`);
  } catch (e) { return fail(e); }
}
