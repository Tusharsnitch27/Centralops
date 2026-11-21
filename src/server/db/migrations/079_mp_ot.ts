// OT hours from the attendance app's /api/v1/integrations/ot (additive). Grain matches mp_role_daily so booked OT can later be
// split by OT hours per function. Pending hours are kept apart (they may still be rejected).
export const sql = /* sql */ `
create table if not exists mp_ot_daily (
  day date not null,
  site text not null,                     -- attendance facility (WH1 / WH2 / NORTH), mapped via mp_site_map
  func text not null,                     -- department worked that day (transfers applied), mapped via mp_func_map
  role text not null,
  shift text not null,                    -- Day / Night / Unspecified
  approved_hours numeric not null default 0,
  pending_hours numeric not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (day, site, func, role, shift)
);
`;
