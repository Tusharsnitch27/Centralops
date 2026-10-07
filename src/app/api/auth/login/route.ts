import { NextResponse } from "next/server";
import { one, q } from "@/server/db";
import { verifyPassword } from "@/server/auth/passwords";
import { safeNext, secureCookies, SESSION_COOKIE, SESSION_SECONDS, signSession } from "@/lib/session";

// Simple in-memory throttle per username (single instance deployment).
const attempts = new Map<string, { n: number; at: number }>();

export async function POST(req: Request) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const back = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}&next=${encodeURIComponent(next)}`, req.url), 303);

  const a = attempts.get(username);
  if (a && a.n >= 8 && Date.now() - a.at < 10 * 60_000) return back("locked");
  const u = await one<{ id: string; name: string; password_hash: string | null }>(
    `select id, name, password_hash from users where active and (lower(email) = $1 or lower(username) = $1)`, [username]);
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    attempts.set(username, { n: (a && Date.now() - a.at < 10 * 60_000 ? a.n : 0) + 1, at: Date.now() });
    return back("invalid");
  }
  attempts.delete(username);
  await q(`update users set last_seen_at = now() where id = $1`, [u.id]);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession({ uid: u.id, name: u.name }), {
    httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_SECONDS,
  });
  return res;
}
