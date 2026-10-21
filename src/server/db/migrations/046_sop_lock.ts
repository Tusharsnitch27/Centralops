// S&OP (40-49): projections lock 24 h after the first submission (admins can still change them).
export const sql = /* sql */ `
alter table sop_submissions add column if not exists first_submitted_at timestamptz;
update sop_submissions set first_submitted_at = submitted_at where first_submitted_at is null and submitted_at is not null;
`;
