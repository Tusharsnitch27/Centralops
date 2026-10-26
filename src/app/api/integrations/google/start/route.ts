import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getUser } from "@/server/auth";
import { googleAuthUrl, googleConfigured } from "@/server/integrations/google";
import { safeNext, secureCookies } from "@/lib/session";

// Integrations → connect Google Calendar (read-only). Sign-in itself is email + password only.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = "connect";
  const next = safeNext(url.searchParams.get("next") ?? "/integrations");
  if (!googleConfigured()) return NextResponse.redirect(new URL("/integrations?error=google_not_configured", req.url));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  // the admin's master switch can turn calendar connections off for everyone
  const { calendarMaster } = await import("@/server/integrations/actions");
  if (!(await calendarMaster())) return NextResponse.redirect(new URL("/settings?tab=profile&calendar=off", req.url));
  const nonce = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(nonce, user?.email ?? undefined));
  res.cookies.set("co_oauth", JSON.stringify({ nonce, mode, next }), { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 600 });
  return res;
}
