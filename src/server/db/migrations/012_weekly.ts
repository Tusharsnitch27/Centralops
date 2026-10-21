// Weekly updates (tasks/work range 10-19). Every Monday by 12:00 each section owner fills their part;
// the PM compiles, writes/approves the executive summary and sends it to leadership.
export const sql = /* sql */ `
create table if not exists weekly_sections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  group_name text not null,
  sort int not null default 0,
  owner_ids uuid[] not null default '{}',
  owner_labels text[] not null default '{}',     -- owners outside the directory
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_of date not null unique,                   -- the Monday it goes out
  title text not null,
  status text not null default 'collecting' check (status in ('collecting','review','approved','sent')),
  exec_summary text not null default '',
  exec_engine text,                               -- 'claude' | 'rules' | 'manual'
  pm_notes text not null default '',
  approved_by uuid references users(id),
  approved_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references users(id),
  sent_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weekly_entries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references weekly_reports(id) on delete cascade,
  section_id uuid not null references weekly_sections(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','draft','submitted')),
  metrics jsonb not null default '[]',            -- [{label, value, target}]
  metrics_note text not null default '',
  updates text not null default '',
  ahead text not null default '',
  blockers text not null default '',
  tables jsonb not null default '[]',             -- [{title, columns: [], rows: [[]]}]
  pm_comment text not null default '',
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  submitted_by uuid references users(id),
  submitted_at timestamptz,
  unique (report_id, section_id)
);

create table if not exists weekly_images (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references weekly_entries(id) on delete cascade,
  mime text not null,
  data bytea not null,
  caption text not null default '',
  sort int not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists weekly_images_entry on weekly_images(entry_id);
`;
