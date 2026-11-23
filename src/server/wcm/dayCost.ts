import "server-only";
import { q } from "../db";
import { currentSnapshot } from "./queries";
import { perDe, splitDay, type CostLine } from "./dayMath";

/**
 * Cost of doing business per day (D-1), per site or Both. Each line says how it was priced:
 *  manpower    measured attendance DE × salary master (wcm_mp_rate) ÷ days basis, by home function (B2C / B2B direct, rest shared)
 *  OT          approved OT hours (mp_ot_daily) × OT rate — missing until both exist
 *  warehousing run-rate: latest booked Cost Master month (warehousing family) ÷ its days
 *  packaging   measured packages (pkg_usage_daily) × rate — Both only (no site split)
 *  logistics   B2C: courier shipments that day × that courier's latest all-in CPS (FWD + RTO + DTO billed ÷ FWD AWBs, so the
 *              daily sum tracks the monthly bill); B2B: latest month's LR
 *              freight ÷ its days — Both only (all-India)
 * Volume: dispatched shipments / items per stream (wcm_stage_output). Booked months replace the estimate in the monthly view.
 */
export type DaySite = "South" | "North" | "Both";
const B2C_FN = ["B2C Forward", "B2C Return"], B2B_FN = ["B2B Forward", "B2B Return"];
const daysIn = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
/** working-file courier names ↔ shipment feed vendor names */
export const courierOf = (vendor: string) => (/blitz|bigshort/i.test(vendor) ? "Blitz" : /ekart|instakart/i.test(vendor) ? "Ekart" : /shiprocket|bigfoot/i.test(vendor) ? "Shiprocket"
  : /bluedart/i.test(vendor) ? "Bluedart" : /delhivery/i.test(vendor) ? "Delhivery" : /^shadowfax$/i.test(vendor) ? "Shadowfax" : /prozo/i.test(vendor) ? "Prozo" : null);

