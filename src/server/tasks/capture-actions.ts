"use server";
import { revalidatePath } from "next/cache";
import { requireUser, canEdit } from "../auth";
import { createTask } from "./core";
import { aiFocus, directoryPoc, draftTask, myPending } from "./coach";
import { fail, ok, type ActionResult } from "../core/result";
import { today } from "@/lib/dates";
import { aiConfigured } from "../ai/provider";
import type { DraftInput, FocusBrief, Priority, TaskDraft } from "@/lib/taskDraft";

export async function refineTask(raw: string, cur?: DraftInput): Promise<ActionResult<TaskDraft>> {
  try {
    await requireUser();
    if (!raw.trim()) throw new Error("Write the task first");
    return ok(await draftTask(raw, cur));
  } catch (e) { return fail(e); }
}

export async function saveCapturedTask(d: { title: string; details?: string; outcome?: string; nextStep?: string; dueDate?: string | null; startDate?: string | null; pocName?: string; priority?: Priority; engine?: "claude" | "rules" }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    if (!d.dueDate) throw new Error("Add a due date — every task needs one (you can change it later)");
    if (d.startDate && d.startDate > d.dueDate) throw new Error("Start date can't be after the due date");
    if (d.startDate && d.startDate < today()) throw new Error("Start date can't be in the past");
    const description = [d.details?.trim(), d.outcome?.trim() ? `Done when: ${d.outcome.trim()}` : ""].filter(Boolean).join("\n\n") || null;
    // POC in the directory → they own it; anyone else → I own it and they're recorded as the POC
    const poc = await directoryPoc(d.pocName);
    const row = await createTask(u.id, {
      title: d.title, description, nextStep: d.nextStep?.trim() || null, dueDate: d.dueDate, startDate: d.startDate || null, ownerId: poc?.id ?? u.id, requesterId: u.id,
      pocName: poc ? null : d.pocName?.trim() || null,
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

