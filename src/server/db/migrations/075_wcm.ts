// Warehouse Cost Master (additive; nothing existing is changed or reinterpreted — aop_cost_alloc stays logistics-only).
//  wcm_snapshot     one dated extract of the source workbook (file hash + the sheet's own subtotal / snapshot controls)
//  wcm_source_line  every terminal Budget / Provision / Actuals cell: period × basis × site × family × cost head, with its cell.
//                   amount null = missing input; 0 = booked zero. A newer snapshot adds rows; older ones stay queryable.
//  wcm_rule         effective-dated allocation rule for one cost head (draft → approved / rejected; approved → reversed / superseded).
//                   Slices are computed from source lines + approved rules on read, so a result can never drift from its rules.
export const sql = /* sql */ `
create table if not exists wcm_snapshot (
  id text primary key,                      -- e.g. costmaster-2026-11-20
  source text not null,
  file_name text not null,
  sha256 text not null,
  taken date not null,                      -- the day the workbook was exported
  controls jsonb not null default '[]',
  workbook jsonb not null default '[]',     -- workbook-computed figures observed that day (Storage & Handling tab)
  loaded_at timestamptz not null default now()
);
create table if not exists wcm_source_line (
  id uuid primary key default gen_random_uuid(),
  snapshot_id text not null references wcm_snapshot(id) on delete cascade,
  period date not null,
  basis text not null check (basis in ('budget','provision','actual')),
  site text not null check (site in ('South','North','Both')),
  family text not null check (family in ('warehousing','manpower','ot','packaging')),
  head text not null,
  channel text,                             -- only when the source line itself names it
  amount numeric(16,2),                     -- signed; null = missing input
  cell text not null,                       -- sheet!A1 lineage
  note text,
  unique (snapshot_id, period, basis, site, family, head)
);
create index if not exists wcm_source_line_period on wcm_source_line (snapshot_id, period);
create table if not exists wcm_rule (
  id uuid primary key default gen_random_uuid(),
  family text not null check (family in ('warehousing','manpower','ot','packaging')),
  head text not null,
  site text not null check (site in ('South','North','Both','*')),
  effective_from date not null,
  effective_to date,                        -- exclusive; null = open-ended
  slices jsonb not null,                    -- [{ fn, channel, shared, share }]
  driver text,                              -- numerator / denominator or coding evidence, as stated by the drafter
  reason text not null,
  evidence text,
  status text not null default 'draft' check (status in ('draft','approved','rejected','reversed','superseded')),
  replaces uuid references wcm_rule(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists wcm_rule_key on wcm_rule (family, head, status);
`;
