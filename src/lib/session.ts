// Signed session cookie (HS256 JWT). Edge/Node safe — used by proxy.ts and server code.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "co_session";
export const SESSION_HOURS = Math.min(24, Math.max(0.25, Number(process.env.SESSION_HOURS ?? 12) || 12));
export const SESSION_SECONDS = Math.round(SESSION_HOURS * 3600);

export interface Session { uid: string; name?: string; exp?: number }

function secret() {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("NEXTAUTH_SECRET (≥32 chars) is required for sign-in");
  return new TextEncoder().encode(s);
}

/** Mark the cookie Secure only when the browser actually reached us over https (Coolify's proxy says so in
 *  x-forwarded-proto). A Secure cookie on a plain-http visit is silently dropped — sign-in would loop with no error. */
export const secureCookies = (req?: Request) => {
  const fwd = req?.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (fwd) return fwd === "https";
  if (req) { try { return new URL(req.url).protocol === "https:"; } catch { /* fall through */ } }
  const url = (process.env.NEXTAUTH_URL ?? "").trim();
  return url ? !url.startsWith("http://") : process.env.NODE_ENV === "production";
};

export async function signSession(s: Session) {
  return new SignJWT({ name: s.name }).setProtectedHeader({ alg: "HS256" }).setSubject(s.uid).setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_SECONDS).sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? { uid: payload.sub, name: payload.name as string | undefined, exp: payload.exp } : null;
  } catch {
    return null;
  }
}

export const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api/") ? n : "/");
