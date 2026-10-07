import "server-only";
import { q } from "../db";
import type { ActualSource, Stream } from "./model";

/**
 * Where S&OP actuals come from. Today: manual entry (and clearly-flagged demo values for B2C/B2B so review views work).
 * Once Snowflake access is shared, a SnowflakeActualsProvider runs each stream's `actual_query` and upserts sop_values.actual
 * with actual_source = 'snowflake'. Pages never care which provider is used — they read sop_values.
 */
export interface ActualRow { lineId: string; period: string; periodLabel: string; dimension: string; actual: number }

export interface ActualsProvider {
  key: ActualSource;
  label: string;
  /** True when the provider can produce actuals right now. */
  ready(stream: Stream): boolean;
  /** Users may type actuals for this stream. */
  manualEntry: boolean;
  /** One-line explanation shown in the Data source panel. */
  describe(stream: Stream): string;
  /** Actuals for one month of a stream (weeks / dimensions as rows). */
  fetch(stream: Stream, period: string): Promise<ActualRow[]>;
}

const readStored = async (stream: Stream, period: string, source?: ActualSource) =>
  (await q<{ line_id: string; period: string; period_label: string; dimension: string; actual: number }>(
    `select v.line_id, v.period, v.period_label, v.dimension, v.actual from sop_values v join sop_lines l on l.id = v.line_id
     where l.stream_id = $1 and v.period = $2::date and v.actual is not null ${source ? "and v.actual_source = $3" : ""}`,
    source ? [stream.id, period, source] : [stream.id, period],
  )).map((r) => ({ lineId: r.line_id, period: r.period, periodLabel: r.period_label, dimension: r.dimension, actual: r.actual }));

export const manualProvider: ActualsProvider = {
  key: "manual",
  label: "Manual entry",
  manualEntry: true,
  ready: () => true,
  describe: (s) => `${s.poc_name ?? s.poc_label ?? "The POC"} or the PM enters actuals in Projections → Enter actuals until a Snowflake mapping is configured.`,
  fetch: (s, p) => readStored(s, p),
};

export const demoProvider: ActualsProvider = {
  key: "demo",
  label: "Demo actuals",
  manualEntry: true,
  ready: () => true,
  describe: () => "Past-month actuals are illustrative demo values so the review views work today. They will be replaced by Snowflake once access is shared — do not use them for decisions.",
  fetch: (s, p) => readStored(s, p, "demo"),
};

export const snowflakeProvider: ActualsProvider = {
  key: "snowflake",
  label: "Snowflake",
  manualEntry: false,
  ready: (s) => Boolean(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_PAT && s.actual_query?.trim()),
  describe: (s) => s.actual_query?.trim()
    ? "Actuals will be pulled from Snowflake with the mapped query (params :period_start, :period_end) and stored per line, week and warehouse."
    : "Snowflake selected, but no query is mapped yet. Add the query once access is shared; until then actuals stay empty.",
  // Not wired yet: Snowflake access is pending. Returning stored values keeps pages consistent when the job lands.
  fetch: (s, p) => readStored(s, p, "snowflake"),
};

export const PROVIDERS: Record<ActualSource, ActualsProvider> = { manual: manualProvider, demo: demoProvider, snowflake: snowflakeProvider };
export const providerFor = (s: Pick<Stream, "actual_source">) => PROVIDERS[s.actual_source] ?? manualProvider;

/** Whether a Snowflake connection exists at all (env or integrations row). */
export async function snowflakeStatus() {
  const env = Boolean(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_PAT);
  const row = (await q<{ status: string; last_sync_at: Date | null }>(`select status, last_sync_at from integrations where provider = 'snowflake' order by created_at desc limit 1`))[0];
  return { connected: env || row?.status === "connected", lastSync: row?.last_sync_at ? new Date(row.last_sync_at).toISOString() : null };
}

/** Placeholder query shown in the Data source panel. */
export const QUERY_TEMPLATE = `-- Return one row per line × period (× week, × warehouse)
-- :period_start / :period_end are bound by Central Ops
select line_name, period_label, warehouse as dimension, sum(qty) as actual
from <schema>.<table>
where order_date between :period_start and :period_end
group by 1, 2, 3`;
