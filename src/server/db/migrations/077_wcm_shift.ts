// Shift-level planning + room for the rest of the cost base (additive).
//  mp_daily_shift   attendance day-equivalents per day × facility × function × shift (Day / Night). mp_daily (shift-summed, used by
//                   S&OP productivity) is left exactly as it is; this table sits beside it.
//  wcm_deploy*      pools become site × day × home function × shift ('All' = no shift split captured for that day).
//  wcm_source_line / wcm_rule families widened so logistics, SaaS and other cost lines can be loaded as source lines later
//                   (nothing loads them yet; warehouse views keep reading only warehouse families).
export const sql = /* sql */ `
create table if not exists mp_daily_shift (
  day date not null,
  site text not null,
  func text not null,
  shift text not null,
  heads numeric not null default 0,       -- present day-equivalents (half day = 0.5)
  fetched_at timestamptz not null default now(),
  primary key (day, site, func, shift)
);
alter table wcm_deploy drop constraint if exists wcm_deploy_day_site_home_fn_fkey;
alter table wcm_deploy_day add column if not exists shift text not null default 'All';
alter table wcm_deploy add column if not exists shift text not null default 'All';
alter table wcm_deploy_history add column if not exists shift text not null default 'All';
alter table wcm_deploy drop constraint if exists wcm_deploy_pkey;
alter table wcm_deploy_day drop constraint if exists wcm_deploy_day_pkey;
alter table wcm_deploy_day add primary key (day, site, home_fn, shift);
alter table wcm_deploy add primary key (day, site, home_fn, shift, target);
alter table wcm_deploy add constraint wcm_deploy_pool_fkey foreign key (day, site, home_fn, shift) references wcm_deploy_day (day, site, home_fn, shift) on delete cascade;

alter table wcm_source_line drop constraint if exists wcm_source_line_family_check;
alter table wcm_source_line add constraint wcm_source_line_family_check check (family in ('warehousing','manpower','ot','packaging','logistics','saas','other'));
alter table wcm_rule drop constraint if exists wcm_rule_family_check;
alter table wcm_rule add constraint wcm_rule_family_check check (family in ('warehousing','manpower','ot','packaging','logistics','saas','other'));
alter table wcm_source_line add column if not exists vendor text;   -- logistics / SaaS vendor as named in the source
`;
