// Core (1-9): who sees the full S&OP and Weekly-update overview (everyone else sees only their own part).
export const sql = /* sql */ `
alter table users add column if not exists full_overview boolean not null default false;
`;
