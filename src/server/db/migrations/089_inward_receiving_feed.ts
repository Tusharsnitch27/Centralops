// Inward receiving = quantity received on completed trading POs (uc_final_get_purchase_orders), Malhar M 23 Nov 2026.
export const sql = /* sql */ `
update wcm_ipp set feed = 'received' where version = 'ipp-updated-2026-11-21' and stream = 'Inward' and stage = 'Receiving';
`;
