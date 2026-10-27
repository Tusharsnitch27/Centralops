// Weekly updates: AI follow-through check (last week's next steps / weak metrics / blockers vs this week), kept per report.
export const sql = /* sql */ `
alter table weekly_reports add column if not exists followthrough jsonb;
alter table weekly_reports add column if not exists followthrough_engine text;
alter table weekly_reports add column if not exists followthrough_at timestamptz;
`;
