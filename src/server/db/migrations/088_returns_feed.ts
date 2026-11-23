// B2C returns inwarding (PG_INWARDING_DATA: one row per returned packet, channel B2C = Shopify, MP-* = marketplace) and inward
// unloading (putaway units ÷ 30 per box, Malhar M 23 Nov 2026) become stage feeds on the updated IPP set: Receiving = 'received',
// Processing (& QC) = 'qc', Unloader = 'unloaded' in boxes (its IPP of 100 / 200 a day is boxes). Sources: see wcm/feed.ts.
export const sql = /* sql */ `
update wcm_ipp set feed = 'received' where version = 'ipp-updated-2026-11-21' and stream like 'B2C Returns%' and stage = 'Receiving';
update wcm_ipp set feed = 'qc' where version = 'ipp-updated-2026-11-21' and stream like 'B2C Returns%' and stage in ('Processing', 'Processing & QC');
update wcm_ipp set feed = 'unloaded', unit = 'box' where version = 'ipp-updated-2026-11-21' and stream = 'Inward' and stage = 'Unloader';
`;
