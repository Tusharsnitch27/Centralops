import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUser } from "@/server/auth";
import { exchangeCode, googleProfile, saveGoogleTokens } from "@/server/integrations/google";
import { safeNext } from "@/lib/session";
import { logActivity } from "@/server/core/activity";
import { syncCalendar } from "@/server/meetings/calendarSync";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let state: { nonce: string; mode: "connect"; next: string } | null = null;
  try { state = JSON.parse(jar.get("co_oauth")?.value ?? "null"); } catch { state = null; }
  const fail = (path: string) => { const r = NextResponse.redirect(new URL(path, req.url)); r.cookies.delete("co_oauth"); return r; };
  if (!state || state.nonce !== url.searchParams.get("state") || !url.searchParams.get("code")) return fail("/integrations?error=google");

  try {
    const tokens = await exchangeCode(url.searchParams.get("code")!);
    const profile = await googleProfile(tokens.access_token);
    const email = profile.email.toLowerCase();

    const u = await getUser();
    if (!u) return fail("/login");
    await saveGoogleTokens(u.id, email, tokens);
    await logActivity({ actorId: u.id, entityType: "integration", entityId: null, action: "connected", summary: `Google Calendar (${email})` });
    // first import right away so meetings show up on landing; failures surface on the integrations card
    await syncCalendar(u.id).catch((e) => console.error("[google] initial sync failed", e));
    const r = NextResponse.redirect(new URL(`${safeNext(state.next)}?connected=google`, req.url));
    r.cookies.delete("co_oauth");
    return r;
  } catch (e) {
    console.error("[google] callback failed", e);
    return fail("/integrations?error=google");
  }
}
