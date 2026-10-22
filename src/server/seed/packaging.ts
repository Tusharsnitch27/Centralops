import "server-only";
import type { RunQ } from "../db";
import data from "../../db/seed/packaging-fy27.json";
import { aopLineOf, normType } from "../packaging/model";
import { writeAopActuals } from "../packaging/engine";

/** Packaging history Nov 2025 – Aug 2026 from the workbook (frozen months, year kept) + the rate list in force from Sep 2026. */
export async function seedPackaging(S: RunQ) {
  for (const r of data.rates)
    await S(`insert into pkg_rates (package_type, effective_from, rate, note) values ($1,$2,$3,'Rate list Oct 2026') on conflict (package_type, effective_from) do nothing`,
      [normType(r.package_type), data.rates_from, r.rate]);
  const agg = new Map<string, { period: string; marketplace: string; type: string; qty: number; amount: number }>();
  for (const r of data.rows) {
    const k = `${r.period}|${r.marketplace}|${normType(r.package_type)}`;
    const a = agg.get(k) ?? { period: r.period, marketplace: r.marketplace, type: normType(r.package_type), qty: 0, amount: 0 };
    a.qty += r.qty; a.amount += r.amount; agg.set(k, a);
  }
  for (const a of agg.values())
    await S(`insert into pkg_monthly (period, marketplace, package_type, aop_line, qty, rate, amount, source) values ($1,$2,$3,$4,$5,$6,$7,'file')
             on conflict (period, marketplace, package_type) do nothing`,
      [a.period, a.marketplace, a.type, aopLineOf(a.marketplace), a.qty, a.qty ? Math.round((a.amount / a.qty) * 10000) / 10000 : null, Math.round(a.amount * 100) / 100]);
  const periods = [...new Set(data.rows.map((r) => r.period))];
  for (const p of periods) {
    await S(`insert into pkg_months (period, status, source, closed_at) values ($1,'closed','file',now()) on conflict (period) do nothing`, [p]);
    await writeAopActuals(S, p, null); // months inside an AOP cycle (FY27: May–Aug) become its Packaging actuals
  }
}
