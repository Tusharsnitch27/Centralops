import "server-only";
import { Pool, types, type PoolClient } from "pg";
import { MIGRATIONS } from "./migrations";

// DATE stays a 'YYYY-MM-DD' string (no timezone shifting); NUMERIC / BIGINT come back as numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v == null ? null : Number(v)));
types.setTypeParser(20, (v) => (v == null ? null : Number(v)));

const g = globalThis as unknown as { __pg?: Pool; __pgReady?: Promise<void>; __pgMigCount?: number };

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

function pool() {
  if (!g.__pg) {
    g.__pg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_MS ?? 30_000),
      ssl: /sslmode=require/.test(process.env.DATABASE_URL ?? "") ? { rejectUnauthorized: false } : undefined,
    });
    g.__pg.on("error", (e) => console.error("[db] idle client error", e.message));
  }
  return g.__pg;
}

async function runMigrations() {
  let c = await pool().connect();
  try {
    await c.query("select 1");
  } catch {
    c.release(true);
    c = await pool().connect();
  }
  try {
    // try-lock + JS backoff: a blocking lock wait would freeze single-connection PGlite (local dev)
    for (let i = 0; ; i++) {
      const r = await c.query<{ ok: boolean }>("select pg_try_advisory_lock(727272) as ok");
      if (r.rows[0]?.ok) break;
      if (i > 600) throw new Error("Timed out waiting for the migration lock");
      await new Promise((res) => setTimeout(res, 200));
    }
    await c.query("create table if not exists schema_migrations (version int primary key, name text, applied_at timestamptz not null default now())");
    const { rows } = await c.query<{ version: number }>("select version from schema_migrations");
    const done = new Set(rows.map((r) => r.version));
    for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
      if (done.has(m.version)) continue;
      try {
        await c.query("begin");
        await c.query(m.sql);
        await c.query("insert into schema_migrations(version, name) values ($1, $2)", [m.version, m.name]);
        await c.query("commit");
        console.log(`[db] applied migration ${m.version} ${m.name}`);
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      }
    }
    // bootstrap admin + reference/demo data (idempotent), on the same locked connection
    const { bootstrap } = await import("../seed");
    await bootstrap(async (text, params = []) => (await c.query(text, params)).rows);
  } finally {
    await c.query("select pg_advisory_unlock(727272)").catch(() => {});
    c.release();
  }
}

/** Query function bound to one connection (used by the seed so transactions work). */
export type RunQ = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

/** Migrates + seeds once per process; retried on the next call if it failed. */
export function ready() {
  if (!dbConfigured()) return Promise.reject(new Error("DATABASE_URL is not set"));
  // a new migration file (dev hot reload) re-runs the migrator
  if (g.__pgMigCount !== MIGRATIONS.length) {
    g.__pgMigCount = MIGRATIONS.length;
    // chain after any in-flight run instead of racing it
    const prev = g.__pgReady?.catch(() => {}) ?? Promise.resolve();
    g.__pgReady = prev.then(() => runMigrations());
  }
  g.__pgReady ??= runMigrations().catch((e) => {
    g.__pgReady = undefined;
    throw e;
  });
  return g.__pgReady;
}

type Row = Record<string, unknown>;

/** Run a query and return rows. */
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  try {
    return (await pool().query(text, params)).rows as T[];
  } catch (e) {
    // a pooled connection dropped by the server (restart, idle reap): retry once on a fresh one
    if (!isConnError(e)) throw e;
    return (await pool().query(text, params)).rows as T[];
  }
}

const isConnError = (e: unknown) => {
  const m = e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : "";
  return /ECONNRESET|EPIPE|Connection terminated|connection.*closed/i.test(m);
};

/** First row or null. */
export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export type Tx = { q: <T = Row>(text: string, params?: unknown[]) => Promise<T[]>; one: <T = Row>(text: string, params?: unknown[]) => Promise<T | null> };

/** Run fn inside a transaction. */
export async function tx<R>(fn: (t: Tx) => Promise<R>): Promise<R> {
  await ready();
  let c: PoolClient = await pool().connect();
  try {
    await c.query("select 1");
  } catch (e) {
    c.release(true);
    if (!isConnError(e)) throw e;
    c = await pool().connect();
  }
  const t: Tx = {
    q: async <T,>(text: string, params: unknown[] = []) => (await c.query(text, params)).rows as T[],
    one: async <T,>(text: string, params: unknown[] = []) => ((await c.query(text, params)).rows[0] as T) ?? null,
  };
  try {
    await c.query("begin");
    const r = await fn(t);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
