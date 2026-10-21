import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

/** Weekly-update screenshot bytes (signed-in users only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const img = await one<{ mime: string; data: Buffer }>(`select mime, data from weekly_images where id = $1`, [id]);
  if (!img) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(img.data), { headers: { "content-type": img.mime, "cache-control": "private, max-age=86400" } });
}
