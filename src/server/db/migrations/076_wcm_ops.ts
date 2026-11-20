// Warehouse Cost Master — daily operations (additive).
//  wcm_ipp             effective-dated IPP master per site × stream × stage (version + status; legacy norms kept for history)
//  wcm_stage_output    deduplicated daily stage completions from Snowflake (day × site × stream × event, native unit)
//  wcm_site_lead       users who may plan deployment for a site (server-enforced; admins / PMs may plan every site)
//  wcm_deploy_day      one pool = site × day × attendance home function; revision guards concurrent edits
//  wcm_deploy          the pool's confirmed split: stage targets and reason-coded idle, in day-equivalents (DE)
//  wcm_deploy_history  every saved revision of a pool (before / after), for audit and corrections
export const sql = /* sql */ `
create table if not exists wcm_ipp (
  site text not null check (site in ('South','North')),
  stream text not null,
  stage text not null,
  home_fn text,                             -- attendance function the stage's people normally sit in (null = any)
  unit text not null,                       -- native output unit as stated by the source
  ipp numeric,                              -- output per day-equivalent; null = no IPP (e.g. storage capacity)
  feed text,                                -- wcm_stage_output event that measures this stage; null = no source yet
  version text not null,
  status text not null check (status in ('active','legacy','draft')),
  effective_from date not null,
  verified boolean not null default false,  -- unit, workload scope, shift length and calendar confirmed with Ops
  note text,
  sort int not null default 0,
  primary key (site, stream, stage, version)
);
create table if not exists wcm_stage_output (
  day date not null,                        -- IST calendar day of the event
  site text not null check (site in ('South','North')),
  stream text not null,
  event text not null,                      -- picked | packed | manifested | dispatched | putaway | audit_move
  unit text not null,
  qty numeric not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (day, site, stream, event)
);
create table if not exists wcm_site_lead (
  user_id uuid not null references users(id) on delete cascade,
  site text not null check (site in ('South','North')),
  primary key (user_id, site)
);
create table if not exists wcm_deploy_day (
  day date not null,
  site text not null check (site in ('South','North')),
  home_fn text not null,
  available_de numeric not null,            -- attendance day-equivalents when last saved
  revision int not null default 0,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (day, site, home_fn)
);
create table if not exists wcm_deploy (
  day date not null,
  site text not null,
  home_fn text not null,
  target text not null,                     -- 'stage:<stream>|<stage>' or 'idle:<reason code>'
  de numeric not null check (de > 0),
  reason text,
  primary key (day, site, home_fn, target),
  foreign key (day, site, home_fn) references wcm_deploy_day (day, site, home_fn) on delete cascade
);
create table if not exists wcm_deploy_history (
  id uuid primary key default gen_random_uuid(),
  day date not null, site text not null, home_fn text not null, revision int not null,
  before jsonb, after jsonb not null,
  actor_id uuid references users(id) on delete set null,
  at timestamptz not null default now()
);
`;
