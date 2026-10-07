"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canEdit } from "../auth";
import { createTask, TaskError } from "../tasks/core";
import { q, one } from "../db";
import { logActivity } from "../core/activity";
import { matchPerson, matchTeam } from "../core/people";
import { today } from "@/lib/dates";

import type { ActionResult } from "../core/result";
export type { ActionResult };
const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof TaskError || e instanceof Error ? e.message : "Something went wrong" });

export interface QuickInput {
  kind: "task" | "project" | "meeting" | "decision" | "risk" | "followup";
  title: string;
  ownerId?: string | null;
  ownerName?: string | null;
  dueDate?: string | null;
  priority?: "urgent" | "high" | "medium" | "low";
  projectId?: string | null;
  tags?: string[];
  notes?: string | null;
  startsAt?: string | null;
}

/** Global quick add (the + button and ⌘K). Returns the created object's URL. */
export async function quickAdd(i: QuickInput): Promise<ActionResult<{ href: string }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    const title = i.title?.trim();
    if (!title) throw new Error("Give it a title");
    let ownerId = i.ownerId ?? null;
    let ownerTeamId: string | null = null;
    if (!ownerId && i.ownerName) {
      ownerId = (await matchPerson(i.ownerName))?.id ?? null;
      if (!ownerId) ownerTeamId = (await matchTeam(i.ownerName))?.id ?? null;
    }
    let href = "/";
    switch (i.kind) {
      case "task": {
        const t = await createTask(u.id, { title, ownerId: ownerId ?? (ownerTeamId ? null : u.id), ownerTeamId, dueDate: i.dueDate, priority: i.priority, projectId: i.projectId, tags: i.tags, description: i.notes });
        href = `/tasks/${t.id}`;
        break;
      }
      case "followup": {
        // "Waiting on X for Y": a task I own, status waiting, with the person I'm waiting on.
        const t = await createTask(u.id, { title, ownerId: u.id, waitingOnId: ownerId, status: "waiting", source: "followup", dueDate: i.dueDate ?? today(), priority: i.priority, projectId: i.projectId, description: i.notes });
        href = `/tasks/${t.id}`;
        break;
      }
      case "project": {
        const r = await one<{ id: string }>(`insert into projects (name, owner_id, target_date, objective, created_by, start_date) values ($1,$2,$3,$4,$5,current_date) returning id`,
          [title, ownerId ?? u.id, i.dueDate ?? null, i.notes ?? null, u.id]);
        await logActivity({ actorId: u.id, entityType: "project", entityId: r!.id, action: "created", summary: title });
        href = `/projects/${r!.id}`;
        break;
      }
      case "meeting": {
        const start = i.startsAt ? new Date(i.startsAt) : new Date();
        const r = await one<{ id: string }>(
          `insert into meetings (title, starts_at, ends_at, source, organizer_id, mom_owner_id, project_id, created_by, mom_status)
           values ($1,$2,$3,'manual',$4,$5,$6,$4,'pending') returning id`,
          [title, start.toISOString(), new Date(start.getTime() + 30 * 60000).toISOString(), u.id, ownerId ?? u.id, i.projectId ?? null]);
        if (i.notes) await q(`insert into meeting_notes (meeting_id, author_id, kind, body) values ($1,$2,'quick',$3)`, [r!.id, u.id, i.notes]);
        await logActivity({ actorId: u.id, entityType: "meeting", entityId: r!.id, action: "created", summary: title });
        href = `/meetings/${r!.id}`;
        break;
      }
      case "decision": {
        const r = await one<{ id: string }>(`insert into decisions (title, context, decided_on, decision_maker_id, project_id, created_by, status) values ($1,$2,current_date,$3,$4,$5,'made') returning id`,
          [title, i.notes ?? null, ownerId ?? u.id, i.projectId ?? null, u.id]);
        await logActivity({ actorId: u.id, entityType: "decision", entityId: r!.id, action: "created", summary: title });
        href = `/decisions?focus=${r!.id}`;
        break;
      }
      case "risk": {
        const r = await one<{ id: string }>(`insert into risks (title, description, owner_id, project_id, target_date, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
          [title, i.notes ?? null, ownerId ?? u.id, i.projectId ?? null, i.dueDate ?? null, u.id]);
        await logActivity({ actorId: u.id, entityType: "risk", entityId: r!.id, action: "created", summary: title });
        href = `/risks?focus=${r!.id}`;
        break;
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, data: { href } };
  } catch (e) {
    return fail(e) as ActionResult<{ href: string }>;
  }
}

export async function markNotificationsRead(ids?: string[]): Promise<ActionResult> {
  const u = await requireUser();
  if (ids?.length) await q(`update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null`, [u.id, ids]);
  else await q(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [u.id]);
  revalidatePath("/", "layout");
  return { ok: true };
}
