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

/** Warehouse capacity from a month onwards: main area + pre-pack area (pre-packs, perfumes, shoes, bags, trolleys). Months already loaded take it at once. */
export async function setWhCapacity(i: { warehouse: "South" | "North"; from: string; capacity: number; special: number | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can change warehouse capacity");
    if (!["South", "North"].includes(i.warehouse)) throw new Error("Pick South or North");
    if (!/^\d{4}-\d{2}-01$/.test(i.from)) throw new Error("Pick the month it applies from");
    const cap = Math.round(Number(i.capacity));
    if (!Number.isFinite(cap) || cap <= 0) throw new Error("Enter the warehouse capacity in units");
    const sp = i.special == null || String(i.special) === "" ? null : Math.round(Number(i.special));
    if (sp != null && (!Number.isFinite(sp) || sp < 0)) throw new Error("Enter the pre-pack area capacity in units");
    await q(`insert into sop_wh_capacity_settings (warehouse, effective_from, capacity, special_capacity, updated_by) values ($1,$2,$3,$4,$5)
             on conflict (warehouse, effective_from) do update set capacity = excluded.capacity, special_capacity = excluded.special_capacity, updated_by = excluded.updated_by, updated_at = now()`,
      [i.warehouse, i.from, cap, sp, u.id]);
    // months from here until the next change take the new capacity
    const until = `(select min(effective_from) from sop_wh_capacity_settings where warehouse = $1 and effective_from > $2)`;
    await q(`update sop_wh_capacity set capacity = $3, special_capacity = $4 where warehouse = $1 and period >= $2 and (${until} is null or period < ${until})`, [i.warehouse, i.from, cap, sp]);
    await q(`update sop_inventory_flow set capacity = $3 where warehouse = $1 and period >= $2 and (${until} is null or period < ${until})`, [i.warehouse, i.from, cap]);
    revalidatePath("/sop", "layout");
    return ok(undefined, `${i.warehouse}: ${(cap / 100000).toFixed(2)}L warehouse${sp != null ? ` · ${(sp / 100000).toFixed(2)}L pre-pack area` : ""} from ${i.from.slice(0, 7)}`);
  } catch (e) { return fail(e); }
}

export async function deleteWhCapacity(warehouse: "South" | "North", from: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can change warehouse capacity");
    const n = await q<{ c: number }>(`select count(*)::int as c from sop_wh_capacity_settings where warehouse = $1`, [warehouse]);
    if ((n[0]?.c ?? 0) <= 1) throw new Error("Keep at least one capacity per warehouse");
    await q(`delete from sop_wh_capacity_settings where warehouse = $1 and effective_from = $2`, [warehouse, from]);
    // re-apply the capacity now in force to every month
    const { whCapacityAt } = await import("./sync");
    const at = await whCapacityAt();
    for (const r of await q<{ period: string }>(`select period::text as period from sop_wh_capacity where warehouse = $1`, [warehouse])) {
      const c = at(warehouse, r.period);
      await q(`update sop_wh_capacity set capacity = $3, special_capacity = $4 where warehouse = $1 and period = $2`, [warehouse, r.period, c.capacity, c.special]);
      await q(`update sop_inventory_flow set capacity = $3 where warehouse = $1 and period = $2`, [warehouse, r.period, c.capacity]);
    }
    revalidatePath("/sop", "layout");
    return ok(undefined, "Capacity change removed");
  } catch (e) { return fail(e); }
}
