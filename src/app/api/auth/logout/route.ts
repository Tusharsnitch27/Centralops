import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  // relative Location — see the note in ../login/route.ts
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login?signedout=1" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
