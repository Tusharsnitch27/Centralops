// AOP processing costs (Cost Master › YLK_ / TAURU_Processing Costs) + channel attribution.
//  aop_proc_norms     process norms per warehouse × stream × process (target units / head / day, working days, salary)
//  aop_proc_monthly   per month: S&OP projection, planned MP, final output (sheet history; app-computed going forward)
//  aop_mp_assign      actual department heads (attendance API) split to stream × process — proposed by the app,
//                     confirmed by the warehouse lead (Manish Charan) because the API has no sub-function / channel
//  aop_channel_volume daily volumes per warehouse × family × channel (logistics shipments from cp_1 / eShipz)
//  aop_cost_alloc     cost attributed to channel × process; logistics rows land here once the channel-split tab exists
export const sql = /* sql */ `
create table if not exists aop_proc_norms (
  warehouse text not null check (warehouse in ('South','North')),
  stream text not null,
  process text not null,
  department text,                         -- attendance-app department this process draws heads from
  target_per_day numeric,                  -- units / head / day
  working_days numeric not null default 23,
  avg_salary numeric,                      -- ₹ / head / month
  ideal_output numeric,                    -- sheet "Ideal Output" (monthly units)
  effective_from date not null default '2026-04-01',
  sort int not null default 0,
  primary key (warehouse, stream, process, effective_from)
);
create table if not exists aop_proc_monthly (
  period date not null,
  warehouse text not null check (warehouse in ('South','North')),
  stream text not null,
  process text not null,
  sop_proj numeric,
  planned_mp numeric,
  final_output numeric,
  avg_salary numeric,
  source text not null default 'sheet' check (source in ('sheet','app')),
  updated_at timestamptz not null default now(),
  primary key (period, warehouse, stream, process)
);
create table if not exists aop_mp_assign (
  period date not null,
  warehouse text not null check (warehouse in ('South','North')),
  department text not null,
  stream text not null,
  process text not null,
  heads numeric not null default 0,        -- average present heads per working day assigned to this stream × process
  status text not null default 'proposed' check (status in ('proposed','assigned')),
  assigned_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (period, warehouse, department, stream, process)
);
create table if not exists aop_channel_volume (
  day date not null,
  warehouse text not null check (warehouse in ('South','North','Other')),
  family text not null check (family in ('warehouse','logistics')),
  channel text not null,
  metric text not null default 'shipments',
  qty numeric not null default 0,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (day, warehouse, family, channel, metric)
);
create table if not exists aop_cost_alloc (
  period date not null,
  warehouse text not null check (warehouse in ('South','North','All')),
  family text not null check (family in ('warehouse','logistics')),
  channel text not null,
  process text not null default '',
  vendor text not null default '',
  amount numeric not null,
  basis text not null check (basis in ('direct','allocated')),
  source text not null,                    -- 'sheet:<tab>' | 'app'
  updated_at timestamptz not null default now(),
  primary key (period, warehouse, family, channel, process, vendor)
);
`;
