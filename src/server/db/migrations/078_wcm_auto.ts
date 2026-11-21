// Deployment from attendance roles (additive).
//  mp_role_daily      present day-equivalents per day × facility × department (post-transfer) × role × shift, from the attendance
//                     availability API. mp_daily / mp_daily_shift are left exactly as they are.
//  wcm_deploy_day.source  'auto' = written by the attendance auto-split (rewritten on the next run);
//                         'lead' = saved by a site lead / PM (never touched by the auto run).
export const sql = /* sql */ `
create table if not exists mp_role_daily (
  day date not null,
  site text not null,                     -- attendance facility (WH1 / WH2 / NORTH), mapped via mp_site_map
  func text not null,                     -- attendance department after approved transfers, mapped via mp_func_map
  role text not null,                     -- attendance sub_department (Picker, Packer, … Unclassified, Not captured)
  shift text not null,                    -- Day / Night / Unspecified
  de numeric not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (day, site, func, role, shift)
);
alter table wcm_deploy_day add column if not exists source text not null default 'lead' check (source in ('auto','lead'));
`;
