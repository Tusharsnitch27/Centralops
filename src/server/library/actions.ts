"use server";
import { revalidatePath } from "next/cache";
import { canManage, requireUser } from "../auth";
import { q } from "../db";
import { fail, ok, type ActionResult } from "../core/result";
import type { LibraryKind } from "./queries";

const KINDS: LibraryKind[] = ["sop", "handbook", "dashboard", "tool"];
export interface LibraryRow { title: string; url?: string | null; category?: string; function_name?: string; owner?: string; description?: string; status?: string; updated_on?: string; extra?: Record<string, string> }

async function manager() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only the PM / admins can change the library");
  return u;
}
const s = (v?: string | null) => (v ?? "").replace(/\s+/g, " ").trim();
const url = (v?: string | null) => { const t = s(v); return /^https?:\/\/\S+$/i.test(t) ? t : null; };

/** Bulk import (pasted from a sheet). Rows matching an existing title + link are updated, the rest added. */
export async function importLibrary(kind: LibraryKind, rows: LibraryRow[]): Promise<ActionResult<{ added: number; updated: number }>> {
  try {
    const u = await manager();
    if (!KINDS.includes(kind)) throw new Error("Unknown section");
    let added = 0, updated = 0;
    const base = (await q<{ n: number }>(`select coalesce(max(sort), 0)::int as n from library_items where kind = $1`, [kind]))[0].n;
    for (const [i, r] of rows.entries()) {
      const title = s(r.title);
      if (!title) continue;
      const res = await q<{ inserted: boolean }>(
        `insert into library_items (kind, title, url, category, function_name, owner, description, status, updated_on, extra, sort, source, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'import',$12)
         on conflict (kind, lower(title), coalesce(url, '')) do update set category = excluded.category, function_name = excluded.function_name, owner = excluded.owner,
           description = excluded.description, status = excluded.status, updated_on = excluded.updated_on, extra = excluded.extra, updated_at = now()
         returning (xmax = 0) as inserted`,
        [kind, title, url(r.url), s(r.category), s(r.function_name), s(r.owner), s(r.description), s(r.status), s(r.updated_on), JSON.stringify(r.extra ?? {}), base + i + 1, u.id]);
      if (res[0]?.inserted) added++; else updated++;
    }
    revalidatePath("/library", "layout");
    return ok({ added, updated }, `${added} added${updated ? `, ${updated} updated` : ""}`);
  } catch (e) { return fail(e); }
}

export async function saveLibraryItem(kind: LibraryKind, id: string | null, r: LibraryRow & { pinned?: boolean }): Promise<ActionResult> {
  try {
    const u = await manager();
    if (!s(r.title)) throw new Error("Give it a title");
    if (r.url && !url(r.url)) throw new Error("Links must start with https://");
    if (id) await q(`update library_items set title = $2, url = $3, category = $4, function_name = $5, owner = $6, description = $7, pinned = $8, updated_at = now() where id = $1`,
      [id, s(r.title), url(r.url), s(r.category), s(r.function_name), s(r.owner), s(r.description), !!r.pinned]);
    else await q(`insert into library_items (kind, title, url, category, function_name, owner, description, pinned, sort, created_by)
                  values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+1 from library_items where kind = $1),$9)`,
      [kind, s(r.title), url(r.url), s(r.category), s(r.function_name), s(r.owner), s(r.description), !!r.pinned, u.id]);
    revalidatePath("/library", "layout");
    return ok(undefined, id ? "Saved" : "Added");
  } catch (e) { return fail(e); }
}

export async function deleteLibraryItem(id: string): Promise<ActionResult> {
  try {
    await manager();
    await q(`delete from library_items where id = $1`, [id]);
    revalidatePath("/library", "layout");
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}
