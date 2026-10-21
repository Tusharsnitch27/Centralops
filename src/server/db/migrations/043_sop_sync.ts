// S&OP (40-49): log of Snowflake refresh runs (daily + manual).
export const sql = /* sql */ `
create table if not exists sop_sync_runs (
  id uuid primary key default gen_random_uuid(),
  feed text not null,
  trigger text not null default 'manual',     -- manual | schedule | cron
  from_date date,
  to_date date,
  status text not null default 'running' check (status in ('running','ok','failed')),
  rows_read int,
  rows_written int,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  actor_id uuid references users(id) on delete set null
);
create index if not exists sop_sync_runs_feed on sop_sync_runs(feed, started_at desc);
`;
