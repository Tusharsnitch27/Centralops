"use server";
import { revalidatePath } from "next/cache";
import { canEdit, canManage, requireUser } from "../auth";
import { q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import type { EngineInput } from "@/lib/facilityEngine";
import type { ObDay } from "./capacityTools";

const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

export async function saveObCapacity(rows: ObDay[]): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !["South", "North"].includes(r.warehouse)) continue;
      await q(`insert into sop_ob_capacity (day, warehouse, mp_required, retail_required, planned) values ($1,$2,$3,$4,$5)
               on conflict (day, warehouse) do update set mp_required = excluded.mp_required, retail_required = excluded.retail_required, planned = excluded.planned`,
        [r.day, r.warehouse, n(r.mp_required), n(r.retail_required), n(r.planned)]);
    }
    revalidatePath("/sop/capacity");
    return ok(undefined, "Outbound plan saved");
  } catch (e) { return fail(e); }
}

export async function saveEngineScenario(input: EngineInput): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can save the scenario");
    const clean: EngineInput = {
      caps: input.caps.map((c) => ({ facility: c.facility, inward: n(c.inward), outward: n(c.outward), sticker: n(c.sticker) })),
      loads: input.loads.filter((l) => l.channel.trim()).map((l) => ({ facility: l.facility, channel: l.channel.trim(), inwards: n(l.inwards), picking: n(l.picking), restick: n(l.restick), outward: n(l.outward), priority: !!l.priority })),
    };
    await q(`insert into app_settings (key, value) values ('sop.facility_engine', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify({ ...clean, savedAt: new Date().toISOString() })]);
    revalidatePath("/sop/capacity");
    return ok(undefined, "Scenario saved");
  } catch (e) { return fail(e); }
}

export async function addCallout(i: { title: string; poc: string; meetingDate: string | null; remarks?: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    if (!i.title.trim()) throw new Error("Write the call-out");
    await q(`insert into sop_callouts (meeting_date, title, poc, remarks, sort) values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from sop_callouts))`,
      [i.meetingDate || null, i.title.trim(), i.poc.trim(), (i.remarks ?? "").trim()]);
    revalidatePath("/sop/review");
    return ok(undefined, "Call-out added");
  } catch (e) { return fail(e); }
}
export async function updateCallout(id: string, patch: { status?: "open" | "done"; taskId?: string | null; remarks?: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    if (patch.status) await q(`update sop_callouts set status = $2 where id = $1`, [id, patch.status]);
    if (patch.taskId !== undefined) await q(`update sop_callouts set task_id = $2 where id = $1`, [id, patch.taskId]);
    if (patch.remarks !== undefined) await q(`update sop_callouts set remarks = $2 where id = $1`, [id, patch.remarks.trim()]);
    revalidatePath("/sop/review");
    return ok();
  } catch (e) { return fail(e); }
}
