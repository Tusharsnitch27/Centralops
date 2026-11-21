import "server-only";
import { q } from "../db";
import { activeIpps } from "./daily";
import { today } from "@/lib/dates";
import type { SlaModel } from "@/components/aop/processing/slaSim";

/** S&OP day plan view key → SLA stream (B2B Marketplace is planned per month only, so it has no day plan). */
export const SLA_STREAMS = [
  { stream: "B2C Shopify", plan: "b2c_sf", unit: "lines", rule: "Unicommerce SLA_STATUS vs the Shopify TAT ladder" },
  { stream: "B2C Marketplace", plan: "b2c_mp", unit: "lines", rule: "Unicommerce SLA_STATUS vs the marketplace fulfilment TAT" },
  { stream: "B2B Retail", plan: "retail_fwd", unit: "units", rule: "retail_journey_spine HANDOVER_SLA vs the handover deadline" },
  { stream: "B2B Marketplace", plan: null, unit: "units", rule: "Marketplace<>Warehouse tracker: RTS date vs the planned dispatch date (no UC TAT for this channel)" },
] as const;
export type SlaSite = "South" | "North" | "Both";
const SITE = `case wh when 'NORTH' then 'North' else 'South' end`;

export interface SlaDay {
  day: string; units: number; onTime: number; futDone: number; breached: number; pendBreach: number; futOpen: number;
  cancelled: number; unfulfillable: number; noSla: number; delayFlagged: number; orders: number | null; ordersLate: number | null;
  o2mH: number | null; fetched: string;
}
/** Per deadline day for a stream (sites summed for Both). Statuses as computed upstream — see feed.ts. */
export async function slaDays(months: string[], site: SlaSite, stream: string): Promise<SlaDay[]> {
  const rows = await q<Record<string, number | string | null>>(
    `select deadline::date::text as day, sum(units)::float8 as units, sum(within)::float8 as on_time, sum(fut_done)::float8 as fut_done, sum(breached)::float8 as breached,
       sum(pend_breach)::float8 as pend_breach, sum(fut_open)::float8 as fut_open, sum(cancelled)::float8 as cancelled, sum(unfulfillable)::float8 as unfulfillable,
       sum(no_sla)::float8 as no_sla, sum(delay_flagged)::float8 as delay_flagged, sum(orders)::int as orders, sum(orders_late)::int as orders_late,
       (sum(o2m_h) / nullif(sum(o2m_n), 0))::float8 as o2m, max(fetched_at)::text as fetched
     from wcm_sla_cell where date_trunc('month', deadline)::date = any($1::date[]) and stream = $2 and ($3 = 'Both' or ${SITE} = $3) and wave <> 'No SLA'
     group by 1 order by 1`, [months, stream, site]);
  return rows.map((r) => ({
    day: String(r.day), units: Number(r.units), onTime: Number(r.on_time), futDone: Number(r.fut_done), breached: Number(r.breached), pendBreach: Number(r.pend_breach),
    futOpen: Number(r.fut_open), cancelled: Number(r.cancelled), unfulfillable: Number(r.unfulfillable), noSla: Number(r.no_sla), delayFlagged: Number(r.delay_flagged),
    orders: r.orders == null ? null : Number(r.orders), ordersLate: r.orders_late == null ? null : Number(r.orders_late), o2mH: r.o2m == null ? null : Number(r.o2m), fetched: String(r.fetched),
  }));
}
/** No-deadline volume per stream for the months (B2B NSO / QCOM, undated tracker rows) — shown, never judged. */
export const slaNoDeadline = (months: string[], site: SlaSite, stream: string) => q<{ units: number }>(
  `select coalesce(sum(units), 0)::float8 as units from wcm_sla_cell where date_trunc('month', deadline)::date = any($1::date[]) and stream = $2 and ($3 = 'Both' or ${SITE} = $3) and wave = 'No SLA'`,
  [months, stream, site]).then((r) => r[0]?.units ?? 0);

/** Judged = done on time (incl. done ahead of a future deadline) + done late + not done past the deadline. */
export const judged = (d: Pick<SlaDay, "onTime" | "futDone" | "breached" | "pendBreach">) => d.onTime + d.futDone + d.breached + d.pendBreach;
export const attainment = (d: Pick<SlaDay, "onTime" | "futDone" | "breached" | "pendBreach">) => (judged(d) ? (d.onTime + d.futDone) / judged(d) : null);

