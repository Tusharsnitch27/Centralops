import { NextResponse } from "next/server";
import { readSession, safeNext, SESSION_COOKIE } from "@/lib/session";

/** Step after a correct password: if the session cookie came back, continue; if not, explain instead of looping silently. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const token = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  if (!token) {
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    console.error(`[auth] session cookie not returned by the browser (proto=${proto})`);
    return go(`/login?error=${proto === "https" ? "cookie" : "cookie_http"}&next=${encodeURIComponent(next)}`);
  }
  if (!(await readSession(decodeURIComponent(token)))) return go(`/login?error=session_invalid&next=${encodeURIComponent(next)}`);
  return go(next);
}
