import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/wcm-costmaster-2026-11-20.json";

/**
 * Loads one dated Cost Master snapshot (scripts/extract-wcm.mjs). Idempotent: the snapshot and its lines are keyed, so a rerun adds
 * nothing. A newer workbook = a new JSON + new snapshot id; older snapshots stay for history and rules (keyed by cost head) carry over.
 */
export async function seedWcmSnapshot(S: RunQ) {
  const s = data.snapshot;
  await S(`insert into wcm_snapshot (id, source, file_name, sha256, taken, controls, workbook) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
    [s.id, s.source, s.file, s.sha256, s.taken, JSON.stringify(data.controls), JSON.stringify(data.workbook)]);
  const L = data.lines as { period: string; basis: string; site: string; family: string; head: string; channel: string | null; amount: number | null; cell: string; note?: string }[];
  for (let i = 0; i < L.length; i += 500) {
    const c = L.slice(i, i + 500);
    await S(`insert into wcm_source_line (snapshot_id, period, basis, site, family, head, channel, amount, cell, note)
             select $1, p::date, b, st, f, h, ch, a, ce, n from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::numeric[], $9::text[], $10::text[])
               as t(p, b, st, f, h, ch, a, ce, n)
             on conflict (snapshot_id, period, basis, site, family, head) do nothing`,
      [s.id, c.map((l) => l.period), c.map((l) => l.basis), c.map((l) => l.site), c.map((l) => l.family), c.map((l) => l.head),
        c.map((l) => l.channel), c.map((l) => l.amount), c.map((l) => l.cell), c.map((l) => l.note ?? null)]);
  }
  return { snapshot: s.id, lines: L.length };
}
