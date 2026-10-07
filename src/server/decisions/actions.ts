"use server";
import { revalidatePath } from "next/cache";
import { one, tx } from "../db";
import { requireUser, canEdit } from "../auth";
import { link, logActivity } from "../core/activity";
import { notify, resolveInbox, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { assertFutureDate } from "../tasks/core";
import { today } from "@/lib/dates";
import { DECISION_STATUS, type DecisionStatus } from "./meta";

const refresh = () => revalidatePath("/", "layout");
const s = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);

export interface DecisionInput {
  id?: string;
  title: string;
  context?: string | null;
  reason?: string | null;
  impact?: string | null;
  status: DecisionStatus;
  decidedOn?: string | null;
  dueDate?: string | null;
  meetingId?: string | null;
  makerId?: string | null;
  projectId?: string | null;
  taskIds?: string[];
}

export async function saveDecision(i: DecisionInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You have read-only access");
    if (!i.title?.trim()) throw new Error("Write the decision");
    if (!(i.status in DECISION_STATUS)) throw new Error("Unknown status");
    const pending = i.status === "pending" || i.status === "proposed";
    const prev = i.id ? await one<{ due_date: string | null; status: string; decided_on: string | null }>(`select due_date, status, decided_on from decisions where id = $1`, [i.id]) : null;
    if (i.id && !prev) throw new Error("Decision not found");
    if (pending && i.dueDate && i.dueDate !== prev?.due_date) assertFutureDate(i.dueDate, "Decide-by date");
    const decidedOn = pending ? null : i.decidedOn || prev?.decided_on || today();
    if (!pending && decidedOn && decidedOn > today()) throw new Error("A decision can't be dated in the future");
    const programId = i.projectId ? (await one<{ program_id: string | null }>(`select program_id from projects where id = $1`, [i.projectId]))?.program_id ?? null : null;
    const id = await tx(async (x) => {
      let id = i.id;
      const vals = [i.title.trim(), s(i.context), s(i.reason), s(i.impact), i.status, decidedOn, pending ? i.dueDate || null : null, i.meetingId || null, i.makerId || null, i.projectId || null, programId];
      if (id) {
        await x.q(`update decisions set title=$2, context=$3, reason=$4, impact=$5, status=$6, decided_on=$7, due_date=$8, meeting_id=$9, decision_maker_id=$10, project_id=$11, program_id=$12 where id = $1`, [id, ...vals]);
        await logActivity({ actorId: u.id, entityType: "decision", entityId: id, action: prev!.status !== i.status ? "status_changed" : "updated", field: prev!.status !== i.status ? "status" : null, from: prev!.status, to: i.status, summary: i.title.trim() }, x);
      } else {
        id = (await x.one<{ id: string }>(
          `insert into decisions (title, context, reason, impact, status, decided_on, due_date, meeting_id, decision_maker_id, project_id, program_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [...vals, u.id]))!.id;
        await logActivity({ actorId: u.id, entityType: "decision", entityId: id, action: "created", summary: i.title.trim() }, x);
      }
      if (i.taskIds) {
        await x.q(`delete from decision_tasks where decision_id = $1`, [id]);
        for (const t of new Set(i.taskIds)) {
          await x.q(`insert into decision_tasks (decision_id, task_id) values ($1,$2) on conflict do nothing`, [id, t]);
          await link("decision", id, "task", t, "drives", u.id, x);
        }
      }
      if (i.meetingId) await link("meeting", i.meetingId, "decision", id, "decided_in", u.id, x);
      if (i.projectId) await link("project", i.projectId, "decision", id, "related", u.id, x);
      if (pending && i.makerId) {
        await toInbox({ userId: i.makerId, kind: "decision", title: `Decision required: ${i.title.trim()}`, body: s(i.context), entityType: "decision", entityId: id,
          href: `/decisions?focus=${id}`, priority: 65, dedupeKey: `decision:${id}:required` }, x);
        if (!prev || prev.status !== i.status) await notify({ userId: i.makerId, kind: "decision_required", title: `Decision required: ${i.title.trim()}`, body: i.dueDate ? `Decide by ${i.dueDate}` : null, entityType: "decision", entityId: id, href: `/decisions?focus=${id}`, actorId: u.id }, x);
      }
      if (!pending) await resolveInbox(`decision:${id}:required`, undefined, x);
      return id;
    });
    refresh();
    return ok({ id }, i.id ? "Decision saved" : pending ? "Decision added to the required list" : "Decision logged");
  } catch (e) { return fail(e); }
}

/** Pending → made, recorded today with the outcome. */
export async function markDecisionMade(id: string, outcome: { title?: string; reason?: string | null; impact?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("You have read-only access");
    const d = await one<{ title: string; status: string; created_by: string | null; decision_maker_id: string | null }>(`select title, status, created_by, decision_maker_id from decisions where id = $1`, [id]);
    if (!d) throw new Error("Decision not found");
    const title = outcome.title?.trim() || d.title;
    await tx(async (x) => {
      await x.q(`update decisions set status = 'made', decided_on = $2, title = $3, reason = coalesce($4, reason), impact = coalesce($5, impact),
                 decision_maker_id = coalesce(decision_maker_id, $6) where id = $1`, [id, today(), title, s(outcome.reason), s(outcome.impact), u.id]);
      await logActivity({ actorId: u.id, entityType: "decision", entityId: id, action: "status_changed", field: "status", from: d.status, to: "made", summary: title }, x);
      await resolveInbox(`decision:${id}:required`, undefined, x);
      for (const uid of new Set([d.created_by, d.decision_maker_id].filter(Boolean) as string[]))
        await notify({ userId: uid, kind: "decision_made", title: `Decided: ${title}`, entityType: "decision", entityId: id, href: `/decisions?focus=${id}`, actorId: u.id }, x);
    });
    refresh();
    return ok(undefined, "Decision recorded");
  } catch (e) { return fail(e); }
}
