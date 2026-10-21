// Meetings: AI pre-meeting brief (last meeting's open actions, attendees' overdue work and blockers, what to decide), cached per meeting.
export const sql = /* sql */ `
alter table meetings add column if not exists ai_brief text;
alter table meetings add column if not exists ai_brief_engine text;
alter table meetings add column if not exists ai_brief_at timestamptz;
`;
