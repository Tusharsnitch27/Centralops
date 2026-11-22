import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { canManage, getUser } from "@/server/auth";
import { loadLogistics } from "@/server/aop/lgImport";

// Logistics working-file upload: POST multipart (kind = b2c | b2b, file) → replaces that dataset. Admins / PMs only.
const deny = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return deny("Not signed in", 401);
  if (!canManage(u)) return deny("Only admins and PMs can load logistics working files", 403);
  const form = await req.formData().catch(() => null);
  const kind = form?.get("kind"), file = form?.get("file");
  if (kind !== "b2c" && kind !== "b2b" && kind !== "rvp") return deny("Say which file this is (B2C partner file, B2B LR file or B2B RVP & MP file)");
  if (!file || typeof file === "string") return deny("Choose the .xlsx file");
  if (!/\.xlsx$/i.test(file.name)) return deny("Upload the .xlsx working file");
  if (file.size > 25 * 1024 * 1024) return deny("File is larger than 25 MB");
  try {
    const r = await loadLogistics(u.id, kind, file.name, await file.arrayBuffer());
    revalidatePath("/aop/logistics");
    return NextResponse.json(r);
  } catch (e) {
    return deny(`Couldn't load that file: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
