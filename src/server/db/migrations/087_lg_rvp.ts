// B2B store returns (RVP) and B2B marketplace shipments: the "B2B & MP _ rvp costing" working file's Summary tab, one row per
// partner × month (LRs, boxes, qty, ₹ pre-GST = logistic bill + ad-hoc bill, charged kg). Loaded by in-app upload; no billing data in git.
export const sql = /* sql */ `
create table if not exists lg_rvp_month (
  source text not null, month date not null, partner text not null, flow text not null,
  lrs numeric, boxes numeric, qty numeric, amount numeric, logistic numeric, adhoc numeric, kg numeric, cell text not null,
  primary key (source, month, partner)
);
`;
