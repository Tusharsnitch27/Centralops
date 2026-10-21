"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import type { CostModel } from "./cost";

export async function saveCostModel(m: CostModel): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin" && u.role !== "pm") throw new Error("Only the PM can change the cost model");
    const clean: CostModel = {
      excluded: (m.excluded ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
      manpower: Object.fromEntries(Object.entries(m.manpower ?? {}).filter(([k, v]) => /^\d{4}-\d{2}-01\|(South|North)$/.test(k) && Number(v) >= 0).map(([k, v]) => [k, Math.round(Number(v))])),
      volumes: { inward: !!m.volumes?.inward, returns: !!m.volumes?.returns, outward: !!m.volumes?.outward },
    };
    await q(`insert into app_settings (key, value) values ('sop.cost_model', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(clean)]);
    revalidatePath("/sop/cost");
    return ok(undefined, "Cost model saved");
  } catch (e) { return fail(e); }
}
