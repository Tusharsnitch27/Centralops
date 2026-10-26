"use server";
import { revalidatePath } from "next/cache";
import { requireUser, type User } from "../auth";
import { one, q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import { FROM, rebuild, refreshFrom } from "./sync";

/** Liquidation actuals = gatepass totals, uploaded day-wise (South / North units) by the owner set in app settings (Malhar) or an admin. */
export async function liquidationOwner() {
  const r = await one<{ value: unknown }>(`select value from app_settings where key = 'sop.liquidation_actuals_owner'`);
  const id = typeof r?.value === "string" ? r.value : null;
  return id ? one<{ id: string; name: string }>(`select id, name from users where id = $1`, [id]) : null;
}
const canUpload = async (u: User) => u.role === "admin" || (await liquidationOwner())?.id === u.id;

export async function liquidationDays(period: string) {
  return q<{ day: string; south: number; north: number }>(
    `select day::text, sum(units) filter (where region = 'south')::float8 as south, sum(units) filter (where region = 'north')::float8 as north
     from sop_actuals_daily where feed = 'liquidation' and date_trunc('month', day)::date = $1::date group by day order by day`, [period]);
}

export async function uploadLiquidationActuals(period: string, rows: { day: string; south: number | null; north: number | null }[]): Promise<ActionResult<{ days: number; units: number }>> {
  try {
    const u = await requireUser();
    if (!(await canUpload(u))) throw new Error("Only the liquidation actuals owner (Malhar) or an admin can upload these");
    if (!/^\d{4}-\d{2}-01$/.test(period)) throw new Error("Pick a month");
    const from = await refreshFrom();
    if (period < from.slice(0, 7) + "-01" && u.role !== "admin") throw new Error(`${period.slice(0, 7)} is closed — ask an admin to change it`);
    const ok_ = rows.filter((r) => r.day.startsWith(period.slice(0, 7)) && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && (r.south != null || r.north != null));
    if (!ok_.length) throw new Error("No day in the file has numbers for this month");
    for (const r of ok_) for (const n of [r.south, r.north]) if (n != null && (!Number.isFinite(n) || n < 0)) throw new Error(`${r.day}: units must be 0 or more`);
    let units = 0;
    for (const r of ok_) {
      for (const [region, v] of [["south", r.south], ["north", r.north]] as const) {
        if (v == null) continue;
        units += v;
        await q(`insert into sop_actuals_daily (day, feed, label, region, qty, units) values ($1,'liquidation','',$2,$3,$3)
                 on conflict (day, feed, label, region) do update set qty = excluded.qty, units = excluded.units`, [r.day, region, v]);
      }
    }
    await q(`insert into sop_sync_runs (feed, trigger, from_date, actor_id, status, rows_read, rows_written, message, finished_at) values ('liquidation','manual',$1,$2,'ok',$3,$3,$4,now())`,
      [period, u.id, ok_.length, `Gatepass upload by ${u.name}: ${ok_.length} days, ${Math.round(units)} units`]);
    if (period >= FROM()) await rebuild();
    revalidatePath("/sop", "layout");
    return ok({ days: ok_.length, units }, `Saved ${ok_.length} day${ok_.length === 1 ? "" : "s"} · ${new Intl.NumberFormat("en-IN").format(Math.round(units))} units`);
  } catch (e) { return fail(e); }
}
