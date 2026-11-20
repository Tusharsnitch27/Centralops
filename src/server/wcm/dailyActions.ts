"use server";
import { revalidatePath } from "next/cache";
import { tx } from "../db";
import { canManage, requireUser } from "../auth";
import { logActivity } from "../core/activity";
import { createTask } from "../tasks/core";
import { fail, ok, type ActionResult } from "../core/result";
import { activeIpps, availableDe, canPlanSite } from "./daily";
import { checkPool, HOME_FNS, parseTarget, stageKey, type DeployLine, type OpsSite } from "./ops";
import { pullStageOutput } from "./feed";

const COVERAGE_START = "2026-10-29"; // attendance capture starts here
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const isSite = (s: string): s is OpsSite => s === "South" || s === "North";

/**
 * Replace one pool's confirmed split (site × day × home function) in a single transaction.
 * Server re-reads attendance; rejects duplicates, over-assignment, unknown targets, transfers / "Other" idle without a reason,
 * and stale edits (expectedRevision must match the stored revision).
 */
export async function saveDeployment(day: string, site: string, homeFn: string, lines: DeployLine[], expectedRevision: number): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!isSite(site)) throw new Error("Pick South or North");
    if (!(await canPlanSite(u, site))) throw new Error(`Only the ${site} site lead or a program manager can plan ${site}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < COVERAGE_START || day > istToday()) throw new Error(`Pick a day from ${COVERAGE_START} to today`);
    if (!(HOME_FNS as readonly string[]).includes(homeFn)) throw new Error("Unknown home function");
    const available = (await availableDe(day, site)).get(homeFn) ?? 0;
    const clean = lines.map((l) => ({ target: String(l.target), de: Math.round(Number(l.de) * 1000) / 1000, reason: l.reason?.trim() || null }));
    const c = checkPool(available, clean);
    if (c.error) throw new Error(c.error);
    const ipps = await activeIpps(day, site);
    for (const l of clean) {
      const t = parseTarget(l.target)!;
      if (t.kind === "idle") { if (t.reason.startsWith("Other") && !l.reason) throw new Error("Say what the 'Other' idle time was"); continue; }
      const p = ipps.find((x) => stageKey(x.stream, x.stage) === l.target);
      if (!p) throw new Error(`${t.stream} · ${t.stage} has no active IPP at ${site}`);
      if (p.home_fn && p.home_fn !== homeFn && !l.reason) throw new Error(`Moving ${homeFn} people to ${t.stream} · ${t.stage} is a transfer — give the reason`);
    }
    await tx(async (t) => {
      const cur = await t.one<{ revision: number }>(`select revision from wcm_deploy_day where day = $1 and site = $2 and home_fn = $3 for update`, [day, site, homeFn]);
      if ((cur?.revision ?? 0) !== expectedRevision) throw new Error("Someone saved this pool after you opened it — refresh and redo your change");
      const before = await t.q(`select target, de::float8 as de, reason from wcm_deploy where day = $1 and site = $2 and home_fn = $3`, [day, site, homeFn]);
      const rev = expectedRevision + 1;
      // first save: plain insert, so two first saves racing fail on the key instead of one silently overwriting the other
      if (cur) await t.q(`update wcm_deploy_day set available_de = $4, revision = $5, updated_by = $6, updated_at = now() where day = $1 and site = $2 and home_fn = $3`,
        [day, site, homeFn, available, rev, u.id]);
      else await t.q(`insert into wcm_deploy_day (day, site, home_fn, available_de, revision, updated_by) values ($1,$2,$3,$4,$5,$6)`, [day, site, homeFn, available, rev, u.id]);
      await t.q(`delete from wcm_deploy where day = $1 and site = $2 and home_fn = $3`, [day, site, homeFn]);
      for (const l of clean)
        await t.q(`insert into wcm_deploy (day, site, home_fn, target, de, reason) values ($1,$2,$3,$4,$5,$6)`, [day, site, homeFn, l.target, l.de, l.reason]);
      await t.q(`insert into wcm_deploy_history (day, site, home_fn, revision, before, after, actor_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [day, site, homeFn, rev, JSON.stringify(before), JSON.stringify(clean), u.id]);
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: null, action: "wcm_deployment_saved", from: before, to: clean,
        summary: `${site} · ${homeFn} · ${day}: ${c.assigned} DE assigned, ${c.idle} idle, ${c.unassigned} unassigned of ${available}` }, t);
    });
    revalidatePath("/aop/processing/daily");
    return ok(undefined, `${homeFn} saved — ${c.unassigned} DE still unassigned`);
  } catch (e) { return fail(e); }
}

/** Follow-up for a bottleneck / surplus, as a Central Ops task (owner = the person raising it; review date = due date). */
export async function raiseFollowUp(site: string, day: string, title: string, note: string, reviewDate: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!isSite(site) || !(await canPlanSite(u, site))) throw new Error("Only the site lead or a program manager can raise this");
    if (!title.trim()) throw new Error("Say what needs to happen");
    await createTask(u.id, { title: `${site} warehouse · ${title.trim()}`, description: `Daily planner ${day}. ${note.trim()}`, ownerId: u.id, dueDate: reviewDate || null, source: "manual" });
    revalidatePath("/tasks");
    return ok(undefined, "Follow-up created in Tasks");
  } catch (e) { return fail(e); }
}

/** Re-read stage output from Snowflake now (admins / PMs); the 07:00 job does this daily. */
export async function refreshStageOutput(): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and program managers can refresh feeds");
    const r = await pullStageOutput();
    revalidatePath("/aop/processing/daily");
    return ok(undefined, `${r.read} day × stream × stage rows from ${r.from}`);
  } catch (e) { return fail(e); }
}
