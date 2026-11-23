// One IPP norm for the whole FY (Malhar, 23 Nov): the updated master sizes every month from 1 Apr 2026; the 20 Nov targets
// version is retired with the status the code already treats as not-in-force ('legacy'; readers use status = 'active').
export const sql = /* sql */ `
update wcm_ipp set effective_from = '2026-04-01' where version = 'ipp-updated-2026-11-21' and effective_from <> '2026-04-01';
update wcm_ipp set status = 'legacy' where version = 'ipp-targets-2026-11-20' and status <> 'legacy';
`;
