import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { search } from "@/server/shell/search";

export async function GET(req: Request) {
  if (!(await getUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const term = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ hits: await search(term) });
}
