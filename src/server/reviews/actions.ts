"use server";
import { revalidatePath } from "next/cache";
import { one, tx } from "../db";
import { requireUser, canManage } from "../auth";
import { logActivity, type EntityType } from "../core/activity";
import { notify } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";

const refresh = () => revalidatePath("/", "layout");
const s = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
// "review" is not in core EntityType yet (activity_log.entity_type is free text)
const REVIEW = "review" as unknown as EntityType;
const CADENCES = ["daily", "weekly", "fortnightly", "monthly", "quarterly", "adhoc"];
const MODULES = ["aop", "sop", "project", "program", "general"];

async function manager() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only a PM or admin can change review series");
  return u;
}

export interface ReviewInput {
  id?: string;
  name: string;
  cadence: string;
  module?: string | null;
  description?: string | null;
  ownerId?: string | null;
  momOwnerId?: string | null;
  programId?: string | null;
  projectId?: string | null;
  calendarMatch?: string | null;
  active?: boolean;
}

export async function saveReview(i: ReviewInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await manager();
    if (!i.name?.trim()) throw new Error("Name the review");
    if (!CADENCES.includes(i.cadence)) throw new Error("Pick a cadence");
    if (i.module && !MODULES.includes(i.module)) throw new Error("Unknown module");
    const vals = [i.name.trim(), i.cadence, i.module || "general", s(i.description), i.ownerId || null, i.momOwnerId || null, i.programId || null, i.projectId || null, s(i.calendarMatch)?.toLowerCase() ?? null, i.active ?? true];
    const prev = i.id ? await one<{ mom_owner_id: string | null }>(`select mom_owner_id from reviews where id = $1`, [i.id]) : null;
    const id = await tx(async (x) => {
      if (i.id) {
        await x.q(`update reviews set name=$2, cadence=$3, module=$4, description=$5, owner_id=$6, mom_owner_id=$7, program_id=$8, project_id=$9, calendar_match=$10, active=$11 where id = $1`, [i.id, ...vals]);
        if (prev && prev.mom_owner_id !== (i.momOwnerId || null)) await cascadeMomOwner(x, i.id, prev.mom_owner_id, i.momOwnerId || null);
        await logActivity({ actorId: u.id, entityType: REVIEW, entityId: i.id, action: "updated", summary: i.name.trim() }, x);
        return i.id;
      }
      const r = await x.one<{ id: string }>(
        `insert into reviews (name, cadence, module, description, owner_id, mom_owner_id, program_id, project_id, calendar_match, active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, vals);
      await logActivity({ actorId: u.id, entityType: REVIEW, entityId: r!.id, action: "created", summary: i.name.trim() }, x);
      return r!.id;
    });
    refresh();
    return ok({ id }, i.id ? "Review saved" : "Review series created");
  } catch (e) { return fail(e); }
}

type X = Parameters<Parameters<typeof tx>[0]>[0];

/** Upcoming meetings that still carry the old default MoM owner (and have no MoM yet) follow the new default. */
async function cascadeMomOwner(x: X, reviewId: string, from: string | null, to: string | null) {
  const moved = await x.q<{ id: string; title: string; starts_at: string }>(
    `update meetings set mom_owner_id = $3, updated_at = now()
     where review_id = $1 and starts_at >= now() and mom_status = 'pending' and not cancelled and mom_owner_id is not distinct from $2
     returning id, title, starts_at`, [reviewId, from, to]);
  return moved;
}

/** The PM decides who writes the MoM for a review; upcoming meetings of the series default to that person. */
export async function setReviewMomOwner(reviewId: string, userId: string | null): Promise<ActionResult<{ moved: number }>> {
  try {
    const u = await manager();
    const r = await one<{ name: string; mom_owner_id: string | null }>(`select name, mom_owner_id from reviews where id = $1`, [reviewId]);
    if (!r) throw new Error("Review not found");
    if ((userId || null) === r.mom_owner_id) return ok({ moved: 0 });
    const moved = await tx(async (x) => {
      await x.q(`update reviews set mom_owner_id = $2 where id = $1`, [reviewId, userId || null]);
      const m = await cascadeMomOwner(x, reviewId, r.mom_owner_id, userId || null);
      await logActivity({ actorId: u.id, entityType: REVIEW, entityId: reviewId, action: "mom_owner_changed", field: "mom_owner_id", from: r.mom_owner_id, to: userId, summary: r.name }, x);
      if (userId) await notify({ userId, kind: "mom_owner", title: `You now write the MoM for ${r.name}`, body: m.length ? `${m.length} upcoming meeting${m.length === 1 ? "" : "s"} assigned to you.` : null, href: `/reviews/${reviewId}`, actorId: u.id }, x);
      return m.length;
    });
    refresh();
    return ok({ moved }, moved ? `MoM owner updated · ${moved} upcoming meeting${moved === 1 ? "" : "s"} reassigned` : "MoM owner updated");
  } catch (e) { return fail(e); }
}
