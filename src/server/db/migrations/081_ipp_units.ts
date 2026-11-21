// The revised IPP targets are all in units (pieces) per day-equivalent — confirmed by Malhar M, 21 Nov 2026. Existing rows
// were seeded with "unverified (item or box?)" units and verified = false; the seed never overwrites, so correct them here.
export const sql = /* sql */ `
update wcm_ipp set unit = 'unit', verified = true, note = 'IPP - Targets sheet; units per day-equivalent (confirmed 21 Nov 2026)'
 where version = 'ipp-targets-2026-11-20' and ipp is not null;
`;
