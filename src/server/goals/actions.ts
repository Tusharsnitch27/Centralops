"use server";
import { revalidatePath } from "next/cache";
import { canEdit, requireUser } from "../auth";
import { q } from "../db";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { today } from "@/lib/dates";
import type { GoalStatus } from "./queries";

const refresh = () => { revalidatePath("/tasks", "layout"); revalidatePath("/tasks/goals", "layout"); };
async function editor() { const u = await requireUser(); if (!canEdit(u)) throw new Error("Read-only access"); return u; }
const date = (d?: string | null) => { if (!d) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Invalid date"); if (d < today()) throw new Error("Dates can't be in the past"); return d; };

export async function createGoal(i: { title: string; description?: string; ownerId?: string | null; targetDate?: string | null; projectIds?: string[] }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await editor();
    if (!i.title.trim()) throw new Error("Give the goal a title");
    const [g] = await q<{ id: string }>(`insert into goals (title, description, owner_id, target_date, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [i.title.trim(), i.description?.trim() || null, i.ownerId || u.id, date(i.targetDate), u.id]);
    if (i.projectIds?.length) await q(`update projects set goal_id = $1 where id = any($2::uuid[])`, [g.id, i.projectIds]);
    await logActivity({ actorId: u.id, entityType: "project", entityId: null, action: "goal_created", summary: i.title.trim() });
    refresh();
    return ok({ id: g.id }, "Goal added");
  } catch (e) { return fail(e); }
}

export async function updateGoal(id: string, p: { status?: GoalStatus; title?: string; targetDate?: string | null; ownerId?: string | null }): Promise<ActionResult> {
  try {
    await editor();
    if (p.status) await q(`update goals set status = $2, updated_at = now() where id = $1`, [id, p.status]);
    if (p.title?.trim()) await q(`update goals set title = $2, updated_at = now() where id = $1`, [id, p.title.trim()]);
    if (p.targetDate !== undefined) await q(`update goals set target_date = $2, updated_at = now() where id = $1`, [id, date(p.targetDate)]);
    if (p.ownerId !== undefined) await q(`update goals set owner_id = $2, updated_at = now() where id = $1`, [id, p.ownerId]);
    refresh();
    return ok(undefined, "Goal updated");
  } catch (e) { return fail(e); }
}

export async function createProject(i: { name: string; objective?: string; ownerId?: string | null; targetDate?: string | null; goalId?: string | null }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await editor();
    if (!i.name.trim()) throw new Error("Give the project a name");
    const [p] = await q<{ id: string }>(
      `insert into projects (name, objective, owner_id, target_date, start_date, goal_id, status, created_by) values ($1,$2,$3,$4,current_date,$5,'active',$6) returning id`,
      [i.name.trim(), i.objective?.trim() || null, i.ownerId || u.id, date(i.targetDate), i.goalId || null, u.id]);
    await logActivity({ actorId: u.id, entityType: "project", entityId: p.id, action: "created", summary: i.name.trim() });
    refresh();
    return ok({ id: p.id }, "Project created");
  } catch (e) { return fail(e); }
}

export async function linkProjectToGoal(projectId: string, goalId: string | null): Promise<ActionResult> {
  try { await editor(); await q(`update projects set goal_id = $2 where id = $1`, [projectId, goalId]); refresh(); return ok(); } catch (e) { return fail(e); }
}
