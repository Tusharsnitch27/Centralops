import { NextResponse } from "next/server";
import { dbConfigured, one, q } from "@/server/db";
import { verifyPassword } from "@/server/auth/passwords";
import { safeNext, secureCookies, SESSION_COOKIE, SESSION_SECONDS, signSession } from "@/lib/session";

// Relative Location: behind Coolify's proxy req.url carries the internal host (0.0.0.0:3000), so absolute redirects break sign-in.
const redirectTo = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

const MAX_FAILS = 5, LOCK_MINUTES = 15;
// extra throttle per client IP (process memory) on top of the per-account lock
const g = globalThis as unknown as { __loginFails?: Map<string, number[]> };
const ipFails: Map<string, number[]> = (g.__loginFails ??= new Map());
const recent = (k: string) => (ipFails.get(k) ?? []).filter((t) => Date.now() - t < LOCK_MINUTES * 60_000);
// verify against a dummy hash for unknown users so timing doesn't reveal which emails exist
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA";

/** HTML form POST: username (email), password, next → 303 back to /login with a reason, or into the app. */
export async function POST(req: Request) {
  let username = "", next = "/";
  const back = (error: string, extra = "") => redirectTo(`/login?error=${error}${extra}&next=${encodeURIComponent(next)}${username ? `&u=${encodeURIComponent(username)}` : ""}`);
  try {
    const form = await req.formData();
    username = String(form.get("username") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    next = safeNext(String(form.get("next") ?? "/"));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

    if (!username || !password) return back("missing");
    const secret = (process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").trim();
    if (!secret) { console.error("[auth] NEXTAUTH_SECRET is not set at runtime"); return back("config_secret"); }
    if (secret.length < 32) { console.error(`[auth] NEXTAUTH_SECRET is only ${secret.length} characters (needs 32+)`); return back("config_secret_short"); }
    if (!dbConfigured()) { console.error("[auth] DATABASE_URL is not set at runtime"); return back("config_db"); }
    if (recent(`ip:${ip}`).length >= MAX_FAILS * 3) return back("locked");

    const u = await one<{ id: string; name: string; password_hash: string | null; active: boolean; mins: number | null }>(
      `select id, name, password_hash, active, case when locked_until > now() then ceil(extract(epoch from (locked_until - now())) / 60)::int end as mins
       from users where lower(email) = $1 or lower(username) = $1 order by active desc limit 1`, [username]);
    // locked: refuse before checking the password so the lock can't be raced
    if (u?.mins) return back("account_locked", `&m=${u.mins}`);
    const ok = await verifyPassword(password, u?.password_hash ?? DUMMY);
    if (u && ok && !u.active) return back("denied");
    if (u && !u.password_hash) return back("no_password");
    if (!u || !ok) {
      ipFails.set(`ip:${ip}`, [...recent(`ip:${ip}`), Date.now()]);
      if (!u) return back("invalid");
      const r = await one<{ locked: boolean; fails: number }>(
        `update users set failed_logins = case when failed_logins + 1 >= $2 then 0 else failed_logins + 1 end,
                locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
         where id = $1 returning coalesce(locked_until > now(), false) as locked, failed_logins as fails`, [u.id, MAX_FAILS, LOCK_MINUTES]);
      if (r?.locked) return back("account_locked", `&m=${LOCK_MINUTES}`);
      return back("invalid", `&left=${MAX_FAILS - (r?.fails ?? 0)}`);
    }

    await q(`update users set failed_logins = 0, locked_until = null, last_seen_at = now() where id = $1`, [u.id]);
    const res = redirectTo(next);
    res.cookies.set(SESSION_COOKIE, await signSession({ uid: u.id, name: u.name }), {
      httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_SECONDS,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auth] sign-in failed:", msg);
    return back(/ECONNREFUSED|ENOTFOUND|timeout|connect|database|relation .* does not exist/i.test(msg) ? "db" : "server");
  }
}
