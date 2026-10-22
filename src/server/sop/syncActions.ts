"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { fail, ok, type ActionResult } from "../core/result";
import { ALL_FEEDS, runSync, type FeedKey } from "./sync";

/** Admin: refresh one feed (or all) from Snowflake now. */
export async function refreshFromSnowflake(feed?: FeedKey): Promise<ActionResult<{ results: Awaited<ReturnType<typeof runSync>> }>> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    if (feed && !ALL_FEEDS.includes(feed)) throw new Error("Unknown feed");
    const results = await runSync(feed ? [feed] : undefined, "manual", u.id);
    revalidatePath("/sop", "layout");
    revalidatePath("/settings");
    const bad = results.filter((r) => r.status === "failed");
    return bad.length ? fail(`${bad.length} feed${bad.length > 1 ? "s" : ""} failed — ${bad[0].error}`) as ActionResult<{ results: typeof results }> : ok({ results }, `Refreshed ${results.length} feed${results.length > 1 ? "s" : ""}`);
  } catch (e) { return fail(e) as ActionResult<{ results: Awaited<ReturnType<typeof runSync>> }>; }
}

/** Admin: check the Snowflake connection — user, role, active warehouse and the warehouses this role can use. */
export async function testSnowflake(): Promise<ActionResult<Awaited<ReturnType<typeof import("../snowflake").sfDiagnose>>>> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    const { sfDiagnose } = await import("../snowflake");
    const d = await sfDiagnose();
    return ok(d, `Connected as ${d.user} · role ${d.role} · warehouse ${d.warehouse}`);
  } catch (e) { return fail(e) as ActionResult<never>; }
}

/** Admin: pick the warehouse S&OP refreshes run on (kept in the database, so it survives deploys). */
export async function chooseSnowflakeWarehouse(name: string | null): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (u.role !== "admin") throw new Error("Admins only");
    const { setSfWarehouse } = await import("../snowflake");
    await setSfWarehouse(name);
    revalidatePath("/settings");
    return ok(undefined, name ? `Refreshes now run on ${name}` : "Back to SNOWFLAKE_WAREHOUSE");
  } catch (e) { return fail(e); }
}
