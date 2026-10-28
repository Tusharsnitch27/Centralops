// Manpower from the warehouse manpower tool (read-only API, pulled every morning). Only daily heads per site × function are kept —
// no attendance. Their sites / functions are mapped once to South / North and the capacity-planning departments; standards
// (units per head per day) turn heads into actual capacity, and S&OP daily actuals give achieved %.
export const sql = /* sql */ `
create table if not exists mp_daily (
  day date not null,
  site text not null,                    -- as the manpower tool names it
  func text not null,                    -- as the manpower tool names it
  heads numeric not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (day, site, func)
);
create table if not exists mp_site_map (
  site text primary key,
  warehouse text not null check (warehouse in ('South','North','ignore')),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists mp_func_map (
  func text primary key,
  department text,                       -- capacity-planning department; null = not a warehouse function (ignored)
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists mp_rates (
  department text not null,
  warehouse text not null check (warehouse in ('South','North')),
  effective_from date not null,
  units_per_head numeric not null check (units_per_head >= 0),
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (department, warehouse, effective_from)
);
create table if not exists mp_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'manual',
  from_date date,
  to_date date,
  status text not null default 'running' check (status in ('running','ok','failed')),
  rows_read int,
  rows_written int,
  message text,
  actor_id uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
`;
