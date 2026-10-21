// Tasks (10-19). A task's point of contact can be anyone — a vendor, someone outside the directory —
// so it's free text alongside the owner (who stays a user).
export const sql = /* sql */ `
alter table tasks add column if not exists poc_name text;
`;
