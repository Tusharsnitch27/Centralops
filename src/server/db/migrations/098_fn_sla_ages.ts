// Returns SLA as run (Malhar M, 26 Nov 2026): of the units judged, how many were processed the same day (within_0) and by the next day (within_1),
// so the Cost Control SLA table's current row is the mix the team actually delivers. Null where not measured (Inwards).
export const sql = /* sql */ `
alter table fn_sla_daily add column if not exists within_0 numeric;
alter table fn_sla_daily add column if not exists within_1 numeric;
`;
