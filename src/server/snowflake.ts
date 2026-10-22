import "server-only";
import snowflake from "snowflake-sdk";
import { createPrivateKey } from "node:crypto";
import { one, q } from "./db";

// Central Ops' own Snowflake connection (same approach as Long Tail, separate credentials).
// Env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PAT (or SNOWFLAKE_PRIVATE_KEY [+ _PASSPHRASE]),
//      SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA (optional).
snowflake.configure({ logLevel: "ERROR" });

type Pool = ReturnType<typeof snowflake.createPool>;
const g = globalThis as unknown as { __sfPool?: Pool; __sfWh?: string | null };

// values pasted into Coolify sometimes carry quotes or spaces — "COMPUTE_WH " is a different warehouse to Snowflake
const env = (k: string) => { const v = process.env[k]?.trim().replace(/^["']|["']$/g, "").trim(); return v ? v : undefined; };
const ident = (s: string) => s.replace(/[^A-Za-z0-9_$]/g, "");

export const sfConfigured = () => Boolean(env("SNOWFLAKE_ACCOUNT") && env("SNOWFLAKE_USERNAME") && (env("SNOWFLAKE_PAT") || env("SNOWFLAKE_PRIVATE_KEY")));
export const sfEnv = () => ({
  account: env("SNOWFLAKE_ACCOUNT") ?? null, username: env("SNOWFLAKE_USERNAME") ?? null, auth: env("SNOWFLAKE_PAT") ? "PAT" : env("SNOWFLAKE_PRIVATE_KEY") ? "key pair" : null,
  role: env("SNOWFLAKE_ROLE") ?? null, warehouse: env("SNOWFLAKE_WAREHOUSE") ?? null, database: env("SNOWFLAKE_DATABASE") ?? null, schema: env("SNOWFLAKE_SCHEMA") ?? null,
});

function options(): snowflake.ConnectionOptions {
  if (!sfConfigured()) throw new Error("Snowflake isn't configured: set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME and SNOWFLAKE_PAT in Coolify");
  const base = { account: env("SNOWFLAKE_ACCOUNT")!, username: env("SNOWFLAKE_USERNAME")!, role: env("SNOWFLAKE_ROLE"), warehouse: env("SNOWFLAKE_WAREHOUSE"), database: env("SNOWFLAKE_DATABASE"), schema: env("SNOWFLAKE_SCHEMA"), clientSessionKeepAlive: true };
  if (env("SNOWFLAKE_PAT")) return { ...base, authenticator: "PROGRAMMATIC_ACCESS_TOKEN", token: env("SNOWFLAKE_PAT") } as snowflake.ConnectionOptions;
  const body = process.env.SNOWFLAKE_PRIVATE_KEY!.replace(/-----[^-]+-----|\s/g, "");
  const pem = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
  const privateKey = createPrivateKey({ key: pem, format: "pem", passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE }).export({ format: "pem", type: "pkcs8" }).toString();
  return { ...base, authenticator: "SNOWFLAKE_JWT", privateKey };
}
const pool = () => (g.__sfPool ??= snowflake.createPool(options(), { max: 3, min: 0, evictionRunIntervalMillis: 60_000, idleTimeoutMillis: 300_000 }));

type Conn = Parameters<Parameters<Pool["use"]>[0]>[0];
export type Bind = string | number | null;
const exec = (conn: Conn, sqlText: string, binds: Bind[] = []) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
  conn.execute({ sqlText, binds: binds as snowflake.Binds, complete: (err, _s, r) => (err ? reject(err) : resolve((r ?? []) as Record<string, unknown>[])) });
});
const lower = (r: Record<string, unknown>) => { const o: Record<string, unknown> = {}; for (const k in r) o[k.toLowerCase()] = r[k]; return o; };

/**
 * Active warehouse, in order: the one picked in Settings › Integrations (saved in the database, survives deploys),
 * SNOWFLAKE_WAREHOUSE, then SNOWFLAKE_WAREHOUSE_FALLBACK (default SNITCH_WH — what Long Tail falls back to when the role
 * can't use COMPUTE_WH). Every connection runs USE WAREHOUSE explicitly, so a session never starts without one.
 */
async function chosenWarehouse() {
  if (g.__sfWh !== undefined) return g.__sfWh;
  const row = await one<{ value: unknown }>(`select value from app_settings where key = 'snowflake.warehouse'`).catch(() => null);
  g.__sfWh = typeof row?.value === "string" && row.value ? ident(row.value) : null;
  return g.__sfWh;
}
const candidates = async () => [...new Set([await chosenWarehouse(), env("SNOWFLAKE_WAREHOUSE"), env("SNOWFLAKE_WAREHOUSE_FALLBACK") ?? "SNITCH_WH"]
  .filter((x): x is string => !!x).map((x) => ident(x).toUpperCase()))];
const whError = (e: unknown) => /no active warehouse|warehouse .* (does not exist|not authorized)|object does not exist.*warehouse/i.test(e instanceof Error ? e.message : String(e));

async function useWarehouse(conn: Conn): Promise<string> {
  const tried: string[] = [];
  for (const wh of await candidates()) {
    try { await exec(conn, `USE WAREHOUSE ${wh}`); return wh; } catch { tried.push(wh); }
  }
  // none of the configured ones work: take any warehouse this role may use
  const rows = (await exec(conn, "SHOW WAREHOUSES").catch(() => [])).map(lower);
  for (const r of rows) {
    const wh = ident(String(r.name ?? ""));
    if (!wh || tried.includes(wh.toUpperCase())) continue;
    try { await exec(conn, `USE WAREHOUSE ${wh}`); console.warn(`[snowflake] ${tried.join(", ")} not usable by this role — using ${wh}`); return wh; } catch { /* next */ }
  }
  throw new Error(`No warehouse usable by role ${env("SNOWFLAKE_ROLE") ?? "(default)"} — tried ${tried.join(", ") || "none"}. Pick one in Settings › Integrations or grant USAGE on a warehouse to the role.`);
}

/** Run a query; column names come back lower-cased. Cast dates to VARCHAR in SQL. */
export async function sfQuery<T = Record<string, unknown>>(sqlText: string, binds: Bind[] = []): Promise<T[]> {
  const started = Date.now();
  const rows = await pool().use(async (conn) => {
    await useWarehouse(conn);
    try { return await exec(conn, sqlText, binds); }
    catch (e) {
      if (!whError(e)) throw e;
      g.__sfWh = undefined; // re-read the saved choice and try the next warehouse once
      await useWarehouse(conn);
      return exec(conn, sqlText, binds);
    }
  });
  console.log(`[snowflake] ${Date.now() - started}ms ${rows.length} rows :: ${sqlText.replace(/\s+/g, " ").slice(0, 80)}`);
  return rows.map((r) => lower(r) as T);
}

/** Connection check for the Integrations page: who we are, which warehouse is active, which ones the role can use. */
export async function sfDiagnose() {
  return pool().use(async (conn) => {
    const active = await useWarehouse(conn);
    const [ctx] = (await exec(conn, "SELECT CURRENT_USER() AS u, CURRENT_ROLE() AS r, CURRENT_WAREHOUSE() AS w, CURRENT_DATABASE() AS d")).map(lower);
    const whs = (await exec(conn, "SHOW WAREHOUSES").catch(() => [])).map(lower).map((r) => ({ name: String(r.name), state: String(r.state ?? ""), size: String(r.size ?? "") }));
    return { user: String(ctx?.u ?? ""), role: String(ctx?.r ?? ""), warehouse: String(ctx?.w ?? active), database: String(ctx?.d ?? ""), warehouses: whs };
  });
}

/** Save the warehouse picked in the UI (empty = back to SNOWFLAKE_WAREHOUSE). */
export async function setSfWarehouse(name: string | null) {
  const v = name ? ident(name) : "";
  await q(`insert into app_settings (key, value) values ('snowflake.warehouse', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(v)]);
  g.__sfWh = v || null;
}
