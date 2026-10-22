import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { q } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Admin: download everything in the database as one JSON file (every table, every row) — a manual safety copy
 * on top of Coolify's scheduled Postgres backups. Password hashes and session secrets are left out.
 */
export async function GET() {
  const u = await requireUser();
  if (u.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tables = (await q<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).map((r) => r.t);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = await q<Record<string, unknown>>(`select * from "${t.replace(/"/g, "")}"`);
    out[t] = rows.map((r) => { const { password_hash: _p, ...rest } = r; return t === "app_settings" && /secret|token|password/i.test(String(rest.key)) ? { ...rest, value: "(hidden)" } : rest; });
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), by: u.email ?? u.id, tables: out }, null, 1), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="central-ops-backup-${stamp}.json"` },
  });
}
