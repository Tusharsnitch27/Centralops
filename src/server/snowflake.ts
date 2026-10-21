import "server-only";
import snowflake from "snowflake-sdk";
import { createPrivateKey } from "node:crypto";

// Central Ops' own Snowflake connection (same approach as Long Tail, separate credentials).
// Env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PAT (or SNOWFLAKE_PRIVATE_KEY [+ _PASSPHRASE]),
//      SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA (optional).
snowflake.configure({ logLevel: "ERROR" });

type Pool = ReturnType<typeof snowflake.createPool>;
const g = globalThis as unknown as { __sfPool?: Pool };

export const sfConfigured = () => Boolean(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USERNAME && (process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PRIVATE_KEY));
export const sfEnv = () => ({
  account: process.env.SNOWFLAKE_ACCOUNT ?? null, username: process.env.SNOWFLAKE_USERNAME ?? null, auth: process.env.SNOWFLAKE_PAT ? "PAT" : process.env.SNOWFLAKE_PRIVATE_KEY ? "key pair" : null,
  role: process.env.SNOWFLAKE_ROLE ?? null, warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? null, database: process.env.SNOWFLAKE_DATABASE ?? null, schema: process.env.SNOWFLAKE_SCHEMA ?? null,
});

function options(): snowflake.ConnectionOptions {
  const e = process.env;
  if (!sfConfigured()) throw new Error("Snowflake isn't configured: set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME and SNOWFLAKE_PAT in Coolify");
  const base = { account: e.SNOWFLAKE_ACCOUNT!, username: e.SNOWFLAKE_USERNAME!, role: e.SNOWFLAKE_ROLE, warehouse: e.SNOWFLAKE_WAREHOUSE, database: e.SNOWFLAKE_DATABASE, schema: e.SNOWFLAKE_SCHEMA, clientSessionKeepAlive: true };
  if (e.SNOWFLAKE_PAT) return { ...base, authenticator: "PROGRAMMATIC_ACCESS_TOKEN", token: e.SNOWFLAKE_PAT } as snowflake.ConnectionOptions;
  const body = e.SNOWFLAKE_PRIVATE_KEY!.replace(/-----[^-]+-----|\s/g, "");
  const pem = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
  const privateKey = createPrivateKey({ key: pem, format: "pem", passphrase: e.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE }).export({ format: "pem", type: "pkcs8" }).toString();
  return { ...base, authenticator: "SNOWFLAKE_JWT", privateKey };
}
const pool = () => (g.__sfPool ??= snowflake.createPool(options(), { max: 3, min: 0, evictionRunIntervalMillis: 60_000, idleTimeoutMillis: 300_000 }));

export type Bind = string | number | null;
/** Run a query; column names come back lower-cased. Cast dates to VARCHAR in SQL. */
export async function sfQuery<T = Record<string, unknown>>(sqlText: string, binds: Bind[] = []): Promise<T[]> {
  const started = Date.now();
  const rows = await pool().use((conn) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    conn.execute({ sqlText, binds: binds as snowflake.Binds, complete: (err, _s, r) => (err ? reject(err) : resolve((r ?? []) as Record<string, unknown>[])) });
  }));
  console.log(`[snowflake] ${Date.now() - started}ms ${rows.length} rows :: ${sqlText.replace(/\s+/g, " ").slice(0, 80)}`);
  return rows.map((r) => { const o: Record<string, unknown> = {}; for (const k in r) o[k.toLowerCase()] = r[k]; return o as T; });
}
