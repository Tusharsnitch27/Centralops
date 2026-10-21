import "server-only";
import type { RunQ } from "../db";
import { hashPassword } from "../auth/passwords";
import { seedReference } from "./reference";
import { seedDemo } from "./demo";
import { syncDirectory } from "./directory";
import { seedSopReview } from "./sopReview";
import { seedWeekly } from "./weekly";
import { seedLibrary } from "./library";

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
  const admin = (await rawQ<{ id: string }>(`select id from users where role = 'admin' order by created_at limit 1`))[0]!.id;

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
