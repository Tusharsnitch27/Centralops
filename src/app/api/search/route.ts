import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { search } from "@/server/shell/search";
import { taskScope } from "@/server/org/queries";

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const term = new URL(req.url).searchParams.get("q") ?? "";
  const ids = await taskScope(u);
  return NextResponse.json({ hits: await search(term, 6, ids ? { me: u.id, ids } : null) });
}
