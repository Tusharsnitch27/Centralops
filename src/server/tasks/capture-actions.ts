"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canEdit } from "../auth";
import { createTask } from "./core";
import { aiFocus, draftTask, myPending } from "./coach";
import { fail, ok, type ActionResult } from "../core/result";
import { aiConfigured } from "../ai/provider";
import type { FocusBrief, Priority, TaskDraft } from "@/lib/taskDraft";

export async function refineTask(raw: string): Promise<ActionResult<TaskDraft>> {
  try {
    await requireUser();
    if (!raw.trim()) throw new Error("Write the task first");
    return ok(await draftTask(raw));
  } catch (e) { return fail(e); }
}

export async function saveCapturedTask(d: { title: string; details?: string; outcome?: string; nextStep?: string; dueDate?: string | null; ownerId?: string | null; priority?: Priority; engine?: "claude" | "rules" }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    const description = [d.details?.trim(), d.outcome?.trim() ? `Done when: ${d.outcome.trim()}` : ""].filter(Boolean).join("\n\n") || null;
    const row = await createTask(u.id, {
      title: d.title, description, nextStep: d.nextStep?.trim() || null, dueDate: d.dueDate || null, ownerId: d.ownerId || u.id, requesterId: u.id,
      priority: d.priority ?? "medium", source: d.engine === "claude" ? "ai" : "manual",
    });
    revalidatePath("/", "layout");
    return ok({ id: row.id }, "Task added");
  } catch (e) { return fail(e); }
}

export async function planMyDay(): Promise<ActionResult<FocusBrief>> {
  try {
    const u = await requireUser();
    if (!aiConfigured()) throw new Error("AI isn't configured — showing the rule-based focus instead");
    return ok(await aiFocus(await myPending(u.id), u.id));
  } catch (e) { return fail(e); }
}
