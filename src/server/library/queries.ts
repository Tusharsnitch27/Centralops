import "server-only";
import { q } from "../db";

export type LibraryKind = "sop" | "handbook" | "dashboard" | "tool";
export interface LibraryItem {
  id: string; kind: LibraryKind; title: string; url: string | null; category: string; function_name: string; owner: string; description: string;
  status: string; updated_on: string; extra: Record<string, string>; pinned: boolean; source: string;
}

export function listLibrary(kind?: LibraryKind) {
  return q<LibraryItem>(
    `select id, kind, title, url, category, function_name, owner, description, status, updated_on, extra, pinned, source
     from library_items ${kind ? "where kind = $1" : ""} order by pinned desc, sort, lower(category), lower(title)`, kind ? [kind] : []);
}

export async function libraryCounts() {
  const rows = await q<{ kind: LibraryKind; n: number }>(`select kind, count(*)::int as n from library_items where category <> 'Source' group by kind`);
  return Object.fromEntries(rows.map((r) => [r.kind, r.n])) as Partial<Record<LibraryKind, number>>;
}
