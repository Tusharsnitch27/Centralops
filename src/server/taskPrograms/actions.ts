"use server";
import { revalidatePath } from "next/cache";
import { canManage, requireUser } from "../auth";
import { one, q, tx } from "../db";
import { notify } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { createTask } from "../tasks/core";
import { sendWhatsApp } from "../integrations/whatsapp";
import { fmtDate, today } from "@/lib/dates";

const refresh = () => { revalidatePath("/tasks", "layout"); };
async function pm() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only program managers can run programs");
  return u;
}

/** Create a program: one task per person, all due on the same date, requested by the PM. */
export async function createProgram(i: { title: string; details?: string; dueDate: string; userIds: string[]; goalId?: string | null; projectId?: string | null }): Promise<ActionResult<{ id: string; tasks: number }>> {
  try {
    const u = await pm();
    const title = i.title.trim();
    if (!title) throw new Error("Give the program a title");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) || i.dueDate < today()) throw new Error("Pick a due date from today on");
    const people = [...new Set(i.userIds.filter(Boolean))];
    if (!people.length) throw new Error("Add at least one person");
    let id = "";
    await tx(async (x) => {
      const r = await x.one<{ id: string }>(`insert into task_programs (title, details, due_date, goal_id, project_id, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [title, i.details?.trim() || null, i.dueDate, i.goalId || null, i.projectId || null, u.id]);
      id = r!.id;
      for (const p of people) {
        const t = await createTask(u.id, { title, description: i.details?.trim() || null, ownerId: p, requesterId: u.id, dueDate: i.dueDate, priority: "high",
          goalId: i.goalId || null, projectId: i.projectId || null, source: "program" }, { tx: x });
        await x.q(`update tasks set task_program_id = $2 where id = $1`, [t.id, id]);
        await notify({ userId: p, kind: "task_assigned", title: `${u.name}: ${title}`, body: `Due ${fmtDate(i.dueDate)}.${i.details ? ` ${i.details.trim().slice(0, 140)}` : ""}`, entityType: "task", entityId: t.id, href: `/tasks/${t.id}`, actorId: u.id }, x);
      }
    });
    refresh();
    return ok({ id, tasks: people.length }, `Program sent to ${people.length} ${people.length === 1 ? "person" : "people"}`);
  } catch (e) { return fail(e); }
}

/** Remind everyone whose task is still open (or one person): in-app notification + WhatsApp when it is set up. */
export async function remindProgram(programId: string, onlyTaskId?: string): Promise<ActionResult<{ reminded: number }>> {
  try {
    const u = await pm();
    const p = await one<{ title: string; due_date: string }>(`select title, due_date::text from task_programs where id = $1`, [programId]);
    if (!p) throw new Error("Program not found");
    const open = await q<{ id: string; owner_id: string | null }>(
      `select id, owner_id from tasks where task_program_id = $1 and status not in ('completed','cancelled') and owner_id is not null ${onlyTaskId ? "and id = $2" : ""}`,
      onlyTaskId ? [programId, onlyTaskId] : [programId]);
    const late = p.due_date < today();
    for (const t of open) {
      const text = `Reminder from ${u.name}: "${p.title}" — ${late ? `was due ${fmtDate(p.due_date)}` : `due ${fmtDate(p.due_date)}`}. Please update or close it in Central Ops.`;
      await notify({ userId: t.owner_id!, kind: "reminder", title: `Reminder: ${p.title}`, body: late ? `Overdue since ${fmtDate(p.due_date)}` : `Due ${fmtDate(p.due_date)}`, entityType: "task", entityId: t.id, href: `/tasks/${t.id}`, actorId: u.id });
      await sendWhatsApp({ userId: t.owner_id!, params: [p.title, fmtDate(p.due_date)], text, entityType: "task", entityId: t.id, dedupeKey: `program:${programId}:${t.id}:${today()}`, actorId: u.id }).catch(() => null);
    }
    await q(`update task_programs set last_reminded_at = now() where id = $1`, [programId]);
    refresh();
    return ok({ reminded: open.length }, open.length ? `Reminded ${open.length} ${open.length === 1 ? "person" : "people"}` : "Everyone is done");
  } catch (e) { return fail(e); }
}

/** Add people to a running program (each gets the same task). */
export async function addToProgram(programId: string, userIds: string[]): Promise<ActionResult<{ added: number }>> {
  try {
    const u = await pm();
    const p = await one<{ title: string; details: string | null; due_date: string; goal_id: string | null; project_id: string | null }>(`select title, details, due_date::text, goal_id, project_id from task_programs where id = $1`, [programId]);
    if (!p) throw new Error("Program not found");
    const have = new Set((await q<{ owner_id: string }>(`select owner_id from tasks where task_program_id = $1 and owner_id is not null`, [programId])).map((r) => r.owner_id));
    let added = 0;
    await tx(async (x) => {
      for (const uid of new Set(userIds)) {
        if (!uid || have.has(uid)) continue;
        const t = await createTask(u.id, { title: p.title, description: p.details, ownerId: uid, requesterId: u.id, dueDate: p.due_date < today() ? today() : p.due_date, priority: "high", goalId: p.goal_id, projectId: p.project_id, source: "program" }, { tx: x, allowPast: true });
        await x.q(`update tasks set task_program_id = $2 where id = $1`, [t.id, programId]);
        await notify({ userId: uid, kind: "task_assigned", title: `${u.name}: ${p.title}`, body: `Due ${fmtDate(p.due_date)}.`, entityType: "task", entityId: t.id, href: `/tasks/${t.id}`, actorId: u.id }, x);
        added++;
      }
    });
    refresh();
    return ok({ added }, `Added ${added}`);
  } catch (e) { return fail(e); }
}

export async function setProgramStatus(programId: string, status: "open" | "closed"): Promise<ActionResult> {
  try { await pm(); await q(`update task_programs set status = $2 where id = $1`, [programId, status]); refresh(); return ok(undefined, status === "closed" ? "Program closed" : "Program reopened"); }
  catch (e) { return fail(e); }
}
