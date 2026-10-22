import { NextResponse } from "next/server";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";
/** Liveness + which runtime settings are present (never their values). */
export async function GET() {
  const secret = (process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").trim();
  const env = { DATABASE_URL: !!process.env.DATABASE_URL, NEXTAUTH_SECRET: secret.length >= 32 ? true : secret ? `too short (${secret.length})` : false, NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? null, ADMIN_EMAIL: !!process.env.ADMIN_EMAIL, ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD };
  try {
    await one("select 1");
    // persistence: if a deploy ever started from an empty database, "since" changes and boots drops back to 1
    const p = await one<{ since: string | null; boots: number | null; users: number; tasks: number }>(
      `select (select value #>> '{}' from app_settings where key = 'app.first_boot') as since, (select (value #>> '{}')::int from app_settings where key = 'app.boots') as boots,
              (select count(*)::int from users) as users, (select count(*)::int from tasks) as tasks`);
    return NextResponse.json({ ok: true, env, data: p });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "db", env }, { status: 503 });
  }
}
