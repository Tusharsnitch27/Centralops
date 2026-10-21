// Core (1-9): lock an account for a while after repeated wrong passwords (same rule as Long Tail).
export const sql = /* sql */ `
alter table users add column if not exists failed_logins int not null default 0;
alter table users add column if not exists locked_until timestamptz;
`;
