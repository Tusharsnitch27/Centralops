// Library (projects/people/reports range 50-59): SOP library, ops handbook, dashboards and tools — links to the source docs.
export const sql = /* sql */ `
create table if not exists library_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sop','handbook','dashboard','tool')),
  title text not null,
  url text,
  category text not null default '',
  function_name text not null default '',
  owner text not null default '',
  description text not null default '',
  status text not null default '',
  updated_on text not null default '',
  extra jsonb not null default '{}',             -- any other sheet columns, kept for display
  sort int not null default 0,
  pinned boolean not null default false,
  source text not null default 'manual',          -- manual | import | seed
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists library_items_kind_title_url on library_items (kind, lower(title), coalesce(url, ''));
create index if not exists library_items_kind on library_items (kind, sort);
`;
