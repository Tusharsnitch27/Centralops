import "server-only";
import { q } from "../db";

/** S&OP day plan view key → SLA stream (B2B Marketplace is planned per month only, so it has no day plan). */
export const SLA_STREAMS = [
  { stream: "B2C Shopify", plan: "b2c_sf" }, { stream: "B2C Marketplace", plan: "b2c_mp" },
  { stream: "B2B Retail", plan: "retail_fwd" }, { stream: "B2B Marketplace", plan: null },
] as const;
export type SlaSite = "South" | "North" | "Both";

export interface SlaDay { day: string; lines: number; cancelled: number; noSla: number; eligible: number; dispatched: number; onTime: number; open: number; overdue: number; p50: number | null; p90: number | null; fetched: string }
/**
 * Cohort SLA per created day for a stream (sites summed for Both; P50 / P90 are then dispatched-weighted means of the
 * site percentiles, flagged as approximate). Attainment = on time ÷ (dispatched + overdue): open lines not yet due aren't judged.
 */
export async function slaDays(months: string[], site: SlaSite, stream: string): Promise<SlaDay[]> {
  const rows = await q<{ day: string; lines: number; cancelled: number; no_sla: number; eligible: number; dispatched: number; on_time: number; open: number; overdue: number; p50: number | null; p90: number | null; fetched: string }>(
    `select day::text as day, sum(lines)::int as lines, sum(cancelled)::int as cancelled, sum(no_sla)::int as no_sla, sum(eligible)::int as eligible,
       sum(dispatched)::int as dispatched, sum(on_time)::int as on_time, sum(open)::int as open, sum(overdue)::int as overdue,
       (sum(p50_h * dispatched) / nullif(sum(dispatched) filter (where p50_h is not null), 0))::float8 as p50,
       (sum(p90_h * dispatched) / nullif(sum(dispatched) filter (where p90_h is not null), 0))::float8 as p90, max(fetched_at)::text as fetched
     from wcm_sla_daily where date_trunc('month', day)::date = any($1::date[]) and stream = $2 and ($3 = 'Both' or site = $3) group by 1 order by 1`,
    [months, stream, site]);
  return rows.map((r) => ({ day: r.day, lines: r.lines, cancelled: r.cancelled, noSla: r.no_sla, eligible: r.eligible, dispatched: r.dispatched, onTime: r.on_time, open: r.open, overdue: r.overdue, p50: r.p50, p90: r.p90, fetched: r.fetched }));
}
export const attainment = (d: Pick<SlaDay, "onTime" | "dispatched" | "overdue">) => (d.dispatched + d.overdue ? d.onTime / (d.dispatched + d.overdue) : null);

/** Open lines by age (today − cohort day) as of the last read, per stream. */
export const slaBacklog = (site: SlaSite) => q<{ stream: string; bucket: string; open: number; overdue: number }>(
  `select stream, case when age <= 1 then '0–1 d' when age <= 2 then '2 d' when age <= 3 then '3 d' when age <= 7 then '4–7 d' else '> 7 d' end as bucket,
     sum(open)::int as open, sum(overdue)::int as overdue
   from (select stream, open, overdue, ((now() at time zone 'Asia/Kolkata')::date - day) as age from wcm_sla_daily where ($1 = 'Both' or site = $1) and open > 0) x
   group by 1, 2 order by 1, min(age)`, [site]);
