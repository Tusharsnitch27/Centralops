// Logistics working data (additive). Loaded by an in-app upload of the working files (billed, pre credit-note) — no billing
// data in git; every row keeps its sheet!row lineage. Store zones / retail volume from Snowflake.
//  lg_b2c_month      courier × month × shipment type (FWD / RTO / DTO): AWBs, billed ₹, quantity
//  lg_b2b_lr         one row per B2B LR (retail forward, dedicated lane, NSO, Q-com, ad-hoc, BLR own vehicle)
//  lg_retail_month   retail_journey_spine per month × warehouse × store × zone × order type: orders, AWBs, boxes, quantity
export const sql = /* sql */ `
create table if not exists lg_b2c_month (
  source text not null, month date not null, courier text not null, type text not null,
  awbs numeric, cost numeric, qty numeric, cell text not null,
  primary key (source, month, courier, type)
);
create table if not exists lg_b2b_lr (
  source text not null, cell text not null, month date not null, partner text not null, lr text, boxes numeric, qty numeric,
  facility text, site text not null, store text, kg numeric, freight numeric, type text, category text, remark text,
  primary key (source, cell)
);
create index if not exists lg_b2b_lr_month on lg_b2b_lr (month, site);
create table if not exists lg_retail_month (
  month date not null, site text not null, store text not null, zone text not null, order_type text not null,
  orders int not null, awbs int not null, boxes numeric, qty numeric, fetched_at timestamptz not null default now(),
  primary key (month, site, store, zone, order_type)
);
`;
