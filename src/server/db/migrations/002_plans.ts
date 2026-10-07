// AOP (annual operating plan) and S&OP (sales & operations planning) schema.
export const sql = /* sql */ `
-- ============ AOP ============
-- Organisation → Section (function/team/group, nestable) → Item (line/metric) → monthly Plan / Forecast / Actual.
create table aop_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'cost' check (kind in ('cost','revenue','mixed')),
  fy_start date not null,                 -- first month of the plan year
  months int not null default 12,
  status text not null default 'active' check (status in ('draft','active','closed')),
  currency text not null default 'INR',
  -- display names for the three measures; e.g. cost plans call them Budget / Provision / Actuals
  labels jsonb not null default '{"plan":"Plan","forecast":"Forecast","actual":"Actual"}',
  actuals_cutoff_day int not null default 7,       -- actuals for month M due by this day of M+1
  projection_cutoff_day int not null default 20,   -- projections for the next quarter due by this day
  guidelines jsonb not null default '[]',
  source_file text,
  owner_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table aop_sections (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references aop_cycles(id) on delete cascade,
  parent_id uuid references aop_sections(id) on delete cascade,
  name text not null,
  kind text not null default 'function' check (kind in ('function','team','group')),
  owner_id uuid references users(id) on delete set null,
  owner_label text,                       -- as written in the plan, e.g. "Manish & Mahadevan"
  team_id uuid references teams(id) on delete set null,
  sort int not null default 0
);
create index aop_sections_cycle on aop_sections(cycle_id);

create table aop_items (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references aop_cycles(id) on delete cascade,
  section_id uuid not null references aop_sections(id) on delete cascade,
  name text not null,
  metric text,                            -- e.g. "Cost", "Revenue", "Orders"
  unit text not null default 'inr' check (unit in ('inr','num','pct')),
  direction text not null default 'lower_better' check (direction in ('lower_better','higher_better')),
  owner_id uuid references users(id) on delete set null,
  annual_target numeric,                  -- null = sum of monthly plan
  confidence text check (confidence in ('high','medium','low')),
  reference text,
  attributes jsonb not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index aop_items_section on aop_items(section_id);

-- additional owners / contributors (sections or items may have several)
create table aop_owners (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references aop_sections(id) on delete cascade,
  item_id uuid references aop_items(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','contributor','approver'))
);

create table aop_period_values (
  item_id uuid not null references aop_items(id) on delete cascade,
  period date not null,                   -- month start
  plan numeric,
  forecast numeric,
  actual numeric,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (item_id, period)
);

-- value change history (feeds the audit trail and "what changed" comparisons)
create table aop_updates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references aop_items(id) on delete cascade,
  period date,
  field text not null,                    -- plan | forecast | actual | annual_target | owner
  old_value text,
  new_value text,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index aop_updates_item on aop_updates(item_id, created_at desc);

create table aop_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references aop_items(id) on delete cascade,
  period date,
  kind text not null default 'commentary' check (kind in ('commentary','variance_reason','corrective_action')),
  body text not null,
  confidence text check (confidence in ('high','medium','low')),
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index aop_comments_item on aop_comments(item_id, period);

-- Input collection: per section × period × kind (actuals / projections)
create table aop_submissions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references aop_cycles(id) on delete cascade,
  section_id uuid not null references aop_sections(id) on delete cascade,
  period date not null,
  kind text not null check (kind in ('actuals','projections')),
  owner_id uuid references users(id) on delete set null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','submitted','approved','returned')),
  submitted_at timestamptz,
  submitted_by uuid references users(id) on delete set null,
  note text,
  unique (section_id, period, kind)
);

create table aop_import_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  header_rows int not null default 1,
  mapping jsonb not null,                 -- { columns: [{ index, field, period?, measure? }] , defaults: {...} }
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table aop_imports (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references aop_cycles(id) on delete cascade,
  template_id uuid references aop_import_templates(id) on delete set null,
  file_name text,
  rows_imported int,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Cost savings (credit notes) and incident expenses — Central Ops cost-control trackers
create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references aop_cycles(id) on delete cascade,
  function_name text,
  partner text not null,
  cn_type text,
  month_label text,
  amount numeric,
  received numeric,
  owner_id uuid references users(id) on delete set null,
  status text not null default 'open' check (status in ('open','partial','received','rejected')),
  remarks text,
  created_at timestamptz not null default now()
);
create table incident_expenses (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references aop_cycles(id) on delete cascade,
  function_name text,
  month_label text,
  channel text,
  expense_type text,
  reason text,
  amount numeric,
  owner_id uuid references users(id) on delete set null,
  remarks text,
  created_at timestamptz not null default now()
);

-- Configurable insight rules (AOP / S&OP / tasks). rule = {metric, op, threshold, periods, ...}
create table insight_rules (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('aop','sop','tasks','projects')),
  key text unique,
  name text not null,
  description text,
  rule jsonb not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  enabled boolean not null default true,
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ S&OP ============
-- Stream = one input owned by a POC (B2C-SF, B2B-MP, Retail-Forward, Category inbound, Liquidation…)
create table sop_streams (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  area text not null default 'demand' check (area in ('demand','supply','inventory','capacity','liquidation','returns')),
  poc_id uuid references users(id) on delete set null,
  poc_label text,
  description text,
  granularity text not null default 'month' check (granularity in ('month','week','day')),
  unit text not null default 'units',
  dimensions jsonb not null default '[]',     -- e.g. ["North","South"] warehouse split
  due_day int not null default 21,            -- projections for month M due by this day of M-1
  actual_source text not null default 'manual' check (actual_source in ('manual','snowflake','demo')),
  actual_query text,                          -- Snowflake mapping, configured later
  sort int not null default 0,
  active boolean not null default true
);

create table sop_lines (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references sop_streams(id) on delete cascade,
  name text not null,
  metric text,                -- orders | items | units | nso | inventory
  unit text,
  sort int not null default 0,
  active boolean not null default true
);

create table sop_values (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references sop_lines(id) on delete cascade,
  period date not null,                 -- month start (weekly rows also carry period_label)
  period_label text not null default '',  -- '' for monthly; 'Sep_WK_04' for weekly
  dimension text not null default '',   -- '' = total; else e.g. 'North' / 'South'
  projection numeric,
  revised_projection numeric,
  actual numeric,
  actual_source text check (actual_source in ('manual','snowflake','demo')),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (line_id, period, period_label, dimension)
);

create table sop_submissions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references sop_streams(id) on delete cascade,
  period date not null,                 -- the month being projected
  status text not null default 'pending' check (status in ('pending','submitted','late','not_required')),
  due_date date,
  submitted_at timestamptz,
  submitted_by uuid references users(id) on delete set null,
  note text,
  unique (stream_id, period)
);

create table sop_capacity (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  department text not null,
  warehouse text not null check (warehouse in ('North','South')),
  required numeric,
  available numeric,
  remarks text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (period, department, warehouse)
);

-- Generic KPI store for review metric cards (fed manually now, Snowflake later)
create table metrics (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  area text,
  unit text not null default 'num',
  direction text not null default 'higher_better' check (direction in ('lower_better','higher_better')),
  owner_id uuid references users(id) on delete set null,
  program_id uuid references programs(id) on delete set null,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create table metric_values (
  metric_id uuid not null references metrics(id) on delete cascade,
  period date not null,
  plan numeric,
  actual numeric,
  forecast numeric,
  commentary text,
  updated_at timestamptz not null default now(),
  primary key (metric_id, period)
);
`;
