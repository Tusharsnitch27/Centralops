// AOP input deadlines (per measure, with per-function overrides) + WhatsApp reminder log.
export const sql = /* sql */ `
alter table aop_cycles add column if not exists deadline_config jsonb not null default
  '{"plan":{"monthOffset":0,"day":1},"forecast":{"monthOffset":0,"day":30},"actual":{"monthOffset":1,"day":7},"overrides":{"Logistics":{"actual":{"monthOffset":1,"day":12}}},"reminders":{"enabled":true,"dueDayNudge":true,"everyDays":2,"maxPerItem":5,"escalateAfterDays":3}}';

alter table aop_submissions drop constraint if exists aop_submissions_kind_check;
alter table aop_submissions add constraint aop_submissions_kind_check check (kind in ('budget','projections','actuals'));

alter table users add column if not exists whatsapp_opt_in boolean not null default true;

-- Every outbound message (WhatsApp now; email/Slack later). dedupe_key stops double sends.
create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'whatsapp',
  provider text,
  to_user_id uuid references users(id) on delete set null,
  to_phone text,
  template text,
  body text,
  status text not null default 'queued' check (status in ('queued','sent','dry_run','failed','skipped')),
  provider_message_id text,
  error text,
  entity_type text,
  entity_id uuid,
  dedupe_key text unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists message_log_time on message_log(created_at desc);
`;
