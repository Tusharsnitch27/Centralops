"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { q, one } from "../db";
import { createTask } from "../tasks/core";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { parseWorkDump, type CaptureItem } from "./parse";
import { today } from "@/lib/dates";

export async function structureDump(text: string): Promise<ActionResult<{ items: CaptureItem[]; engine: string }>> {
  try {
    await requireUser();
    if (!text.trim()) throw new Error("Write a few lines about what you're working on");
    return ok(await parseWorkDump(text.slice(0, 20000)));
  } catch (e) { return fail(e); }
}

/** Create everything captured, then mark the user onboarded. */
export async function commitCapture(items: CaptureItem[]): Promise<ActionResult<{ created: Record<string, number> }>> {
  try {
    const u = await requireUser();
    const created = { task: 0, project: 0, review: 0, followup: 0 };
    const projectIds = new Map<string, string>();
    // projects first so tasks in the same capture can point at them
    for (const it of items.filter((i) => i.kind === "project" && i.title.trim())) {
      const r = await one<{ id: string }>(`insert into projects (name, owner_id, target_date, objective, created_by, start_date, status) values ($1,$2,$3,$4,$5,$6,'active') returning id`,
        [it.title.trim(), it.owner_id ?? u.id, it.due_date, it.notes, u.id, today()]);
      projectIds.set(it.key, r!.id);
      await logActivity({ actorId: u.id, entityType: "project", entityId: r!.id, action: "created", summary: `${it.title} (captured at onboarding)` });
      created.project++;
    }
    for (const it of items.filter((i) => i.kind === "review" && i.title.trim())) {
      const r = await one<{ id: string }>(`insert into reviews (name, cadence, owner_id, mom_owner_id, module, calendar_match, description) values ($1,$2,$3,$4,'general',$5,$6) returning id`,
        [it.title.trim(), it.cadence ?? "weekly", it.owner_id ?? u.id, it.mom_owner_id ?? it.owner_id ?? u.id, it.title.trim().toLowerCase().slice(0, 40), it.notes]);
      await logActivity({ actorId: u.id, entityType: "program", entityId: r!.id, action: "review_created", summary: it.title });
      created.review++;
    }
    for (const it of items.filter((i) => (i.kind === "task" || i.kind === "followup") && i.title.trim())) {
      const due = it.due_date && it.due_date >= today() ? it.due_date : null;
      if (it.kind === "followup") {
        await createTask(u.id, { title: it.title, ownerId: u.id, waitingOnId: it.owner_id, status: "waiting", source: "onboarding", dueDate: due ?? today(), priority: it.priority, projectId: it.project_id, description: it.notes });
        created.followup++;
      } else {
        await createTask(u.id, { title: it.title, ownerId: it.owner_team_id ? null : it.owner_id ?? u.id, ownerTeamId: it.owner_team_id, source: "onboarding", dueDate: due, priority: it.priority, projectId: it.project_id, description: it.notes });
        created.task++;
      }
    }
    await q(`update users set onboarded_at = now() where id = $1`, [u.id]);
    await q(`update inbox_items set status = 'done', resolved_at = now() where user_id = $1 and dedupe_key = 'onboarding'`, [u.id]);
    revalidatePath("/", "layout");
    return ok({ created });
  } catch (e) { return fail(e) as ActionResult<{ created: Record<string, number> }>; }
}

export async function finishOnboarding(): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await q(`update users set onboarded_at = now() where id = $1`, [u.id]);
    await q(`update inbox_items set status = 'done', resolved_at = now() where user_id = $1 and dedupe_key = 'onboarding'`, [u.id]);
    revalidatePath("/", "layout");
    return ok();
  } catch (e) { return fail(e); }
}
