// Core schema. Text + CHECK constraints instead of enums so states can evolve without type migrations.
export const sql = /* sql */ `
create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique,
  email text unique,
  name text not null,
  title text,
  role text not null default 'owner' check (role in ('admin','pm','owner','viewer','leadership')),
  password_hash text,
  team_id uuid,
  avatar_color text,
  phone text,
  slack_id text,
  joined_at date not null default current_date,   -- nothing before this date is shown or can be back-filled
  onboarded_at timestamptz,                         -- set once the "what are you working on" capture is done/dismissed
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  function text,
  lead_id uuid references users(id) on delete set null,
  color text,
  created_at timestamptz not null default now()
);
alter table users add constraint users_team_fk foreign key (team_id) references teams(id) on delete set null;

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  description text,
  owner_id uuid references users(id) on delete set null,
  sponsor_id uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('planned','active','on_hold','completed','cancelled')),
  health text not null default 'on_track' check (health in ('on_track','at_risk','delayed')),
  start_date date,
  target_date date,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs(id) on delete set null,
  name text not null,
  code text unique,
  objective text,
  description text,
  owner_id uuid references users(id) on delete set null,
  sponsor_id uuid references users(id) on delete set null,
  status text not null default 'active' check (status in ('planned','active','on_hold','completed','cancelled')),
  health text not null default 'on_track' check (health in ('on_track','at_risk','delayed')),
  start_date date,
  target_date date,
  budget numeric,
  spent numeric,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table project_teams (
  project_id uuid not null references projects(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  primary key (project_id, team_id)
);
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text,
  primary key (project_id, user_id)
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  due_date date,
  baseline_date date,                -- original plan date; slip = due_date - baseline_date
  completed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','in_progress','done','missed')),
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  what_changed text,
  progress text,
  blockers text,
  decisions_required text,
  next_steps text,
  expected_completion date,
  percent_complete int,
  health text check (health in ('on_track','at_risk','delayed')),
  created_at timestamptz not null default now()
);

-- Recurring business reviews (Weekly S&OP, Monthly AOP review, …). Meetings of a series point here.
create table reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cadence text not null default 'weekly' check (cadence in ('daily','weekly','fortnightly','monthly','quarterly','adhoc')),
  description text,
  owner_id uuid references users(id) on delete set null,
  mom_owner_id uuid references users(id) on delete set null,   -- default MoM writer for meetings of this review
  program_id uuid references programs(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  module text check (module in ('aop','sop','project','program','general')),
  calendar_match text,   -- case-insensitive substring of calendar event titles that belong to this review
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  meet_url text,
  is_recurring boolean not null default false,
  series_key text,
  review_id uuid references reviews(id) on delete set null,
  program_id uuid references programs(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  organizer_id uuid references users(id) on delete set null,
  mom_owner_id uuid references users(id) on delete set null,   -- person responsible for writing the MoM
  agenda text,
  prep_notes text,
  source text not null default 'manual' check (source in ('calendar','manual')),
  calendar_event_id text,
  -- MoM workflow: pending → (owner writes) submitted → (PM reviews & distributes) distributed
  -- skipped / not_relevant are terminal and are never asked again
  mom_status text not null default 'pending' check (mom_status in ('pending','draft','submitted','distributed','skipped','not_relevant')),
  mom_due_at timestamptz,
  summary text,
  pm_feedback text,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  follow_up_date date,
  cancelled boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index meetings_calendar_event on meetings(calendar_event_id) where calendar_event_id is not null;
create index meetings_starts on meetings(starts_at);

create table meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  email text,
  name text,
  response text,
  is_optional boolean not null default false
);
create index meeting_attendees_meeting on meeting_attendees(meeting_id);

create table meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  kind text not null default 'mom' check (kind in ('mom','quick')),
  body text not null default '',
  discussion text,
  blockers text,
  ai_output jsonb,          -- structured extraction (summary, decisions, actions, risks, follow-ups)
  ai_engine text,           -- 'claude' | 'rules'
  processed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AI-suggested items from a MoM, waiting for PM review (accept / edit / ignore) before they become real objects.
create table meeting_suggestions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  note_id uuid references meeting_notes(id) on delete cascade,
  kind text not null check (kind in ('action','decision','risk','followup')),
  payload jsonb not null,   -- {title, owner_id?, owner_name?, team_id?, due_date?, priority?, project_id?, dependency?, ...}
  status text not null default 'pending' check (status in ('pending','accepted','ignored')),
  feedback text,
  created_entity_type text,
  created_entity_id uuid,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create sequence task_number_seq start 101;
create table tasks (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('task_number_seq'),
  title text not null,
  description text,
  owner_id uuid references users(id) on delete set null,
  owner_team_id uuid references teams(id) on delete set null,   -- a task can be allotted to a team (owner optional)
  requester_id uuid references users(id) on delete set null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','waiting','blocked','completed','cancelled')),
  health text not null default 'on_track' check (health in ('on_track','at_risk','delayed')),
  priority text not null default 'medium' check (priority in ('urgent','high','medium','low')),
  start_date date,
  due_date date,
  original_due_date date,
  completed_at timestamptz,
  acknowledged_at timestamptz,
  project_id uuid references projects(id) on delete set null,
  program_id uuid references programs(id) on delete set null,
  milestone_id uuid references milestones(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','meeting','aop','sop','project','ai','followup','integration','onboarding')),
  aop_item_id uuid,
  parent_id uuid references tasks(id) on delete cascade,
  waiting_on_id uuid references users(id) on delete set null,
  blocker text,
  next_step text,
  last_update_at timestamptz,
  last_update_note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_owner on tasks(owner_id) where status not in ('completed','cancelled');
create index tasks_due on tasks(due_date);
create index tasks_project on tasks(project_id);
create index tasks_meeting on tasks(meeting_id);

create table task_tags (
  task_id uuid not null references tasks(id) on delete cascade,
  tag text not null,
  primary key (task_id, tag)
);
create table task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_id)
);
create table task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  status text,
  created_at timestamptz not null default now()
);
-- The task journey: every state change, append-only.
create table task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  event text not null check (event in ('created','assigned','acknowledged','status_changed','blocked','unblocked','updated','due_changed','priority_changed','completed','reopened','cancelled','commented','followed_up','linked')),
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);
create index task_history_task on task_history(task_id, created_at);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  context text,
  reason text,
  impact text,
  status text not null default 'made' check (status in ('proposed','pending','made','revisited','superseded')),
  decided_on date,
  due_date date,               -- for pending decisions: when it must be taken
  meeting_id uuid references meetings(id) on delete set null,
  decision_maker_id uuid references users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  program_id uuid references programs(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table decision_tasks (
  decision_id uuid not null references decisions(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  primary key (decision_id, task_id)
);

create table risks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  project_id uuid references projects(id) on delete set null,
  program_id uuid references programs(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  owner_id uuid references users(id) on delete set null,
  probability int not null default 3 check (probability between 1 and 5),
  impact int not null default 3 check (impact between 1 and 5),
  score int generated always as (probability * impact) stored,
  mitigation text,
  trigger_signal text,
  target_date date,
  status text not null default 'open' check (status in ('open','mitigating','escalated','closed')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Polymorphic collaboration objects (entity_type: task, project, meeting, decision, risk, aop_item, sop_stream, program)
create table comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  author_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index comments_entity on comments(entity_type, entity_id);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  name text not null,
  url text,
  mime text,
  size_bytes int,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index attachments_entity on attachments(entity_type, entity_id);

-- Universal relation graph: meeting → project → task → decision → risk → AOP line …
create table entity_links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relation text not null default 'related',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, relation)
);
create index entity_links_to on entity_links(to_type, to_id);

-- Every request for an update (in-app now; email / Slack / WhatsApp later). One row per nudge.
create table followups (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  person_id uuid references users(id) on delete set null,
  requested_by uuid references users(id) on delete set null,
  channel text not null default 'in_app' check (channel in ('in_app','email','slack','whatsapp')),
  message text,
  status text not null default 'open' check (status in ('open','responded','closed','cancelled')),
  due_at timestamptz,
  responded_at timestamptz,
  response text,
  created_at timestamptz not null default now()
);
create index followups_entity on followups(entity_type, entity_id);
create index followups_person on followups(person_id, status);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  href text,
  actor_id uuid references users(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, read_at, created_at desc);

-- Inbox: unprocessed information that needs a decision. dedupe_key makes generators idempotent;
-- a dismissed/done item is never re-raised for the same key.
create table inbox_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,          -- mom_pending, mom_review, task_suggestion, owner_update, aop_submission, overdue, risk, decision, integration, sop_submission, onboarding
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  href text,
  priority int not null default 50,
  status text not null default 'open' check (status in ('open','done','snoozed','dismissed')),
  snoozed_until timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, dedupe_key)
);

-- Audit trail for every important change.
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,         -- created, updated, deleted, status_changed, …
  field text,
  from_value text,
  to_value text,
  summary text,
  created_at timestamptz not null default now()
);
create index activity_entity on activity_log(entity_type, entity_id, created_at desc);
create index activity_time on activity_log(created_at desc);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  entity_type text not null,     -- program, project, aop_section, aop_item, sop_stream, '*'
  entity_id uuid,                -- null = all of that type
  level text not null check (level in ('view','edit','manage')),
  created_at timestamptz not null default now()
);

create table saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  module text not null,          -- tasks, projects, aop, risks …
  name text not null,
  filters jsonb not null default '{}',
  pinned boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  prefs jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider text not null,        -- google_calendar, gmail, slack, whatsapp, snowflake, …
  status text not null default 'connected' check (status in ('connected','error','disconnected')),
  account_email text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,
  config jsonb not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references integrations(id) on delete cascade,
  external_id text not null,
  calendar_id text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  attendees jsonb,
  raw jsonb,
  meeting_id uuid references meetings(id) on delete set null,
  status text,
  synced_at timestamptz not null default now(),
  unique (integration_id, external_id)
);

-- AI proactive suggestions (Action Centre). Rules generate them; dismissals stick via dedupe_key.
create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  recommendation text,
  entity_type text,
  entity_id uuid,
  status text not null default 'open' check (status in ('open','accepted','dismissed')),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`;
