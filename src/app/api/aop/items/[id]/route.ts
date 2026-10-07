import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { itemDetail } from "@/server/aop/queries";

// AOP line drawer data (values, history, commentary, linked tasks, permissions).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = await itemDetail(id, u);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(d);
}
