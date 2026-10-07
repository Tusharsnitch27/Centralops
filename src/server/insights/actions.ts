"use server";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { canEdit, requireUser } from "../auth";
import { createTask, requestUpdate } from "../tasks/core";
import { logActivity } from "../core/activity";
import { notify, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { addDays, today } from "@/lib/dates";
import type { SuggestionPayload } from "./engine";

type Row = { id: string; user_id: string; kind: string; title: string; body: string | null; recommendation: string | null; severity: string; href: string | null; payload: SuggestionPayload; entity_type: string | null; entity_id: string | null };

async function load(id: string) {
  const u = await requireUser();
  if (!canEdit(u)) throw new Error("Read-only access");
  const s = await one<Row>(`select id, user_id, kind, title, body, recommendation, severity, href, payload, entity_type, entity_id from ai_suggestions where id = $1 and user_id = $2`, [id, u.id]);
  if (!s) throw new Error("Suggestion not found");
  return { u, s };
}
const close = (id: string, status: "accepted" | "dismissed") => q(`update ai_suggestions set status = $2, resolved_at = now(), updated_at = now() where id = $1`, [id, status]);
const refresh = () => { revalidatePath("/insights"); revalidatePath("/", "layout"); };

export async function createTaskFromSuggestion(id: string): Promise<ActionResult<{ taskId: string }>> {
  try {
    const { u, s } = await load(id);
    const p = s.payload ?? ({} as SuggestionPayload);
    const due = p.dueDate && p.dueDate >= today() ? p.dueDate : addDays(today(), 2);
    const t = await createTask(u.id, {
      title: p.taskTitle ?? s.title, description: [s.body, s.recommendation ? `Suggested: ${s.recommendation}` : null].filter(Boolean).join("\n\n"),
      ownerId: p.ownerId ?? u.id, priority: s.severity === "critical" ? "high" : "medium", dueDate: due, projectId: p.projectId ?? null, source: "ai",
    });
    await close(id, "accepted");
    refresh();
    return ok({ taskId: t.id }, `Task CO-${t.number} created${p.ownerName ? ` for ${p.ownerName}` : ""}`);
  } catch (e) { return fail(e); }
}

/** Creates a manual 30-minute review meeting tomorrow (next weekday) at 11:00 IST with the owner. */
export async function scheduleReviewFromSuggestion(id: string): Promise<ActionResult<{ meetingId: string }>> {
  try {
    const { u, s } = await load(id);
    const p = s.payload ?? ({} as SuggestionPayload);
    let day = addDays(today(), 1);
    while ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) day = addDays(day, 1);
    const start = `${day}T11:00:00+05:30`;
    const meetingId = await tx(async (x) => {
      const m = await x.one<{ id: string }>(
        `insert into meetings (title, starts_at, ends_at, organizer_id, mom_owner_id, project_id, agenda, source, mom_due_at, created_by)
         values ($1, $2::timestamptz, $2::timestamptz + interval '30 minutes', $3, $3, $4, $5, 'manual', $2::timestamptz + interval '24 hours 30 minutes', $3) returning id`,
        [`Review: ${s.title}`.slice(0, 200), start, u.id, p.projectId ?? null, [s.body, s.recommendation].filter(Boolean).join("\n\n")]);
      const attendees = [...new Set([u.id, p.ownerId].filter(Boolean) as string[])];
      for (const a of attendees) await x.q(`insert into meeting_attendees (meeting_id, user_id, name, response) select $1, id, name, 'needs_action' from users where id = $2`, [m!.id, a]);
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: m!.id, action: "created", summary: `Review scheduled from Insights: ${s.title}` }, x);
      if (p.ownerId && p.ownerId !== u.id)
        await notify({ userId: p.ownerId, kind: "meeting", title: `Review scheduled: ${s.title}`, body: `Tomorrow 11:00 with ${u.name}`, entityType: "meeting", entityId: m!.id, href: `/meetings/${m!.id}`, actorId: u.id }, x);
      return m!.id;
    });
    await close(id, "accepted");
    refresh();
    return ok({ meetingId }, `Review scheduled for ${day === addDays(today(), 1) ? "tomorrow" : day} at 11:00${p.ownerName ? ` with ${p.ownerName}` : ""}`);
  } catch (e) { return fail(e); }
}

export async function requestUpdatesFromSuggestion(id: string): Promise<ActionResult> {
  try {
    const { u, s } = await load(id);
    const ids = s.payload?.taskIds ?? [];
    let n = 0;
    for (const t of ids) { try { await requestUpdate(u.id, t); n++; } catch { /* task closed or ownerless — skip */ } }
    await close(id, "accepted");
    refresh();
    return ok(undefined, `Requested ${n} update${n === 1 ? "" : "s"}`);
  } catch (e) { return fail(e); }
}

export async function nudgeFromSuggestion(id: string): Promise<ActionResult> {
  try {
    const { u, s } = await load(id);
    const list = s.payload?.nudge ?? [];
    for (const n of list) {
      await notify({ userId: n.userId, kind: n.kind, title: n.title, body: `${u.name} asked for this via Insights.`, href: n.href, actorId: u.id });
      await toInbox({ userId: n.userId, kind: n.kind === "mom_pending" ? "mom_pending" : n.kind === "aop_input" ? "aop_submission" : "owner_update", title: n.title, href: n.href, priority: 70, dedupeKey: `nudge:${s.id}:${n.userId}` });
    }
    await logActivity({ actorId: u.id, entityType: (s.entity_type as "meeting") ?? "user", entityId: s.entity_id, action: "nudged", summary: s.title });
    await close(id, "accepted");
    refresh();
    return ok(undefined, list.length ? `Nudged ${list.length === 1 ? "1 person" : `${list.length} people`}` : "Marked handled");
  } catch (e) { return fail(e); }
}

export async function dismissSuggestion(id: string): Promise<ActionResult> {
  try {
    await load(id);
    await close(id, "dismissed");
    refresh();
    return ok(undefined, "Dismissed — it won't come back for this situation");
  } catch (e) { return fail(e); }
}

/** Bulk "request updates" for the Exceptions page. */
export async function requestUpdatesForTasks(taskIds: string[]): Promise<ActionResult> {
  try {
    const u = await requireUser();
    let n = 0;
    for (const t of taskIds.slice(0, 50)) { try { await requestUpdate(u.id, t); n++; } catch { /* skip */ } }
    revalidatePath("/exceptions");
    return ok(undefined, `Requested ${n} update${n === 1 ? "" : "s"}`);
  } catch (e) { return fail(e); }
}
