// S&OP actuals: history (Apr–Aug 2026) from the Plan vs Actual workbook, Sep 2026 onwards from Snowflake, each finished month frozen.
export const sql = /* sql */ `
create table if not exists sop_month_status (
  period date primary key,
  status text not null default 'open' check (status in ('open','closed')),
  source text not null default 'snowflake' check (source in ('workbook','snowflake')),
  closed_at timestamptz
);
-- months before the cut-over show the workbook's actuals again (kept in wb_* since the Snowflake-only switch)
update sop_review_rows set south_actual = wb_south_actual, north_actual = wb_north_actual, actual_source = 'workbook'
  where period < '2026-09-01' and (wb_south_actual is not null or wb_north_actual is not null);
update sop_review_rows set south_actual = null, north_actual = null, actual_source = null
  where period < '2026-09-01' and actual_source = 'snowflake' and wb_south_actual is null and wb_north_actual is null;
-- daily Snowflake facts before the cut-over are not used any more
delete from sop_actuals_daily where day < '2026-09-01';
insert into sop_month_status (period, status, source, closed_at)
  select g::date, 'closed', 'workbook', now() from generate_series('2026-04-01'::date, '2026-08-01'::date, '1 month') g
  on conflict (period) do update set status = 'closed', source = 'workbook';
`;
