"use server";
import { revalidatePath } from "next/cache";
import { q, one, tx } from "../db";
import { requireUser, canEdit, canManage } from "../auth";
import { logActivity, link } from "../core/activity";
import { notify, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { assertFutureDate, createTask } from "../tasks/core";
import { today } from "@/lib/dates";
import { HEALTH, type Health, type Priority } from "@/lib/meta";
import { PROJECT_STATUS, MILESTONE_STATUS, type MilestoneStatus, type ProjectStatus } from "./metrics";

const refresh = () => revalidatePath("/", "layout");
const s = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
const isHealth = (v: unknown): v is Health => typeof v === "string" && v in HEALTH;

async function editor() {
  const u = await requireUser();
  if (!canEdit(u)) throw new Error("You have read-only access");
  return u;
}

/* ---------------- projects ---------------- */

export interface ProjectInput {
  name: string;
  code?: string | null;
  programId?: string | null;
  ownerId?: string | null;
  sponsorId?: string | null;
  teamIds?: string[];
  startDate?: string | null;
  targetDate?: string | null;
  objective?: string | null;
  budget?: number | null;
}

export async function createProject(i: ProjectInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await editor();
    if (!i.name?.trim()) throw new Error("Give the project a name");
    assertFutureDate(i.targetDate, "Target date");
    if (i.startDate && i.targetDate && i.targetDate < i.startDate) throw new Error("Target date must be after the start date");
    const code = s(i.code)?.toUpperCase().replace(/[^A-Z0-9-]/g, "") || null;
    if (code && (await one(`select 1 from projects where code = $1`, [code]))) throw new Error(`Code ${code} is already used`);
    const id = await tx(async (x) => {
      const r = await x.one<{ id: string }>(
        `insert into projects (name, code, program_id, owner_id, sponsor_id, objective, start_date, target_date, budget, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [i.name.trim(), code, i.programId || null, i.ownerId || null, i.sponsorId || null, s(i.objective), i.startDate || null, i.targetDate || null,
          i.budget ?? null, i.startDate && i.startDate > today() ? "planned" : "active", u.id]);
      for (const t of new Set(i.teamIds ?? [])) await x.q(`insert into project_teams (project_id, team_id) values ($1,$2) on conflict do nothing`, [r!.id, t]);
      await logActivity({ actorId: u.id, entityType: "project", entityId: r!.id, action: "created", summary: i.name.trim() }, x);
      if (i.programId) await link("program", i.programId, "project", r!.id, "contains", u.id, x);
      if (i.ownerId && i.ownerId !== u.id)
        await notify({ userId: i.ownerId, kind: "project_assigned", title: `You own a new project: ${i.name.trim()}`, entityType: "project", entityId: r!.id, href: `/projects/${r!.id}`, actorId: u.id }, x);
      return r!.id;
    });
    refresh();
    return ok({ id }, "Project created");
  } catch (e) { return fail(e); }
}

export interface ProjectPatch {
  name?: string;
  objective?: string | null;
  status?: ProjectStatus;
  health?: Health;
  ownerId?: string | null;
  sponsorId?: string | null;
  programId?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  budget?: number | null;
  spent?: number | null;
  teamIds?: string[];
}

const COLS: Record<string, string> = {
  name: "name", objective: "objective", status: "status", health: "health", ownerId: "owner_id", sponsorId: "sponsor_id", programId: "program_id",
  startDate: "start_date", targetDate: "target_date", budget: "budget", spent: "spent",
};

export async function updateProject(id: string, p: ProjectPatch): Promise<ActionResult> {
  try {
    const u = await editor();
    await tx(async (x) => {
      const cur = await x.one<Record<string, unknown>>(`select * from projects where id = $1 for update`, [id]);
      if (!cur) throw new Error("Project not found");
      if (!canManage(u) && cur.owner_id !== u.id) throw new Error("Only the project owner or a PM can change this project");
      if (p.status && !(p.status in PROJECT_STATUS)) throw new Error("Unknown status");
      if (p.health && !isHealth(p.health)) throw new Error("Unknown health");
      if (p.targetDate !== undefined && p.targetDate !== cur.target_date) assertFutureDate(p.targetDate, "Target date");
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, col] of Object.entries(COLS)) {
        const v = (p as Record<string, unknown>)[k];
        if (v === undefined) continue;
        const nv = typeof v === "string" ? v.trim() || null : v;
        if (k === "name" && !nv) throw new Error("Name can't be empty");
        if (String(nv ?? "") === String(cur[col] ?? "")) continue;
        vals.push(nv);
        sets.push(`${col} = $${vals.length}`);
        await logActivity({ actorId: u.id, entityType: "project", entityId: id, action: k === "health" || k === "status" ? `${k}_changed` : "updated", field: col, from: cur[col], to: nv, summary: String(cur.name) }, x);
      }
      if (p.teamIds) {
        await x.q(`delete from project_teams where project_id = $1`, [id]);
        for (const t of new Set(p.teamIds)) await x.q(`insert into project_teams (project_id, team_id) values ($1,$2) on conflict do nothing`, [id, t]);
      }
      if (sets.length) {
        vals.push(id);
        await x.q(`update projects set ${sets.join(", ")}, updated_at = now() where id = $${vals.length}`, vals);
      }
      if (p.health && p.health !== cur.health && p.health !== "on_track" && cur.sponsor_id)
        await notify({ userId: cur.sponsor_id as string, kind: "project_health", title: `${cur.name} is now ${HEALTH[p.health].label.toLowerCase()}`, entityType: "project", entityId: id, href: `/projects/${id}`, actorId: u.id }, x);
    });
    refresh();
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}

/* ---------------- milestones ---------------- */

export interface MilestoneInput { id?: string; projectId: string; title: string; dueDate: string | null; baselineDate?: string | null; status?: MilestoneStatus; note?: string | null }

export async function saveMilestone(i: MilestoneInput): Promise<ActionResult> {
  try {
    const u = await editor();
    if (!i.title?.trim()) throw new Error("Give the milestone a title");
    if (i.status && !(i.status in MILESTONE_STATUS)) throw new Error("Unknown status");
    await tx(async (x) => {
      const pr = await x.one<{ name: string }>(`select name from projects where id = $1`, [i.projectId]);
      if (!pr) throw new Error("Project not found");
      if (!i.id) {
        assertFutureDate(i.dueDate);
        const sort = (await x.one<{ n: number }>(`select coalesce(max(sort), -1)::int + 1 as n from milestones where project_id = $1`, [i.projectId]))!.n;
        const r = await x.one<{ id: string }>(
          `insert into milestones (project_id, title, due_date, baseline_date, status, sort) values ($1,$2,$3,$4,$5,$6) returning id`,
          [i.projectId, i.title.trim(), i.dueDate || null, i.baselineDate || i.dueDate || null, i.status ?? "pending", sort]);
        await logActivity({ actorId: u.id, entityType: "milestone", entityId: r!.id, action: "created", summary: `${pr.name} · ${i.title.trim()}` }, x);
        return;
      }
      const cur = await x.one<{ title: string; due_date: string | null; baseline_date: string | null; status: string }>(`select title, due_date, baseline_date, status from milestones where id = $1 for update`, [i.id]);
      if (!cur) throw new Error("Milestone not found");
      if (i.dueDate !== cur.due_date) {
        assertFutureDate(i.dueDate);
        await logActivity({ actorId: u.id, entityType: "milestone", entityId: i.id, action: "due_changed", field: "due_date", from: cur.due_date, to: i.dueDate, summary: `${pr.name} · ${cur.title}${i.note ? ` — ${i.note}` : ""}` }, x);
      }
      const status = i.status ?? cur.status;
      await x.q(
        `update milestones set title = $2, due_date = $3, baseline_date = coalesce(baseline_date, $4), status = $5,
           completed_at = case when $5 = 'done' then coalesce(completed_at, now()) else null end where id = $1`,
        [i.id, i.title.trim(), i.dueDate || null, i.baselineDate ?? cur.due_date, status]);
      if (status !== cur.status) await logActivity({ actorId: u.id, entityType: "milestone", entityId: i.id, action: "status_changed", field: "status", from: cur.status, to: status, summary: `${pr.name} · ${cur.title}` }, x);
    });
    refresh();
    return ok(undefined, i.id ? "Milestone updated" : "Milestone added");
  } catch (e) { return fail(e); }
}

export async function setMilestoneStatus(id: string, status: MilestoneStatus): Promise<ActionResult> {
  try {
    const u = await editor();
    if (!(status in MILESTONE_STATUS)) throw new Error("Unknown status");
    const cur = await one<{ title: string; status: string; project_name: string }>(
      `select m.title, m.status, p.name as project_name from milestones m join projects p on p.id = m.project_id where m.id = $1`, [id]);
    if (!cur) throw new Error("Milestone not found");
    await q(`update milestones set status = $2, completed_at = case when $2 = 'done' then now() else null end where id = $1`, [id, status]);
    await logActivity({ actorId: u.id, entityType: "milestone", entityId: id, action: status === "done" ? "completed" : "status_changed", field: "status", from: cur.status, to: status, summary: `${cur.project_name} · ${cur.title}` });
    refresh();
    return ok(undefined, status === "done" ? "Milestone completed" : "Milestone updated");
  } catch (e) { return fail(e); }
}

/* ---------------- project updates ---------------- */

export interface ProjectUpdateInput {
  whatChanged: string;
  progress?: string | null;
  blockers?: string | null;
  decisionsRequired?: string | null;
  nextSteps?: string | null;
  expectedCompletion?: string | null;
  percentComplete?: number | null;
  health?: Health | null;
}

export async function postProjectUpdate(projectId: string, i: ProjectUpdateInput): Promise<ActionResult> {
  try {
    const u = await editor();
    if (!i.whatChanged?.trim()) throw new Error("Say what changed since the last update");
    if (i.health && !isHealth(i.health)) throw new Error("Unknown health");
    assertFutureDate(i.expectedCompletion, "Expected completion");
    const pctDone = i.percentComplete == null || Number.isNaN(i.percentComplete) ? null : Math.max(0, Math.min(100, Math.round(i.percentComplete)));
    await tx(async (x) => {
      const p = await x.one<{ name: string; health: Health; owner_id: string | null; sponsor_id: string | null; created_by: string | null }>(
        `select name, health, owner_id, sponsor_id, created_by from projects where id = $1 for update`, [projectId]);
      if (!p) throw new Error("Project not found");
      await x.q(
        `insert into project_updates (project_id, author_id, what_changed, progress, blockers, decisions_required, next_steps, expected_completion, percent_complete, health)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, u.id, i.whatChanged.trim(), s(i.progress), s(i.blockers), s(i.decisionsRequired), s(i.nextSteps), i.expectedCompletion || null, pctDone, i.health ?? null]);
      if (i.health && i.health !== p.health) {
        await x.q(`update projects set health = $2, updated_at = now() where id = $1`, [projectId, i.health]);
        await logActivity({ actorId: u.id, entityType: "project", entityId: projectId, action: "health_changed", field: "health", from: p.health, to: i.health, summary: p.name }, x);
      } else await x.q(`update projects set updated_at = now() where id = $1`, [projectId]);
      await logActivity({ actorId: u.id, entityType: "project", entityId: projectId, action: "update_posted", to: i.whatChanged.trim(), summary: p.name }, x);
      // answers open update requests
      const reqs = await x.q<{ requested_by: string | null }>(
        `update followups set status = 'responded', responded_at = now(), response = $2 where entity_type = 'project' and entity_id = $1 and status = 'open' returning requested_by`,
        [projectId, i.whatChanged.trim()]);
      await x.q(`update inbox_items set status = 'done', resolved_at = now() where dedupe_key like $1 and status <> 'done'`, [`project:${projectId}:update-request%`]);
      const audience = new Set([p.sponsor_id, p.created_by, p.owner_id, ...reqs.map((r) => r.requested_by)].filter(Boolean) as string[]);
      for (const uid of audience)
        await notify({ userId: uid, kind: "project_update", title: `Update on ${p.name}`, body: i.whatChanged.trim().slice(0, 160), entityType: "project", entityId: projectId, href: `/projects/${projectId}?tab=updates`, actorId: u.id }, x);
    });
    refresh();
    return ok(undefined, "Update posted");
  } catch (e) { return fail(e); }
}

