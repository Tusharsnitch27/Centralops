import "server-only";
import { createHash } from "node:crypto";
import type { RunQ } from "../db";
import { hashPassword } from "../auth/passwords";
import { seedReference } from "./reference";
import { seedDemo } from "./demo";
import { syncDirectory } from "./directory";
import { seedSopReview } from "./sopReview";
import { loadSopSheetInputs, reloadSopB2bMpPlan, reloadSopB2cPlan, reloadSopInwardPlan, reloadSopRetailPlan, reloadSopReturnsPlan, seedSopHistory, seedSopPlanDaily } from "./sopHistory";
import { seedWeekly } from "./weekly";
import { seedHandbook, seedLibrary } from "./library";
import { seedPackaging } from "./packaging";
import { seedOrgChart } from "./orgChart";

const mk = (rawQ: RunQ) => ({
  setting: async (key: string) => (await rawQ<{ value: unknown }>(`select value from app_settings where key = $1`, [key]))[0]?.value ?? null,
  setSetting: (key: string, value: unknown) =>
  rawQ(`insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]),
});

/**
 * Runs after migrations, once per process. Idempotent:
 *  1. first admin account (ADMIN_EMAIL / ADMIN_PASSWORD) — sign-in is email + password
 *  2. reference data from the FY26-27 workbooks: people & owners, teams, programs, recurring reviews, AOP cost plan, S&OP (once)
 *  3. demo activity — projects, tasks, meetings, MoMs — when SEED_DEMO=true and the workspace is empty (once)
 */
export async function bootstrap(rawQ: RunQ) {
  const { setting, setSetting } = mk(rawQ);
  const email = (process.env.ADMIN_EMAIL ?? "admin@snitch.com").trim().toLowerCase();
  const username = (process.env.ADMIN_USERNAME ?? email.split("@")[0]).trim().toLowerCase();
  // persistence check: the first boot is stamped once; every start bumps the counter — if a deploy ever resets the database,
  // /api/health shows a new "since" date and boots back at 1
  if (!(await setting("app.first_boot"))) await setSetting("app.first_boot", new Date().toISOString());
  await rawQ(`insert into app_settings (key, value) values ('app.boots', '1'::jsonb) on conflict (key) do update set value = to_jsonb(coalesce((app_settings.value #>> '{}')::int, 0) + 1), updated_at = now()`);
  const existing = await rawQ<{ id: string }>(`select id from users where role = 'admin' limit 1`);
  if (!existing.length) {
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw) console.warn("[seed] ADMIN_PASSWORD not set — admin account created without a password; set ADMIN_PASSWORD and restart");
    await rawQ(
      `insert into users (username, email, name, title, role, password_hash, joined_at)
       values ($1,$2,$3,'Program Manager · Central Ops','admin',$4,current_date)
       on conflict (username) do update set role = 'admin'`,
      [username, email, process.env.ADMIN_NAME || "Tushar", pw ? await hashPassword(pw) : null],
    );
    console.log(`[seed] admin account ${email} created`);
  }
  // the ADMIN_EMAIL account must always be able to sign in (Long Tail's bootstrap rule): create it if another admin
  // exists under a different email, and set the password when it has none — or on demand with ADMIN_RESET_PASSWORD=true
  const pw = process.env.ADMIN_PASSWORD;
  const mine = await rawQ<{ id: string; password_hash: string | null }>(`select id, password_hash from users where lower(email) = $1`, [email]);
  if (!mine.length && pw) {
    await rawQ(
      `insert into users (username, email, name, title, role, password_hash, joined_at) values ($1,$2,$3,'Program Manager · Central Ops','admin',$4,current_date)
       on conflict (username) do update set email = excluded.email, role = 'admin', password_hash = excluded.password_hash, active = true`,
      [username, email, process.env.ADMIN_NAME || "Tushar", await hashPassword(pw)]);
    console.log(`[seed] admin account ${email} created`);
  } else if (mine.length && pw) {
    // ADMIN_PASSWORD changed in Coolify (or never applied) → apply it once to the admin account, and unlock it
    const fp = createHash("sha256").update(`${email}:${pw}`).digest("hex");
    if (!mine[0].password_hash || process.env.ADMIN_RESET_PASSWORD === "true" || (await setting("admin.password_fp")) !== fp) {
      await rawQ(`update users set password_hash = $2, role = 'admin', active = true, failed_logins = 0, locked_until = null where id = $1`, [mine[0].id, await hashPassword(pw)]);
      await setSetting("admin.password_fp", fp);
      console.log(`[seed] admin password for ${email} set from ADMIN_PASSWORD`);
    }
  }
  const admin = (await rawQ<{ id: string }>(`select id from users where role = 'admin' order by (lower(email) = $1) desc, created_at limit 1`, [email]))[0]!.id;

  if (!(await setting("seed.reference"))) {
    await rawQ("begin");
    try {
      await seedReference(rawQ, admin);
      await setSetting("seed.reference", new Date().toISOString());
      await rawQ("commit");
      console.log("[seed] reference data loaded (AOP FY26-27, S&OP FY27, people, reviews)");
    } catch (e) {
      await rawQ("rollback");
      throw e;
    }
  }

  // Central Operations team directory (idempotent; versioned so edits to directory.json re-apply)
  if ((await setting("seed.directory")) !== "v2") {
    await syncDirectory(rawQ, admin);
    await setSetting("seed.directory", "v2");
    console.log("[seed] team directory synced");
  }

  if ((await setting("seed.sop_review")) !== "v1") {
    await seedSopReview(rawQ);
    await setSetting("seed.sop_review", "v1");
    console.log("[seed] S&OP monthly review (Sep 2026) loaded");
  }

  if ((await setting("seed.org")) !== "v1") {
    await seedOrgChart(rawQ);
    await setSetting("seed.org", "v1");
    console.log("[seed] org chart + roles set (Mahadevan/Tushar admin, Pradhyum PM)");
  }

  if ((await setting("seed.overview")) !== "v1") {
    await rawQ(`update users set full_overview = true where name in ('Mahadevan Pillai','Tushar Gupta','Pradhyum Shivhare','Malhar Murhekar')`);
    await setSetting("seed.overview", "v1");
    console.log("[seed] full overview: Mahadevan, Tushar, Pradhyum, Malhar");
  }

  if ((await setting("seed.sop_history")) !== "v1") {
    await seedSopHistory(rawQ);
    await setSetting("seed.sop_history", "v1");
    console.log("[seed] S&OP Apr–Oct history, inventory flow, returns, outbound capacity, call-outs loaded");
  }

  if ((await setting("seed.sop_plan_daily")) !== "v1") {
    await seedSopPlanDaily(rawQ);
    await setSetting("seed.sop_plan_daily", "v1");
    console.log("[seed] S&OP daily plans (B2C, retail) loaded");
  }
  if ((await setting("seed.sop_plan_daily_orders")) !== "v1") {
    await seedSopPlanDaily(rawQ, "orders");
    await setSetting("seed.sop_plan_daily_orders", "v1");
    console.log("[seed] S&OP daily order-level plans (B2C) loaded");
  }
  // v3: S&OP_Projection_FY'27 (2).xlsx — B2C item + order plans Apr 2026 – Jan 2027; monthly B2C review plan = the sheet for every month
  if ((await setting("seed.sop_plan_b2c")) !== "v3") {
    await rawQ("begin");
    try {
      await reloadSopB2cPlan(rawQ, "items");
      await reloadSopB2cPlan(rawQ, "orders");
      await setSetting("seed.sop_plan_b2c", "v3");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] S&OP B2C item + order plans reloaded (v3)");
  }
  // B2B marketplace (month totals, 50/50 South / North) + retail forward (day plan → week rows), from S&OP_Projection_FY'27 (2).xlsx
  if ((await setting("seed.sop_plan_b2b_mp")) !== "v2") {
    await rawQ("begin");
    try {
      await reloadSopB2bMpPlan(rawQ);
      await reloadSopRetailPlan(rawQ);
      await setSetting("seed.sop_plan_b2b_mp", "v2");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] S&OP B2B marketplace + retail plans loaded from the projection sheet");
  }
  if ((await setting("seed.sop_plan_returns")) !== "v1") {
    await rawQ("begin");
    try {
      await reloadSopReturnsPlan(rawQ);
      await setSetting("seed.sop_plan_returns", "v1");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] S&OP returns plan (B2C, B2B) loaded from the projection sheet");
  }
  if ((await setting("seed.sop_plan_inward")) !== "v2") {
    await rawQ("begin");
    try {
      await reloadSopInwardPlan(rawQ);
      await setSetting("seed.sop_plan_inward", "v2");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] S&OP inward plans (category, pre-pack, category-wise) loaded from the projection sheet");
  }
  if ((await setting("seed.sop_sheet_inputs")) !== "v2") {
    await rawQ("begin");
    try {
      await loadSopSheetInputs(rawQ);
      await setSetting("seed.sop_sheet_inputs", "v2");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] S&OP inputs Nov 2026 – Jan 2027 entered from the projection sheet");
  }

  if ((await setting("seed.weekly")) !== "v1") {
    await rawQ("begin");
    try {
      await seedWeekly(rawQ, admin);
      await setSetting("seed.weekly", "v1");
      await rawQ("commit");
      console.log("[seed] weekly update sections + 19 Oct 2026 report loaded");
    } catch (e) {
      await rawQ("rollback");
      throw e;
    }
  }

  if ((await setting("seed.library")) !== "v1") {
    await seedLibrary(rawQ);
    await setSetting("seed.library", "v1");
    console.log("[seed] library sources loaded");
  }
  if ((await setting("seed.sop_wb_actuals")) !== "v1") {
    const { seedSopWorkbookActuals } = await import("./sopHistory");
    await seedSopWorkbookActuals(rawQ, "2026-09-01");
    await setSetting("seed.sop_wb_actuals", "v1");
    console.log("[seed] S&OP Apr–Aug 2026 actuals restored from the Plan vs Actual workbook");
  }
  if ((await setting("seed.packaging")) !== "v1") {
    await seedPackaging(rawQ);
    await setSetting("seed.packaging", "v1");
    console.log("[seed] packaging history Nov 2025 – Aug 2026 + rate list loaded");
  }
  if ((await setting("seed.aop_processing")) !== "v1") {
    const { seedAopProcessing } = await import("./aopProcessing");
    await rawQ("begin");
    try {
      await seedAopProcessing(rawQ);
      await setSetting("seed.aop_processing", "v1");
      await rawQ("commit");
    } catch (e) { await rawQ("rollback"); throw e; }
    console.log("[seed] AOP processing norms + monthly history loaded from the Cost Master processing tabs");
  }
  if ((await setting("seed.aop_logistics")) !== "v1") {
    const { seedAopLogistics } = await import("./aopLogistics");
    await rawQ("begin");
    try {
      const r = await seedAopLogistics(rawQ);
      await setSetting("seed.aop_logistics", "v1");
      await rawQ("commit");
      console.log(`[seed] AOP Logistics re-read from the Cost Master (Apr–Nov, 4-column layout): ${r.updated} cells set, ${r.kept} owner-edited cells kept`);
    } catch (e) { await rawQ("rollback"); throw e; }
  }
  if ((await setting("seed.wcm_snapshot")) !== "costmaster-2026-11-20") {
    const { seedWcmSnapshot } = await import("./wcm");
    await rawQ("begin");
    try {
      const r = await seedWcmSnapshot(rawQ);
      await setSetting("wcm.snapshot", r.snapshot); // the snapshot the Cost Master reads
      await setSetting("seed.wcm_snapshot", r.snapshot);
      await rawQ("commit");
      console.log(`[seed] Warehouse Cost Master snapshot ${r.snapshot}: ${r.lines} source lines`);
    } catch (e) { await rawQ("rollback"); throw e; }
  }
  // Cost Master Storage & Handling tab → approved rules: every warehousing head to shared Storage & handling (manpower / OT stay open)
  if ((await setting("seed.wcm_sh_rules")) !== "v1" && typeof (await setting("wcm.snapshot")) === "string") {
    const { seedStorageHandlingRules } = await import("../wcm/shRules");
    await rawQ("begin");
    try {
      const r = await seedStorageHandlingRules(rawQ, (await setting("wcm.snapshot")) as string);
      await setSetting("seed.wcm_sh_rules", "v1");
      await rawQ("commit");
      console.log(`[seed] Storage & Handling rules: ${r.added} of ${r.heads} warehousing heads mapped (heads with an approved rule kept)`);
    } catch (e) { await rawQ("rollback"); throw e; }
  }
  // Monthly Manpower Cost / OT → functions by attendance headcount (Inward, Inventory, Housekeeping = Storage & handling)
  if ((await setting("seed.wcm_mp_rules")) !== "v1" && typeof (await setting("wcm.snapshot")) === "string") {
    const { seedManpowerRules } = await import("../wcm/shRules");
    await rawQ("begin");
    try {
      const r = await seedManpowerRules(rawQ, (await setting("wcm.snapshot")) as string);
      await setSetting("seed.wcm_mp_rules", "v1");
      await rawQ("commit");
      console.log(`[seed] Manpower / OT rules: ${r.added} of ${r.heads} site heads split by department headcount`);
    } catch (e) { await rawQ("rollback"); throw e; }
  }
  // Cost Master → AOP Warehousing / Manpower / Packaging lines, once per snapshot (owner-edited cells kept; see costMasterSync.ts)
  const wcmSnap = await setting("wcm.snapshot");
  const { CM_SYNC_VERSION } = await import("../aop/costMasterSync");
  if (typeof wcmSnap === "string" && (await setting("seed.aop_cm_sync")) !== `${wcmSnap}|${CM_SYNC_VERSION}`) {
    const { seedAopCostMaster } = await import("../aop/costMasterSync");
    await rawQ("begin");
    try {
      const r = await seedAopCostMaster(rawQ, wcmSnap);
      await setSetting("seed.aop_cm_sync", `${wcmSnap}|${CM_SYNC_VERSION}`);
      await rawQ("commit");
      console.log(`[seed] AOP lines from Cost Master ${wcmSnap}: ${r.updated} cells set, ${r.added} lines added (manpower / OT / unplanned heads), ${r.kept} owner-edited cells kept`);
    } catch (e) { await rawQ("rollback"); throw e; }
  }
  if ((await setting("seed.wcm_ops")) !== "v1") {
    const { seedWcmOps } = await import("./wcm");
    await rawQ("begin");
    try { await seedWcmOps(rawQ); await setSetting("seed.wcm_ops", "v1"); await rawQ("commit"); console.log("[seed] Warehouse IPP master (revised + legacy) and site leads loaded"); }
    catch (e) { await rawQ("rollback"); throw e; }
  }
  if ((await setting("seed.handbook")) !== "v1") {
    await seedHandbook(rawQ);
    await setSetting("seed.handbook", "v1");
    console.log("[seed] ops handbook rows loaded from source sheets");
  }

  if ((process.env.SEED_DEMO ?? "false") === "true" && !(await setting("seed.demo"))) {
    const tasks = await rawQ<{ n: number }>(`select count(*)::int as n from tasks`);
    if (tasks[0].n === 0) {
      await rawQ("begin");
      try {
        await seedDemo(rawQ, admin);
        await setSetting("seed.demo", new Date().toISOString());
        await rawQ("commit");
        console.log("[seed] demo activity loaded");
      } catch (e) {
        await rawQ("rollback");
        throw e;
      }
    }
  }
}
