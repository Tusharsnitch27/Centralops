// S&OP (40-49): actuals come only from the Snowflake pipelines. The workbook keeps supplying projections / plans;
// its old actuals are parked in wb_* (reconciliation only) and every other workbook actual is cleared — the next sync refills them.
export const sql = /* sql */ `
update sop_review_rows set wb_south_actual = coalesce(wb_south_actual, south_actual), wb_north_actual = coalesce(wb_north_actual, north_actual),
  south_actual = null, north_actual = null where actual_source is distinct from 'snowflake';
delete from sop_review_rows where coalesce(south_plan, 0) = 0 and coalesce(north_plan, 0) = 0 and actual_source is distinct from 'snowflake';
delete from sop_returns where source is distinct from 'snowflake';
delete from sop_inventory_flow where source is distinct from 'snowflake';
update sop_wh_capacity set inventory = null, prepack_units = null where inventory_source is distinct from 'snowflake';
delete from sop_review_periods where period not in (select distinct date_trunc('month', day)::date from sop_actuals_daily);
update sop_values set actual = null, actual_source = null where actual is not null and actual_source is distinct from 'snowflake';
update sop_streams set actual_source = 'snowflake';
`;