/** Ask the project owner for a structured update → follow-up + notification + owner's inbox. */
export async function requestProjectUpdate(projectId: string, message?: string | null): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const p = await one<{ name: string; owner_id: string | null }>(`select name, owner_id from projects where id = $1`, [projectId]);
    if (!p) throw new Error("Project not found");
    if (!p.owner_id) throw new Error("This project has no owner to ask");
    if (p.owner_id === u.id) throw new Error("You own this project — post the update yourself");
    const msg = message?.trim() || `Could you post a status update on “${p.name}” — what changed, blockers, and expected completion?`;
    await tx(async (x) => {
      await x.q(`insert into followups (entity_type, entity_id, person_id, requested_by, channel, message) values ('project',$1,$2,$3,'in_app',$4)`, [projectId, p.owner_id, u.id, msg]);
      await logActivity({ actorId: u.id, entityType: "project", entityId: projectId, action: "followed_up", to: p.owner_id, summary: p.name }, x);
      await notify({ userId: p.owner_id, kind: "followup", title: `Update requested: ${p.name}`, body: msg, entityType: "project", entityId: projectId, href: `/projects/${projectId}?tab=updates`, actorId: u.id }, x);
      await toInbox({ userId: p.owner_id!, kind: "owner_update", title: `Post an update on ${p.name}`, body: msg, entityType: "project", entityId: projectId,
        href: `/projects/${projectId}?tab=updates`, priority: 70, dedupeKey: `project:${projectId}:update-request:${today()}` }, x);
    });
    refresh();
    return ok(undefined, "Update requested");
  } catch (e) { return fail(e); }
}

