import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { q } from "@/server/db";

export async function GET() {
  const u = await getUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const items = await q(
    `select n.id, n.kind, n.title, n.body, n.href, n.read_at, n.created_at, a.name as actor_name
     from notifications n left join users a on a.id = n.actor_id where n.user_id = $1 order by n.created_at desc limit 30`, [u.id]);
  return NextResponse.json({ items });
}
