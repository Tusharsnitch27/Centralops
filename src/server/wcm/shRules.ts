import "server-only";
import type { RunQ } from "../db";
import { manpowerSlices, MP_HEADCOUNT } from "./math";

/**
 * Cost Master › "WH-Storage & Handling Cost" tab: each site's "warehousing" row (J8 South, J24 North, …) is the sum of every
 * warehousing head, and the site total adds manpower + OT on top. So every warehousing head maps 100 % to shared
 * Storage & handling; Monthly Manpower Cost and Monthly OT are split by department below (seedManpowerRules).
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

export async function seedManpowerRules(S: RunQ, snapshot: string) {
  const heads = await S<{ family: string; head: string; site: "South" | "North"; from: string }>(
    `select family, head, site, min(period)::text as from from wcm_source_line where snapshot_id = $1 and family in ('manpower','ot') and site in ('South','North') group by 1, 2, 3 order by 1, 2, 3`, [snapshot]);
  let added = 0;
  for (const h of heads) {
    const has = await S(`select 1 from wcm_rule where family = $1 and head = $2 and site in ($3, '*') and status = 'approved' limit 1`, [h.family, h.head, h.site]);
    if (has.length) continue;
    const sl = manpowerSlices(h.site), hc = MP_HEADCOUNT[h.site];
    await S(`insert into wcm_rule (family, head, site, effective_from, slices, driver, reason, evidence, status, decided_at, decision_note)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', now(), $9)`,
      [h.family, h.head, h.site, h.from, JSON.stringify(sl), "Active headcount by department (attendance employee master)",
        "Inward, Inventory and Housekeeping are Storage & handling; every other department carries its own manpower",
        `Attendance employee master 22 Nov 2026, ${h.site}: ${Object.entries(hc).map(([d, n]) => `${d} ${n}`).join(", ")}`,
        "Approved by Malhar M (admin) in the Central Ops build session, 22 Nov 2026"]);
    added++;
  }
  return { added, heads: heads.length };
}