/* ---------------- tasks & files ---------------- */

export interface ProjectTaskInput { title: string; ownerId?: string | null; ownerTeamId?: string | null; dueDate?: string | null; priority?: Priority; milestoneId?: string | null }

export async function addProjectTask(projectId: string, i: ProjectTaskInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await editor();
    const r = await createTask(u.id, {
      title: i.title, ownerId: i.ownerId || null, ownerTeamId: i.ownerId ? null : i.ownerTeamId || null, dueDate: i.dueDate || null,
      priority: i.priority ?? "medium", projectId, milestoneId: i.milestoneId || null, source: "project", requesterId: u.id,
    });
    refresh();
    return ok({ id: r.id }, `CO-${r.number} added`);
  } catch (e) { return fail(e); }
}

export async function addAttachmentLink(entityType: "project" | "program" | "decision" | "risk", entityId: string, name: string, url: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) throw new Error("Paste a full link starting with https://");
    const label = name.trim() || clean.replace(/^https?:\/\//, "").slice(0, 60);
    await q(`insert into attachments (entity_type, entity_id, name, url, mime, uploaded_by) values ($1,$2,$3,$4,'link',$5)`, [entityType, entityId, label, clean, u.id]);
    await logActivity({ actorId: u.id, entityType, entityId, action: "attachment_added", to: label, summary: label });
    refresh();
    return ok(undefined, "Link added");
  } catch (e) { return fail(e); }
}

export async function removeAttachment(id: string): Promise<ActionResult> {
  try {
    const u = await editor();
    const a = await one<{ entity_type: string; entity_id: string; name: string; uploaded_by: string | null }>(`select entity_type, entity_id, name, uploaded_by from attachments where id = $1`, [id]);
    if (!a) throw new Error("Not found");
    if (a.uploaded_by !== u.id && !canManage(u)) throw new Error("Only the person who added it or a PM can remove it");
    await q(`delete from attachments where id = $1`, [id]);
    await logActivity({ actorId: u.id, entityType: a.entity_type as "project", entityId: a.entity_id, action: "attachment_removed", from: a.name, summary: a.name });
    refresh();
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}
