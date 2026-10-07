// S&OP module additions (version range 40-49).
export const sql = /* sql */ `
-- Which line metric represents a stream on cards / charts (orders | items | units | …). null = automatic (items > units > orders > first).
alter table sop_streams add column if not exists headline_metric text;

-- Per stream × month commentary from the POC / PM: context on a projection, reason for a variance, agreed corrective action.
create table if not exists sop_notes (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references sop_streams(id) on delete cascade,
  period date not null,
  kind text not null default 'commentary' check (kind in ('commentary','variance_reason','corrective_action')),
  body text not null,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sop_notes_stream on sop_notes(stream_id, period, created_at desc);
`;
