"use server";
import { revalidatePath } from "next/cache";
import { one, tx } from "../db";
import { requireUser } from "../auth";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { CHANNELS, checkSlices, FAMILIES, FUNCTIONS, type Family, type RuleSlice } from "./math";
import { currentSnapshot, previewRule, wcmHeads, wcmRights } from "./queries";

export interface DraftInput { family: Family; head: string; site: "South" | "North" | "Both" | "*"; from: string; slices: RuleSlice[]; driver?: string; reason: string; evidence?: string; replaces?: string | null }

const sectionId = async () => (await one<{ id: string }>(`select s.id from aop_sections s join aop_cycles c on c.id = s.cycle_id and c.status = 'active' where s.parent_id is null and s.name ilike 'warehous%'`))?.id ?? null;

/** Server-side validation of a draft: the target must exist in the snapshot; slices must be well-formed. */
async function validate(d: DraftInput) {
  if (!FAMILIES.includes(d.family)) throw new Error("Unknown cost family");
  if (!["South", "North", "Both", "*"].includes(d.site)) throw new Error("Pick a site");
  if (!/^\d{4}-\d{2}-01$/.test(d.from)) throw new Error("Effective from must be a month");
  if (!d.reason?.trim()) throw new Error("Give the reason for this mapping");
  const snap = await currentSnapshot();
  if (!snap) throw new Error("No Cost Master snapshot loaded");
  if (!(await wcmHeads(snap.id)).some((h) => h.family === d.family && h.head === d.head)) throw new Error(`"${d.head}" isn't a ${d.family} cost head in the snapshot`);
  const slices = (d.slices ?? []).map((s) => ({ fn: s.fn || null, channel: s.channel || null, shared: !!s.shared, share: Number(s.share) }));
  for (const s of slices) {
    if (s.fn && !(FUNCTIONS as readonly string[]).includes(s.fn)) throw new Error(`Unknown function "${s.fn}"`);
    if (s.channel && !(CHANNELS as readonly string[]).includes(s.channel)) throw new Error(`Unknown channel "${s.channel}"`);
  }
  const err = checkSlices(slices);
  if (err) throw new Error(err);
  return { snap, slices };
}

/** What the draft would change, before it is saved or approved. */
export async function previewDraft(d: DraftInput): Promise<ActionResult<Awaited<ReturnType<typeof previewRule>>>> {
  try {
    const u = await requireUser();
    if (!(await wcmRights(u)).draft) throw new Error("Only Warehousing / Packaging owners or program managers can map costs");
    const { snap, slices } = await validate(d);
    return ok(await previewRule(snap.id, { id: "preview", family: d.family, head: d.head, site: d.site, from: d.from, to: null, slices, status: "draft" }));
  } catch (e) { return fail(e); }
}

export async function draftRule(d: DraftInput): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!(await wcmRights(u)).draft) throw new Error("Only Warehousing / Packaging owners or program managers can map costs");
    const { slices } = await validate(d);
    const sec = await sectionId(); // outside the transaction: one connection per tx
    await tx(async (t) => {
      const [r] = await t.q<{ id: string }>(`insert into wcm_rule (family, head, site, effective_from, slices, driver, reason, evidence, replaces, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [d.family, d.head, d.site, d.from, JSON.stringify(slices), d.driver?.trim() || null, d.reason.trim(), d.evidence?.trim() || null, d.replaces ?? null, u.id]);
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: sec, action: "wcm_rule_drafted", to: { id: r!.id, ...d, slices },
        summary: `Draft mapping · ${d.head} (${d.site}) from ${d.from.slice(0, 7)}` }, t);
    });
    revalidatePath("/aop/warehouse");
    return ok(undefined, "Draft saved — it changes nothing until approved");
  } catch (e) { return fail(e); }
}

/**
 * Approve or reject a draft. Approval is atomic: the draft must still be a draft (concurrency guard), and the approved rule it
 * overlaps for the same cost head × site is closed — truncated at the new start if it began earlier, else superseded.
 */
export async function decideRule(id: string, decision: "approve" | "reject", note?: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!(await wcmRights(u)).approve) throw new Error("Only an admin or the Warehousing / Packaging owner (or an AOP approver) can decide mappings");
    const sec = await sectionId(); // outside the transaction: one connection per tx
    await tx(async (t) => {
      const r = await t.one<{ family: string; head: string; site: string; from: string; slices: unknown }>(
        `update wcm_rule set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1 and status = 'draft'
         returning family, head, site, effective_from::text as "from", slices`, [id, decision === "approve" ? "approved" : "rejected", u.id, note?.trim() || null]);
      if (!r) throw new Error("This mapping was already decided — refresh to see its current state");
      let closed = 0;
      if (decision === "approve") {
        closed += (await t.q(`update wcm_rule set effective_to = $5 where id <> $1 and status = 'approved' and family = $2 and head = $3 and site = $4
            and effective_from < $5 and (effective_to is null or effective_to > $5) returning id`, [id, r.family, r.head, r.site, r.from])).length;
        closed += (await t.q(`update wcm_rule set status = 'superseded' where id <> $1 and status = 'approved' and family = $2 and head = $3 and site = $4
            and effective_from >= $5 returning id`, [id, r.family, r.head, r.site, r.from])).length;
      }
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: sec, action: `wcm_rule_${decision === "approve" ? "approved" : "rejected"}`,
        from: { status: "draft" }, to: { id, status: decision === "approve" ? "approved" : "rejected", note, closedEarlierRules: closed },
        summary: `${decision === "approve" ? "Approved" : "Rejected"} mapping · ${r.head} (${r.site}) from ${r.from.slice(0, 7)}` }, t);
    });
    revalidatePath("/aop/warehouse");
    return ok(undefined, decision === "approve" ? "Approved — totals now use this mapping" : "Rejected");
  } catch (e) { return fail(e); }
}

/** Withdraw an approved rule: its amounts return to Unallocated. The record stays for audit. */
export async function reverseRule(id: string, note: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!(await wcmRights(u)).approve) throw new Error("Only an admin or the Warehousing / Packaging owner (or an AOP approver) can reverse mappings");
    if (!note?.trim()) throw new Error("Say why it is being reversed");
    const sec = await sectionId(); // outside the transaction: one connection per tx
    await tx(async (t) => {
      const r = await t.one<{ head: string; site: string }>(`update wcm_rule set status = 'reversed', decided_by = $2, decided_at = now(), decision_note = $3
        where id = $1 and status = 'approved' returning head, site`, [id, u.id, note.trim()]);
      if (!r) throw new Error("Only an approved mapping can be reversed — refresh to see its current state");
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: sec, action: "wcm_rule_reversed", from: { status: "approved" }, to: { id, status: "reversed", note },
        summary: `Reversed mapping · ${r.head} (${r.site})` }, t);
    });
    revalidatePath("/aop/warehouse");
    return ok(undefined, "Reversed — its amounts are back in Unallocated");
  } catch (e) { return fail(e); }
}
