// Pre-pack ROI (Malhar M, 25 Nov 2026), month × site × kind: inward_pp / inward_solid = WAM ASNs with / without pre-packs (median gate entry →
// last putaway hours, pieces); retail_pp = pre-pack SKUs (PP<N>-…) dispatched to stores (pieces, packs). Replaced in full by pullPrepack.
export const sql = /* sql */ `
create table if not exists fn_prepack_monthly (
  month date not null,
  site text not null check (site in ('South','North')),
  kind text not null,
  hours numeric,
  pieces numeric,
  packs numeric,
  primary key (month, site, kind)
);
`;
