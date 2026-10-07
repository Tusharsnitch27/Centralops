import "server-only";
import { one, q } from "../db";

/**
 * Google OAuth for the optional Calendar integration only (sign-in is email + password). Tokens are stored per user in `integrations`
 * (provider 'google_calendar'). Calendar sync itself lives in server/meetings/calendarSync.ts.
 */
export const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"];
export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${(process.env.NEXTAUTH_URL ?? "http://localhost:3100").replace(/\/$/, "")}/api/integrations/google/callback`;

export function googleAuthUrl(state: string, loginHint?: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string }

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: "authorization_code" }),
  });
  if (!r.ok) throw new Error(`Google token exchange failed (${r.status})`);
  return r.json();
}

export async function googleProfile(accessToken: string): Promise<{ email: string; name?: string; email_verified?: boolean }> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("Google profile lookup failed");
  return r.json();
}

export async function saveGoogleTokens(userId: string, email: string, t: TokenResponse) {
  await q(
    `insert into integrations (user_id, provider, status, account_email, access_token, refresh_token, token_expires_at, scopes, last_error)
     values ($1,'google_calendar','connected',$2,$3,$4, now() + make_interval(secs => $5), $6, null)
     on conflict (user_id, provider) do update set status = 'connected', account_email = excluded.account_email, access_token = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, integrations.refresh_token), token_expires_at = excluded.token_expires_at, scopes = excluded.scopes, last_error = null`,
    [userId, email, t.access_token, t.refresh_token ?? null, t.expires_in, t.scope],
  );
}

/** A valid access token for the user's Google connection (refreshes when needed). */
export async function googleAccessToken(userId: string): Promise<string | null> {
  const i = await one<{ id: string; access_token: string | null; refresh_token: string | null; token_expires_at: string | null }>(
    `select id, access_token, refresh_token, token_expires_at from integrations where user_id = $1 and provider = 'google_calendar' and status <> 'disconnected'`, [userId]);
  if (!i) return null;
  if (i.access_token && i.token_expires_at && new Date(i.token_expires_at).getTime() > Date.now() + 60_000) return i.access_token;
  if (!i.refresh_token || !googleConfigured()) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: i.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  if (!r.ok) {
    await q(`update integrations set status = 'error', last_error = $2 where id = $1`, [i.id, `Token refresh failed (${r.status}) — reconnect Google`]);
    return null;
  }
  const t = (await r.json()) as TokenResponse;
  await q(`update integrations set access_token = $2, token_expires_at = now() + make_interval(secs => $3), status = 'connected', last_error = null where id = $1`, [i.id, t.access_token, t.expires_in]);
  return t.access_token;
}
