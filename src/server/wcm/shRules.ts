import "server-only";
import type { RunQ } from "../db";

/**
 * Cost Master › "WH-Storage & Handling Cost" tab: each site's "warehousing" row (J8 South, J24 North, …) is the sum of every
 * warehousing head, and the site total adds manpower + OT on top. So every warehousing head maps 100 % to shared
 * Storage & handling; Monthly Manpower Cost and Monthly OT stay open for the function-level split (Malhar M, 21 Nov 2026).
 * One approved rule per warehousing head (site *, from the snapshot's first month); a head that already has an approved rule is
 * left alone. Runs from the seed (seed.wcm_sh_rules).
 */
export const SH_SLICES = [{ fn: "Storage & handling", channel: null, shared: true, share: 1 }];

export async function seedStorageHandlingRules(S: RunQ, snapshot: string) {
  const heads = await S<{ head: string; from: string }>(
    `select head, min(period)::text as from from wcm_source_line where snapshot_id = $1 and family = 'warehousing' group by 1 order by 1`, [snapshot]);
  let added = 0;
  for (const h of heads) {
    const has = await S(`select 1 from wcm_rule where family = 'warehousing' and head = $1 and status = 'approved' limit 1`, [h.head]);
    if (has.length) continue;
    await S(`insert into wcm_rule (family, head, site, effective_from, slices, driver, reason, evidence, status, decided_at, decision_note)
             values ('warehousing', $1, '*', $2, $3, $4, $5, $6, 'approved', now(), $7)`,
      [h.head, h.from, JSON.stringify(SH_SLICES), "100 % — the head is part of the Storage & Handling total",
        "Cost Master's Storage & Handling tab rolls every warehousing head into Storage & Handling; manpower / OT stay open for the function split",
        "WH-Storage & Handling Cost › warehousing rows (J8 South, J24 North, J40 Both for Oct 2026)",
        "Approved by Malhar M (admin) in the Central Ops build session, 21 Nov 2026"]);
    added++;
  }
  return { added, heads: heads.length };
}