/** Open work by age (today − created day) as of the last read: overdue = deadline passed. */
export const slaBacklog = (site: SlaSite) => q<{ stream: string; bucket: string; open: number; overdue: number }>(
  `select stream, case when age <= 1 then '0–1 d' when age <= 2 then '2 d' when age <= 3 then '3 d' when age <= 7 then '4–7 d' else '> 7 d' end as bucket,
     sum(pend_breach + fut_open)::float8 as open, sum(pend_breach)::float8 as overdue
   from (select stream, pend_breach, fut_open, ((now() at time zone 'Asia/Kolkata')::date - created_hr::date) as age from wcm_sla_cell
         where ($1 = 'Both' or ${SITE} = $1) and pend_breach + fut_open > 0) x
   group by 1, 2 order by 1, min(age)`, [site]);

/** Present DE starts with the attendance role feed (29 Oct 2026); the SLA replay only uses days with both. */
const MODEL_FROM = "2026-10-29";
/** Channel → attendance home function and capacity basis. B2B Marketplace: 5,000 units / day per warehouse (Malhar, 21 Nov 2026). */
const FUNC: Record<string, "B2C Forward" | "B2B Forward"> = { "B2C Shopify": "B2C Forward", "B2C Marketplace": "B2C Forward", "B2B Retail": "B2B Forward", "B2B Marketplace": "B2B Forward" };
export const B2B_MP_UNITS_PER_DAY = 5000;

/**
 * Input for the AOP › Analysis SLA headroom replay (client-side, slaSim.ts): judged SLA cells per deadline day with present DE
 * per shift and today's site IPPs. Only stages with an output feed count as work (the rest are listed with what they'd add).
 */
export async function slaModel(): Promise<SlaModel> {
  const to = today();
  const [cells, de, rate, ippS, ippN] = await Promise.all([
    q<{ deadline: string; created: string; wh: string; stream: string; units: number; late: number }>(
      `select to_char(deadline, 'YYYY-MM-DD HH24:MI') as deadline, to_char(created_hr, 'YYYY-MM-DD HH24:MI') as created, wh, stream,
         sum(within + fut_done + breached + pend_breach + fut_open)::float8 as units, sum(breached + pend_breach)::float8 as late
       from wcm_sla_cell where wave <> 'No SLA' and deadline::date >= $1::date and deadline::date < $2::date group by 1, 2, 3, 4 having sum(within + fut_done + breached + pend_breach + fut_open) > 0`,
      [MODEL_FROM, to]),
    q<{ day: string; wh: string; func: string; shift: string; de: number }>(
      `select day::text as day, site as wh, func, shift, sum(de)::float8 as de from mp_role_daily
       where day >= $1::date and day < $2::date and func in ('B2C Forward','B2B Forward') and shift in ('Day','Night') group by 1, 2, 3, 4`, [MODEL_FROM, to]),
    q<{ site: string; monthly_salary: number; note: string | null }>(`select distinct on (site) site, monthly_salary::float8, note from wcm_mp_rate where effective_from <= $1::date order by site, effective_from desc`, [to]),
    activeIpps(to, "South"), activeIpps(to, "North"),
  ]);
  const work: SlaModel["work"] = {}, unfed: SlaModel["unfed"] = [];
  for (const [site, ipps] of [["South", ippS], ["North", ippN]] as const) for (const stream of Object.keys(FUNC)) {
    if (stream === "B2B Marketplace") continue; // capacity basis is units / day, not IPP
    const rows = ipps.filter((r) => r.stream === stream && r.ipp && r.unit === "unit");
    const fed = rows.filter((r) => r.feed), version = rows[0]?.version ?? null;
    work[`${site}|${stream}`] = fed.length ? { perUnit: fed.reduce((a, r) => a + 1 / r.ipp!, 0), stages: fed.map((r) => `${r.stage} ${r.ipp}`), version } : null;
    for (const r of rows.filter((x) => !x.feed)) unfed.push({ site, stream, stage: r.stage, ipp: r.ipp! });
  }
  return {
    from: MODEL_FROM, to, mpUnitsPerDay: B2B_MP_UNITS_PER_DAY,
    cells: cells.map((c) => ({ ...c, func: FUNC[c.stream] ?? null })).filter((c): c is typeof c & { func: "B2C Forward" | "B2B Forward" } => c.func != null),
    de, work, unfed,
    salary: Object.fromEntries(rate.map((r) => [r.site, { monthly: r.monthly_salary, isDefault: /default/i.test(r.note ?? "") }])),
  };
}
