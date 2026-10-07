import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

// Fast gate: every page/API needs a valid signed session. Roles/permissions are enforced server-side.
const withPath = (req: NextRequest) => {
  const h = new Headers(req.headers);
  h.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
};

export async function proxy(req: NextRequest) {
  if (process.env.AUTH_MODE === "dev" && process.env.NODE_ENV !== "production") return withPath(req);
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return withPath(req);
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|api/health|api/cron|api/integrations/google/callback|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
