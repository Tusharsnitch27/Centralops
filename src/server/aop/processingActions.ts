"use server";
import { revalidatePath } from "next/cache";
import { tx } from "../db";
import { canManage, requireUser } from "../auth";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { mpAssignments, proposeAssignments } from "./processing";
import { STREAMS, type StreamKey, type Wh } from "./processingTypes";

const WAREHOUSE_LEAD = "manish"; // Manish Charan — assigns attendance heads to stream × process
const isPeriod = (p: string) => /^\d{4}-\d{2}-01$/.test(p);
const isWh = (w: string): w is Wh => w === "South" || w === "North";

/** Warehouse lead (or a PM) confirms how a department's present heads split across stream × process for a month. */
export async function assignManpower(period: string, warehouse: Wh, department: string, lines: { stream: StreamKey; process: string; heads: number }[]): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u) && u.username !== WAREHOUSE_LEAD) throw new Error("Only the warehouse lead or a program manager can assign manpower");
    if (!isPeriod(period) || !isWh(warehouse)) throw new Error("Pick a month and warehouse");
    const a = (await mpAssignments(period, warehouse)).find((x) => x.department === department);
    if (!a) throw new Error(`No attendance for ${department} in ${warehouse} this month`);
    const valid = new Set(a.lines.map((l) => `${l.stream}|${l.process}`));
    for (const l of lines) {
      if (!valid.has(`${l.stream}|${l.process}`) || !STREAMS.some((s) => s.key === l.stream)) throw new Error(`${l.stream} · ${l.process} isn't a ${department} line`);
      if (!Number.isFinite(l.heads) || l.heads < 0) throw new Error("Heads must be zero or more");
    }
    const total = lines.reduce((s, l) => s + l.heads, 0);
    if (total > a.avgHeads + 0.05) throw new Error(`Assigned ${total.toFixed(1)} heads but ${department} had ${a.avgHeads.toFixed(1)} on average`);
    await tx(async (t) => {
      for (const l of lines)
        await t.q(`insert into aop_mp_assign (period, warehouse, department, stream, process, heads, status, assigned_by) values ($1,$2,$3,$4,$5,$6,'assigned',$7)
                   on conflict (period, warehouse, department, stream, process) do update set heads = excluded.heads, status = 'assigned', assigned_by = excluded.assigned_by, updated_at = now()`,
          [period, warehouse, department, l.stream, l.process, l.heads, u.id]);
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: null, action: "manpower_assigned", to: { period, warehouse, department, lines },
        summary: `${department} · ${warehouse} · ${period.slice(0, 7)}: ${total.toFixed(1)} of ${a.avgHeads.toFixed(1)} heads assigned` }, t);
    });
    revalidatePath("/aop/processing");
    return ok(undefined, `${department} assigned (${total.toFixed(1)} heads)`);
  } catch (e) { return fail(e); }
}

/** Write the planned-MP-mix split as proposals for the month (assigned lines untouched). */
export async function proposeManpower(period: string, warehouse: Wh): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only program managers can propose a split");
    if (!isPeriod(period) || !isWh(warehouse)) throw new Error("Pick a month and warehouse");
    const n = await proposeAssignments(period, warehouse);
    revalidatePath("/aop/processing");
    return ok(undefined, `${n} lines proposed`);
  } catch (e) { return fail(e); }
}
