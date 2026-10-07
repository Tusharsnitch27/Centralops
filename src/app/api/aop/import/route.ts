import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { canManage, getUser } from "@/server/auth";
import { applyImport, getSheet, parseWorkbook, type ImportTarget } from "@/server/aop/importer";
import type { ImportMapping } from "@/server/aop/importParse";

// AOP import: POST multipart (file) → parse & cache; GET ?token&sheet → rows; PUT JSON → apply mapping.
const deny = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return deny("Not signed in", 401);
  if (!canManage(u)) return deny("Only admins and PMs can import plans", 403);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return deny("Choose an Excel or CSV file");
  if (file.size > 25 * 1024 * 1024) return deny("File is larger than 25 MB");
  try {
    return NextResponse.json(parseWorkbook(await file.arrayBuffer(), file.name));
  } catch (e) {
    return deny(`Couldn't read that file: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return deny("Not signed in", 401);
  const sp = new URL(req.url).searchParams;
  const s = getSheet(sp.get("token") ?? "", sp.get("sheet") ?? "");
  if (!s) return deny("Upload expired — choose the file again", 410);
  return NextResponse.json(s);
}

export async function PUT(req: Request) {
  const u = await getUser();
  if (!u) return deny("Not signed in", 401);
  if (!canManage(u)) return deny("Only admins and PMs can import plans", 403);
  const body = (await req.json().catch(() => null)) as { token: string; sheet: string; mapping: ImportMapping; target: ImportTarget; templateId?: string | null } | null;
  if (!body?.token || !body.mapping) return deny("Bad request");
  try {
    const r = await applyImport(u, body.token, body.sheet, body.mapping, body.target ?? {}, body.templateId);
    revalidatePath("/aop", "layout");
    return NextResponse.json(r);
  } catch (e) {
    return deny(e instanceof Error ? e.message : "Import failed");
  }
}
