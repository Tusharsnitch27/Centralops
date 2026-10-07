"use server";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { requireUser, canEdit } from "../auth";
import { link, logActivity } from "../core/activity";
import { notify, resolveInbox, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { assertFutureDate } from "../tasks/core";
import { RISK_LEVEL } from "@/lib/meta";
import { RISK_STATUS, type RiskStatus } from "./meta";

const refresh = () => revalidatePath("/", "layout");
const s = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));

export interface RiskInput {
  id?: string;
  title: string;
  description?: string | null;
  projectId?: string | null;
  ownerId?: string | null;
  probability: number;
  impact: number;
  mitigation?: string | null;
  triggerSignal?: string | null;
  targetDate?: string | null;
  status?: RiskStatus;
}

async function editor() {
  const u = await requireUser();
  if (!canEdit(u)) throw new Error("You have read-only access");
  return u;
}

export async function saveRisk(i: RiskInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await editor();
    if (!i.title?.trim()) throw new Error("Describe the risk");
    if (i.status && !(i.status in RISK_STATUS)) throw new Error("Unknown status");
    const prev = i.id ? await one<{ target_date: string | null; status: string; probability: number; impact: number; owner_id: string | null }>(`select target_date, status, probability, impact, owner_id from risks where id = $1`, [i.id]) : null;
    if (i.id && !prev) throw new Error("Risk not found");
    if (i.targetDate && i.targetDate !== prev?.target_date) assertFutureDate(i.targetDate, "Target date");
    const p = clamp(i.probability), im = clamp(i.impact);
    const programId = i.projectId ? (await one<{ program_id: string | null }>(`select program_id from projects where id = $1`, [i.projectId]))?.program_id ?? null : null;
    const id = await tx(async (x) => {
      const vals = [i.title.trim(), s(i.description), i.projectId || null, programId, i.ownerId || null, p, im, s(i.mitigation), s(i.triggerSignal), i.targetDate || null];
      let id = i.id;
      if (id) {
        await x.q(`update risks set title=$2, description=$3, project_id=$4, program_id=$5, owner_id=$6, probability=$7, impact=$8, mitigation=$9, trigger_signal=$10, target_date=$11,
                   status = coalesce($12, status), updated_at = now() where id = $1`, [id, ...vals, i.status ?? null]);
        if (prev!.probability * prev!.impact !== p * im)
          await logActivity({ actorId: u.id, entityType: "risk", entityId: id, action: "rescored", field: "score", from: prev!.probability * prev!.impact, to: p * im, summary: i.title.trim() }, x);
        else await logActivity({ actorId: u.id, entityType: "risk", entityId: id, action: "updated", summary: i.title.trim() }, x);
      } else {
        id = (await x.one<{ id: string }>(
          `insert into risks (title, description, project_id, program_id, owner_id, probability, impact, mitigation, trigger_signal, target_date, status, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, [...vals, i.status ?? "open", u.id]))!.id;
        await logActivity({ actorId: u.id, entityType: "risk", entityId: id, action: "created", summary: i.title.trim() }, x);
        if (i.projectId) await link("project", i.projectId, "risk", id, "related", u.id, x);
      }
      if (i.ownerId && i.ownerId !== prev?.owner_id)
        await notify({ userId: i.ownerId, kind: "risk_assigned", title: `You own a risk: ${i.title.trim()}`, body: `${RISK_LEVEL(p * im).label} · score ${p * im}`, entityType: "risk", entityId: id, href: `/risks?focus=${id}`, actorId: u.id }, x);
      return id;
    });
    refresh();
    return ok({ id }, i.id ? "Risk updated" : "Risk logged");
  } catch (e) { return fail(e); }
}

/** Escalate → status escalated, notify admins/PMs and put it in their inbox. */
export async function escalateRisk(id: string, note?: string | null): Promise<ActionResult> {
  try {
    const u = await editor();
    const r = await one<{ title: string; status: string; score: number; project_name: string | null }>(
      `select r.title, r.status, r.score, p.name as project_name from risks r left join projects p on p.id = r.project_id where r.id = $1`, [id]);
    if (!r) throw new Error("Risk not found");
    if (r.status === "escalated") throw new Error("Already escalated");
    const managers = await q<{ id: string }>(`select id from users where active and role in ('admin','pm')`);
    await tx(async (x) => {
      await x.q(`update risks set status = 'escalated', updated_at = now() where id = $1`, [id]);
      await logActivity({ actorId: u.id, entityType: "risk", entityId: id, action: "escalated", field: "status", from: r.status, to: "escalated", summary: r.title }, x);
      const body = [`${RISK_LEVEL(r.score).label} · score ${r.score}`, r.project_name, s(note)].filter(Boolean).join(" · ");
      for (const m of managers) {
        await notify({ userId: m.id, kind: "risk_escalated", title: `Risk escalated: ${r.title}`, body, entityType: "risk", entityId: id, href: `/risks?focus=${id}`, actorId: u.id }, x);
        await toInbox({ userId: m.id, kind: "risk", title: `Escalated risk: ${r.title}`, body, entityType: "risk", entityId: id, href: `/risks?focus=${id}`, priority: 80, dedupeKey: `risk:${id}:escalated` }, x);
      }
    });
    refresh();
    return ok(undefined, `Escalated to ${managers.length} ${managers.length === 1 ? "manager" : "managers"}`);
  } catch (e) { return fail(e); }
}

export async function setRiskStatus(id: string, status: RiskStatus): Promise<ActionResult> {
  try {
    const u = await editor();
    if (!(status in RISK_STATUS)) throw new Error("Unknown status");
    const r = await one<{ title: string; status: string }>(`select title, status from risks where id = $1`, [id]);
    if (!r) throw new Error("Risk not found");
    if (status === "escalated") return escalateRisk(id);
    await q(`update risks set status = $2, updated_at = now() where id = $1`, [id, status]);
    await logActivity({ actorId: u.id, entityType: "risk", entityId: id, action: status === "closed" ? "closed" : "status_changed", field: "status", from: r.status, to: status, summary: r.title });
    if (status === "closed") await resolveInbox(`risk:${id}:escalated`);
    refresh();
    return ok(undefined, status === "closed" ? "Risk closed" : "Status updated");
  } catch (e) { return fail(e); }
}
