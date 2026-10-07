"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canEdit } from "../auth";
import { addTaskUpdate, requestUpdate, updateTask, type TaskPatch } from "./core";
import { fail, ok, type ActionResult } from "../core/result";
import type { TaskStatus } from "@/lib/meta";

const refresh = () => revalidatePath("/", "layout");

export async function setTaskStatus(id: string, status: TaskStatus, note?: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    await updateTask(u.id, id, { status, note });
    refresh();
    return ok();
  } catch (e) { return fail(e); }
}

export async function patchTask(id: string, patch: TaskPatch): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    await updateTask(u.id, id, patch);
    refresh();
    return ok();
  } catch (e) { return fail(e); }
}

export async function postTaskUpdate(id: string, body: string, status?: TaskStatus): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    await addTaskUpdate(u.id, id, body, status);
    refresh();
    return ok();
  } catch (e) { return fail(e); }
}

export async function requestTaskUpdate(id: string, message?: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await requestUpdate(u.id, id, message);
    refresh();
    return ok(undefined, "Update requested");
  } catch (e) { return fail(e); }
}
