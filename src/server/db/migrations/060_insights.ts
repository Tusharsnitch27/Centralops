// People / reports / insights / settings (60-69).
// ai_suggestions gains a deep link, a severity and an action payload (owner to act with, task title, task ids …).
export const sql = /* sql */ `
alter table ai_suggestions add column if not exists href text;
alter table ai_suggestions add column if not exists severity text not null default 'warning';
alter table ai_suggestions add column if not exists payload jsonb not null default '{}';
alter table ai_suggestions add column if not exists updated_at timestamptz not null default now();
alter table ai_suggestions add column if not exists resolved_at timestamptz;
create index if not exists ai_suggestions_user_open on ai_suggestions(user_id, status);
`;
