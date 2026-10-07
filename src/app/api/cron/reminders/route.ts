import { NextResponse } from "next/server";
import { runAopReminders } from "@/server/aop/reminders";

// Daily reminder job. Call from Coolify → Scheduled Tasks (or any cron):
//   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/reminders
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("key");
  if (!secret || got !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const run = await runAopReminders();
  return NextResponse.json(run);
}
export const GET = handle;
export const POST = handle;
