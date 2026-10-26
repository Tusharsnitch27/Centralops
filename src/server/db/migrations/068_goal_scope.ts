// Goals and projects belong to a person / their team or function; admins and PMs see all. "Overall program" ones are visible to everyone.
export const sql = /* sql */ `
alter table goals add column if not exists scope text not null default 'private';
alter table projects add column if not exists scope text not null default 'private';
alter table goals drop constraint if exists goals_scope_check;
alter table goals add constraint goals_scope_check check (scope in ('private','overall'));
alter table projects drop constraint if exists projects_scope_check;
alter table projects add constraint projects_scope_check check (scope in ('private','overall'));
`;
