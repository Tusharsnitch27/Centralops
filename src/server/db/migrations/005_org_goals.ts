// Core (1-9): org chart (who reports to whom), task co-assignees, person-level blockers, goals.
export const sql = /* sql */ `
alter table users add column if not exists reports_to uuid references users(id) on delete set null;
alter table users add column if not exists org_level text not null default 'member'
  check (org_level in ('manager','program_manager','dept_manager','lead','member'));
alter table users add column if not exists org_function text;
create index if not exists users_reports_to on users(reports_to);

-- more people working on a task besides its owner
create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user on task_assignees(user_id);

-- a blocker raised on the person who has to clear it
create table if not exists task_blockers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  body text not null,
  on_user_id uuid references users(id) on delete set null,
  on_label text,                                  -- someone outside the directory
  raised_by uuid references users(id) on delete set null,
  status text not null default 'open' check (status in ('open','cleared')),
  cleared_by uuid references users(id) on delete set null,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists task_blockers_task on task_blockers(task_id, status);
create index if not exists task_blockers_on on task_blockers(on_user_id, status);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  owner_id uuid references users(id) on delete set null,
  target_date date,
  status text not null default 'on_track' check (status in ('on_track','at_risk','off_track','done','dropped')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table tasks add column if not exists goal_id uuid references goals(id) on delete set null;
alter table projects add column if not exists goal_id uuid references goals(id) on delete set null;
create index if not exists tasks_goal on tasks(goal_id);
create index if not exists projects_goal on projects(goal_id);
`;
