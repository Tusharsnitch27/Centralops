// Tasks (10-19): reference links on a task — [{url, label}], shown as hyperlinks.
export const sql = /* sql */ `
alter table tasks add column if not exists links jsonb not null default '[]';
`;
