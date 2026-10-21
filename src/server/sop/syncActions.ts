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
