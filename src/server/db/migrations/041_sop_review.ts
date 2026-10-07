// S&OP monthly review views: plan vs actual by row (channel / week / category) split South / North, plus WH capacity.
export const sql = /* sql */ `
create table if not exists sop_review_rows (
  id uuid primary key default gen_random_uuid(),
  view_key text not null,          -- b2c | b2b_mp | retail_fwd | category_inward | prepack | category_view
  period date not null,            -- month start
  row_label text not null,         -- channel / week / category
  row_group text,                  -- e.g. 'Marketplace' for B2C marketplace channels
  sort int not null default 0,
  south_plan numeric, south_actual numeric, north_plan numeric, north_actual numeric,
  note text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (view_key, period, row_label)
);
create table if not exists sop_wh_capacity (
  period date not null,
  warehouse text not null check (warehouse in ('South','North')),
  capacity numeric,                -- units
  inventory numeric,               -- units on hand (month-end)
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (period, warehouse)
);
`;