export async function dayCost(from: string, to: string, site: DaySite) {
  const sites = site === "Both" ? ["South", "North"] : [site];
  const snap = await currentSnapshot();
  const [mp, rates, ot, wh, vol, pkg, ships, b2cCps, b2bMonth] = await Promise.all([
    q<{ day: string; site: string; fn: string | null; de: number }>(
      `select d.day::text as day, sm.warehouse as site, fm.department as fn, sum(d.heads)::float8 as de from mp_daily d
         join mp_site_map sm on sm.site = d.site and sm.warehouse = any($3::text[]) left join mp_func_map fm on fm.func = d.func
        where d.day between $1 and $2 group by 1, 2, 3`, [from, to, sites]),
    q<{ site: string; effective_from: string; monthly_salary: number; days_basis: number; ot_hourly: number | null; note: string | null }>(
      `select site, effective_from::text, monthly_salary::float8, days_basis, ot_hourly::float8, note from wcm_mp_rate order by effective_from`),
    q<{ day: string; site: string; fn: string | null; hours: number }>(
      `select o.day::text as day, sm.warehouse as site, fm.department as fn, sum(o.approved_hours)::float8 as hours from mp_ot_daily o
         join mp_site_map sm on sm.site = o.site and sm.warehouse = any($3::text[]) left join mp_func_map fm on fm.func = o.func
        where o.day between $1 and $2 group by 1, 2, 3`, [from, to, sites]),
    snap ? q<{ period: string; site: string; amount: number }>(
      `select period::text as period, site, sum(amount)::float8 as amount from wcm_source_line where snapshot_id = $1 and basis = 'actual' and family = 'warehousing'
         and amount is not null and site = any($2::text[]) group by 1, 2`, [snap.id, sites]) : Promise.resolve([]),
    q<{ day: string; stream: string; event: string; qty: number }>(
      `select day::text as day, stream, event, sum(qty)::float8 as qty from wcm_stage_output where day between $1 and $2 and site = any($3::text[])
         and event in ('dispatched', 'shipments') group by 1, 2, 3`, [from, to, sites]),
    q<{ day: string; b2b: boolean; amount: number }>(
      `select u.day::text as day, u.package_type ilike '%B2B%' as b2b, sum(u.packages * r.rate)::float8 as amount from pkg_usage_daily u
         join lateral (select rate from pkg_rates r where r.package_type = u.package_type and r.effective_from <= u.day order by effective_from desc limit 1) r on true
        where u.day between $1 and $2 group by 1, 2`, [from, to]),
    q<{ day: string; vendor: string; n: number }>(
      `select day::text as day, substr(metric, 11) as vendor, sum(qty)::float8 as n from aop_channel_volume where family = 'logistics' and metric like 'shipments:%'
         and channel in ('B2C Shopify', 'B2C Marketplace', 'Q-Com') and day between $1 and $2 group by 1, 2`, [from, to]),
    q<{ courier: string; month: string; cps: number }>(
      `select courier, month::text as month, (sum(cost) / nullif(sum(awbs) filter (where type = 'FWD'), 0))::float8 as cps from lg_b2c_month group by 1, 2`),
    q<{ month: string; freight: number }>(`select month::text as month, sum(freight)::float8 as freight from lg_b2b_lr group by 1`),
  ]);

  const days: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) days.push(d);
  const rateOn = (s: string, d: string) => rates.filter((r) => r.site === s && r.effective_from <= d).at(-1) ?? null;
  const latestBefore = <T extends { month?: string; period?: string }>(rows: T[], d: string, key: "month" | "period") =>
    rows.filter((r) => (r[key] as string) <= monthOf(d)).sort((a, b) => ((a[key] as string) < (b[key] as string) ? -1 : 1)).at(-1) ?? null;

  return days.map((day) => {
    const lines: CostLine[] = [];
    const present = mp.filter((r) => r.day === day);
    if (!present.length) lines.push({ key: "mp", label: "Manpower", amount: null, basis: "missing", note: "no attendance captured (attendance starts 29 Oct 2026)", side: "shared" });
    for (const side of ["B2C", "B2B", "shared"] as const) {
      const rs = present.filter((r) => (side === "B2C" ? B2C_FN.includes(r.fn ?? "") : side === "B2B" ? B2B_FN.includes(r.fn ?? "") : ![...B2C_FN, ...B2B_FN].includes(r.fn ?? "")));
      if (!rs.length) continue;
      let amt = 0, de = 0; const notes: string[] = [];
      for (const s of sites) {
        const r = rateOn(s, day), d = rs.filter((x) => x.site === s).reduce((a, x) => a + x.de, 0);
        if (!d) continue;
        if (!r) { amt = NaN; continue; }
        amt += d * perDe(r.monthly_salary, r.days_basis); de += d;
        notes.push(`${s} ₹${r.monthly_salary.toLocaleString("en-IN")} / ${r.days_basis} d${/default/i.test(r.note ?? "") ? " (default rate)" : ""}`);
      }
      lines.push({ key: `mp:${side}`, label: `Manpower · ${side === "shared" ? "inward, inventory, ops, admin" : side}`, amount: Number.isNaN(amt) ? null : amt,
        basis: Number.isNaN(amt) ? "missing" : "measured", note: `${Math.round(de * 10) / 10} DE × ${notes.join(", ")}`, side });
    }
    const otRows = ot.filter((r) => r.day === day), hours = otRows.reduce((a, r) => a + r.hours, 0);
    const otRate = sites.map((s) => rateOn(s, day)?.ot_hourly ?? null);
    lines.push(!otRows.length || otRate.some((x) => x == null)
      ? { key: "ot", label: "Overtime", amount: null, basis: "missing", note: !otRows.length ? "no OT hours received (attendance /ot endpoint not live yet)" : "no OT ₹/hour in the salary master", side: "shared" }
      : { key: "ot", label: "Overtime", amount: sites.reduce((a, s, i) => a + otRows.filter((r) => r.site === s).reduce((x, r) => x + r.hours, 0) * otRate[i]!, 0), basis: "measured", note: `${hours} approved hours`, side: "shared" });
    let whAmt = 0; const whNotes: string[] = []; let whMissing = false;
    for (const s of sites) {
      const b = latestBefore(wh.filter((r) => r.site === s), day, "period");
      if (!b) { whMissing = true; continue; }
      whAmt += b.amount / daysIn(b.period); whNotes.push(`${s} ${b.period.slice(0, 7)} booked ÷ ${daysIn(b.period)} d`);
    }
    lines.push({ key: "wh", label: "Warehousing (rent, utilities, security, …)", amount: whMissing ? null : whAmt, basis: whMissing ? "missing" : "run-rate", note: whNotes.join(" · ") || "no booked month", side: "shared" });
    if (site === "Both") {
      const p = pkg.filter((r) => r.day === day);
      if (!p.length) lines.push({ key: "pkg", label: "Packaging", amount: null, basis: "missing", note: "no packaging usage that day", side: "shared" });
      for (const b of [false, true]) { const x = p.find((r) => r.b2b === b); if (x) lines.push({ key: `pkg:${b}`, label: `Packaging · ${b ? "B2B" : "B2C"}`, amount: x.amount, basis: "measured", note: "packages × rate list", side: b ? "B2B" : "B2C" }); }
      const sh = ships.filter((r) => r.day === day);
      let lg = 0, priced = 0, unpriced = 0;
      for (const r of sh) { const c = courierOf(r.vendor), cps = c ? latestBefore(b2cCps.filter((x) => x.courier === c), day, "month") : null; if (cps) { lg += r.n * cps.cps; priced += r.n; } else unpriced += r.n; }
      // nothing priced (no courier working file loaded) is missing, never ₹0
      lines.push({ key: "lg:b2c", label: "Logistics · B2C couriers", amount: priced ? lg : null, basis: priced ? "run-rate" : "missing",
        note: !sh.length ? "no shipment feed that day" : !priced ? `no courier CPS yet — upload the B2C working file on AOP › Logistics (${Math.round(unpriced)} shipments unpriced)` : `${Math.round(priced)} shipments × each courier's latest all-in CPS (forward + RTO + DTO billed ÷ forward AWBs)${unpriced ? ` · ${Math.round(unpriced)} with no CPS (HLD / self / quick) not priced` : ""}`, side: "B2C", units: priced });
      const bm = latestBefore(b2bMonth, day, "month");
      lines.push({ key: "lg:b2b", label: "Logistics · B2B freight", amount: bm ? bm.freight / daysIn(bm.month) : null, basis: bm ? "run-rate" : "missing", note: bm ? `${bm.month.slice(0, 7)} LR freight ÷ ${daysIn(bm.month)} d` : "no B2B working file", side: "B2B" });
    }
    const v = vol.filter((r) => r.day === day), sumv = (ev: string, pre: string) => v.filter((r) => r.event === ev && r.stream.startsWith(pre)).reduce((a, r) => a + r.qty, 0);
    const items = { b2c: sumv("dispatched", "B2C"), b2b: sumv("dispatched", "B2B") }, shipments = { b2c: sumv("shipments", "B2C"), shopify: sumv("shipments", "B2C Shopify") };
    return { day, lines, items, shipments, ...splitDay(lines, items, shipments) };
  });
}
export type DayCostRow = Awaited<ReturnType<typeof dayCost>>[number];

