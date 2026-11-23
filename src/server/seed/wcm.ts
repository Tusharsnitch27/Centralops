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

/**
 * IPP master: the revised targets and the Cost Master processing norms are seeded as legacy versions (history only); the updated
 * master (migration 083, effective from 1 Apr 2026 by migration 091) is the one in force. Default site leads.
 */
export async function seedWcmOps(S: RunQ) {
  const { REVISED_IPP, REVISED_VERSION } = await import("../wcm/ops");
  let i = 0;
  for (const r of REVISED_IPP) for (const site of ["South", "North"] as const)
    await S(`insert into wcm_ipp (site, stream, stage, home_fn, unit, ipp, feed, version, status, effective_from, verified, note, sort)
             values ($1,$2,$3,$4,$5,$6,$7,$8,'legacy','2026-10-29',true,'IPP - Targets sheet; units per day-equivalent (confirmed 21 Nov 2026)',$9)
             on conflict (site, stream, stage, version) do nothing`,
      [site, r.stream, r.stage, r.home, r.unit, site === "South" ? r.south : r.north, r.feed, REVISED_VERSION, i++]);
  await S(`insert into wcm_ipp (site, stream, stage, home_fn, unit, ipp, feed, version, status, effective_from, verified, note, sort)
           select warehouse, stream, process, department, 'item', target_per_day, null, 'legacy-costmaster', 'legacy', effective_from, false,
                  'Cost Master processing tabs (history only)', sort
           from aop_proc_norms on conflict (site, stream, stage, version) do nothing`);
  await S(`insert into wcm_site_lead (user_id, site) select id, s from users u join (values ('tariq','North'), ('sudarshan','South')) v(un, s) on u.username = v.un
           on conflict do nothing`);
}
