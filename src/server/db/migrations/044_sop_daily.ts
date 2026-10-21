// S&OP (40-49): daily facts from Snowflake (everything weekly / monthly / MTD is built from these), daily inventory with
// pre-packs kept apart, and the workbook's original actuals kept for reconciliation.
export const sql = /* sql */ `
create table if not exists sop_actuals_daily (
  day date not null,
  feed text not null,                    -- b2c | b2b_mp | retail | category_inward | prepack | category_view | returns
  label text not null default '',        -- marketplace / category / return type ('' = none)
  region text not null check (region in ('south','north','other')),
  qty numeric not null default 0,        -- as counted in the source (pieces / packs)
  units numeric not null default 0,      -- pre-packs expanded (PP4-… = 4 units each)
  orders numeric,
  primary key (day, feed, label, region)
);
create index if not exists sop_actuals_daily_feed on sop_actuals_daily(feed, day);

create table if not exists sop_inventory_daily (
  day date not null,
  warehouse text not null,               -- SAPL-WH1 | SAPL-WH2 | SAPL-NORTH-TAURU
  region text not null check (region in ('south','north','other')),
  units numeric not null default 0,      -- non pre-pack stock (counts against WH capacity)
  prepack_packs numeric not null default 0,
  prepack_units numeric not null default 0,
  primary key (day, warehouse)
);

-- pre-pack stock is kept in a separate area: not part of capacity
alter table sop_wh_capacity add column if not exists prepack_units numeric;
alter table sop_wh_capacity add column if not exists inventory_source text;
-- the workbook's own actuals, kept the first time Snowflake overwrites a row (for reconciliation)
alter table sop_review_rows add column if not exists wb_south_actual numeric;
alter table sop_review_rows add column if not exists wb_north_actual numeric;
alter table sop_review_rows add column if not exists actual_source text;
alter table sop_inventory_flow add column if not exists source text;
alter table sop_returns add column if not exists source text;
`;
