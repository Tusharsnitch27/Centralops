// Functions SLA (Malhar M, 25 Nov 2026): per receiving day × site × function, units judged against the function's SLA and units within it.
//   inwards      WAM_ASN_INWARD per ASN: gate entry → last putaway ≤ 24 h; units = FI_QTY (pieces)
//   b2c_returns  RETURN_2_INWARDING_DATA per packet: receiving day → processed (PROCESSED_DATE, else QC_TIMESTAMP) ≤ 2 days; units = packets
// Open work past its SLA is judged and missed; open work still inside it is not judged. B2C / B2B Retail come from wcm_sla_cell, B2B Returns
// from the Retail Return Tool; B2B Marketplace has no TAT.
export const sql = /* sql */ `
create table if not exists fn_sla_daily (
  day date not null,
  site text not null check (site in ('South','North')),
  fn text not null,
  judged numeric not null,
  within numeric not null,
  fetched_at timestamptz not null default now(),
  primary key (day, site, fn)
);
`;
