// Programs (task-first): one ask sent to many people — each person gets their own task, the PM tracks who is done and sends reminders.
export const sql = /* sql */ `
create table if not exists task_programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  due_date date not null,
  goal_id uuid references goals(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_reminded_at timestamptz
);
alter table tasks add column if not exists task_program_id uuid references task_programs(id) on delete set null;
create index if not exists tasks_task_program on tasks(task_program_id);
alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check check (source in ('manual','meeting','aop','sop','project','ai','followup','integration','onboarding','program'));
`;
