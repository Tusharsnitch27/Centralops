import "server-only";
import { q } from "../db";
import { currentSnapshot, wcmMonth } from "./queries";
import { MP_HEADCOUNT, rupees } from "./math";

/**
 * Storage & handling economics per site × month (Malhar M, 22 Nov 2026), booked actuals only:
 *  monthly cost      = Cost Master warehousing + manpower + OT (packaging is its own line)
 *  storage & handling = approved Storage & handling slices: every warehousing head + the Inward / Inventory / Housekeeping
 *                       headcount share of manpower + OT
 *  storage per item   = S&H ÷ average on-hand units (snitch_final_inventory_wh2, day-on-day ÷ days)
 *  bins               = each category's average units ÷ its units per bin in today's shelf snapshot (the Emiza method: avg inventory ÷
 *                       bin capacity, with capacity measured, not assumed); holding cost by category = S&H × its share of bins
 *  inward per item    = Inward department's headcount share of manpower + OT ÷ category inward units (S&OP putaway actuals)
 *  manpower by function = the department split of manpower + OT (B2C / B2B forward, returns, …)
 * A month with no booked cost or no inventory reads as missing, never ₹0.
 */
export interface StorageMonth {
  period: string; site: "South" | "North";
  monthly: number | null; sh: number | null; avgUnits: number | null; perItem: number | null;
  bins: number | null; perBin: number | null; inwardUnits: number | null; inwardMp: number | null; inwardPerItem: number | null;
  manpowerByFn: { fn: string; amount: number }[];
  categories: { category: string; avgUnits: number; bins: number; holding: number | null; perUnit: number | null }[];
}

export async function storageView(periods: string[]): Promise<{ months: StorageMonth[]; binsTakenAt: string | null }> {
  const snap = await currentSnapshot();
  const [inv, bins, inward] = await Promise.all([
    q<{ period: string; site: "South" | "North"; category: string; units: number }>(`select month::text as period, site, category, avg_units::float8 as units from wcm_inv_cat where month = any($1::date[])`, [periods]),
    q<{ site: "South" | "North"; category: string; units: number; bins: number; taken_at: string }>(`select site, category, units::float8 as units, bins::float8 as bins, taken_at::text from wcm_bin_cat`),
    q<{ period: string; site: string; units: number }>(`select date_trunc('month', day)::date::text as period, initcap(region) as site, sum(units)::float8 as units
      from sop_actuals_daily where feed = 'category_inward' and region in ('south','north') and date_trunc('month', day)::date = any($1::date[]) group by 1, 2`, [periods]),
  ]);
  const months: StorageMonth[] = [];
  for (const period of periods) for (const site of ["South", "North"] as const) {
    const m = snap ? await wcmMonth(snap.id, period, site, "actual") : null;
    const wh = m ? m.lines.filter((l) => l.family !== "packaging" && l.amount != null) : [];
    const monthly = wh.length ? rupees(wh.reduce((a, l) => a + Math.round(l.amount! * 100), 0)) : null;
    const slices = wh.flatMap((l) => l.slices.map((s) => ({ ...s, family: l.family })));
    const shP = slices.filter((s) => s.fn === "Storage & handling").reduce((a, s) => a + s.paise, 0);
    // S&H carries the Inward / Inventory / Housekeeping share of manpower: a month whose manpower isn't booked (Apr–Jul) would
    // read as warehousing only — roughly half — so it is missing, not a lower figure
    const mpMissing = !m || m.lines.some((l) => (l.family === "manpower" || l.family === "ot") && l.amount == null);
    const sh = wh.length && shP && !mpMissing ? rupees(shP) : null; // no approved S&H slice = missing, never ₹0
    const mpLines = wh.filter((l) => l.family === "manpower" || l.family === "ot");
    const mp = mpLines.length ? mpLines.reduce((a, l) => a + l.amount!, 0) : null;
    const byFn = new Map<string, number>();
    for (const s of slices) if (s.family !== "warehousing" && s.fn) byFn.set(s.fn, (byFn.get(s.fn) ?? 0) + rupees(s.paise));
    const cats = inv.filter((x) => x.period === period && x.site === site && x.units > 0);
    const snapSite = bins.filter((b) => b.site === site);
    const siteUpb = snapSite.reduce((a, b) => a + b.units, 0) / (snapSite.reduce((a, b) => a + b.bins, 0) || 1);
    const catRows = cats.map((c) => { const b = snapSite.find((x) => x.category === c.category); const upb = b && b.bins > 0 ? b.units / b.bins : siteUpb; return { category: c.category, avgUnits: c.units, bins: upb ? c.units / upb : 0 }; });
    const totBins = catRows.reduce((a, c) => a + c.bins, 0), avgUnits = cats.length ? cats.reduce((a, c) => a + c.units, 0) : null;
    const hc = MP_HEADCOUNT[site], inwardShare = hc.Inward / Object.values(hc).reduce((a, n) => a + n, 0);
    const iu = inward.find((x) => x.period === period && x.site === site)?.units ?? null;
    const inwardMp = mp != null ? mp * inwardShare : null;
    months.push({
      period, site, monthly, sh, avgUnits, perItem: sh != null && avgUnits ? sh / avgUnits : null,
      bins: totBins || null, perBin: sh != null && totBins ? sh / totBins : null,
      inwardUnits: iu, inwardMp, inwardPerItem: inwardMp != null && iu ? inwardMp / iu : null,
      manpowerByFn: [...byFn].map(([fn, amount]) => ({ fn, amount })).sort((a, b) => b.amount - a.amount),
      categories: catRows.map((c) => { const holding = sh != null && totBins ? (sh * c.bins) / totBins : null; return { ...c, holding, perUnit: holding != null ? holding / c.avgUnits : null }; })
        .sort((a, b) => b.bins - a.bins),
    });
  }
  return { months, binsTakenAt: bins[0]?.taken_at ?? null };
}
