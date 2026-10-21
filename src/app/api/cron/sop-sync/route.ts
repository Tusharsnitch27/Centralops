import { NextResponse } from "next/server";
import { runSync } from "@/server/sop/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** External trigger for the daily Snowflake refresh: GET/POST with Authorization: Bearer $CRON_SECRET. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key");
  if (!secret || got !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await runSync(undefined, "cron") });
}
export const GET = handle;
export const POST = handle;
