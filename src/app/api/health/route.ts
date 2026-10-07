import { NextResponse } from "next/server";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await one("select 1");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "db" }, { status: 503 });
  }
}
