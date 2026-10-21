// S&OP (40-49): month history + the evaluation views from the "(Plan vs Actual) S&OP" workbook.
export const sql = /* sql */ `
create table if not exists sop_review_periods (
  period date primary key,
  through_day int not null,            -- 20 = month-to-date through the 20th
  label text not null default ''
);

-- Opening vs closing inventory by warehouse (WH Reco)
create table if not exists sop_inventory_flow (
  period date not null,
  warehouse text not null check (warehouse in ('South','North')),
  capacity numeric not null,
  opening numeric, inward_category numeric, inward_returns numeric, outward numeric, closing numeric,
  primary key (period, warehouse)
);

-- Returns into each warehouse, with the forward volume they come back from
create table if not exists sop_returns (
  period date not null,
  warehouse text not null check (warehouse in ('South','North')),
  b2c numeric, b2b numeric, fwd_b2c numeric, fwd_retail numeric,
  primary key (period, warehouse)
);

-- Day-level outbound capacity: required by channel vs planned
create table if not exists sop_ob_capacity (
  day date not null,
  warehouse text not null check (warehouse in ('South','North')),
  mp_required numeric not null default 0,
  retail_required numeric not null default 0,
  planned numeric not null default 0,
  primary key (day, warehouse)
);

-- S&OP review meeting call-outs
create table if not exists sop_callouts (
  id uuid primary key default gen_random_uuid(),
  meeting_date date,
  title text not null,
  poc text not null default '',
  remarks text not null default '',
  status text not null default 'open' check (status in ('open','done')),
  task_id uuid references tasks(id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
`;