/**
 * Monthly history, same split and units as the day view: booked Cost Master (warehousing + manpower + OT + packaging, shared) +
 * logistics working files (B2C couriers → B2C, B2B freight → B2B); volume from S&OP outwards (Unicommerce): B2C orders and
 * items, B2B items (marketplace + retail). A month missing booked lines, a logistics file or S&OP daily actuals is flagged
 * incomplete and kept out of the baseline — never priced as 0.
 */
export async function monthHistory() {
  const snap = await currentSnapshot();
  if (!snap) return [];
  const [booked, b2c, b2b, sop] = await Promise.all([
    q<{ period: string; family: string; amount: number; missing: number }>(
      `select period::text as period, family, coalesce(sum(amount), 0)::float8 as amount, count(*) filter (where amount is null)::int as missing
         from wcm_source_line where snapshot_id = $1 and basis = 'actual' and family in ('warehousing','manpower','ot','packaging') group by 1, 2`, [snap.id]),
    q<{ month: string; cost: number; awbs: number }>(`select month::text as month, sum(cost)::float8 as cost, sum(awbs) filter (where type = 'FWD')::float8 as awbs from lg_b2c_month group by 1`),
    q<{ month: string; freight: number; lrs: number }>(`select month::text as month, sum(freight)::float8 as freight, count(*)::int as lrs from lg_b2b_lr group by 1`),
    q<{ month: string; days: number; b2c_orders: number; b2c_items: number; b2b_items: number }>(
      `select date_trunc('month', day)::date::text as month, count(distinct day)::int as days, coalesce(sum(orders) filter (where feed = 'b2c'), 0)::float8 as b2c_orders,
         coalesce(sum(units) filter (where feed = 'b2c'), 0)::float8 as b2c_items, coalesce(sum(units) filter (where feed in ('b2b_mp', 'retail')), 0)::float8 as b2b_items
       from sop_actuals_daily where feed in ('b2c', 'b2b_mp', 'retail') group by 1`),
  ]);
  // months up to the running one that hold any booked amount or a logistics file (plan-only future months are not history)
  const cur = new Date().toISOString().slice(0, 7) + "-01";
  const months = [...new Set([...booked.filter((r) => r.amount).map((r) => r.period), ...b2c.map((r) => r.month), ...b2b.map((r) => r.month)])].filter((m) => m <= cur).sort();
  return months.map((m) => {
    const fam = (f: string) => booked.find((r) => r.period === m && r.family === f);
    const wh = ["warehousing", "manpower", "ot", "packaging"].reduce((a, f) => a + (fam(f)?.amount ?? 0), 0);
    const missing = ["warehousing", "manpower", "ot", "packaging"].reduce((a, f) => a + (fam(f)?.missing ?? 0), 0) + (fam("manpower") ? 0 : 1);
    const c = b2c.find((r) => r.month === m), b = b2b.find((r) => r.month === m), v = sop.find((r) => r.month === m);
    const volOk = !!v && v.days >= daysIn(m) - 1; // S&OP daily actuals cover the month (Apr–Aug are workbook monthly figures)
    const sp = splitDay([
      { key: "wh", label: "Warehouse (booked)", amount: wh, basis: "booked", note: "", side: "shared" },
      { key: "c", label: "B2C logistics", amount: c?.cost ?? null, basis: "booked", note: "", side: "B2C" },
      { key: "b", label: "B2B logistics", amount: b?.freight ?? null, basis: "booked", note: "", side: "B2B" },
    ], { b2c: v?.b2c_items ?? 0, b2b: v?.b2b_items ?? 0 }, { b2c: v?.b2c_orders ?? 0 });
    return { month: m, warehouse: wh, b2cLogistics: c?.cost ?? null, b2bLogistics: b?.freight ?? null, total: sp.total, b2c: sp.b2c, b2b: sp.b2b,
      b2cOrders: volOk ? v!.b2c_orders : null, b2bItems: volOk ? v!.b2b_items : null, cpsB2c: volOk ? sp.cpsB2c : null, cpuB2b: volOk ? sp.cpuB2b : null,
      complete: !missing && !!c && !!b && volOk, missing, volOk };
  });
}
