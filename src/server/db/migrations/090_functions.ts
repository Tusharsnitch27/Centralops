// AOP Functions view feeds: store orders (DISTRIBUTION_ANALYTICS), handover rulebook (all uploads), WAM inward + issues per day/site.
// B2B Retail / Marketplace Bagging, Encoding/Stickering and Dispatch have no feed: their IPP is in boxes, as the Unloader's (088).
export const sql = /* sql */ `
create table if not exists fn_retail_order (
  order_name text primary key, order_date date, site text, store text, city text, quantity numeric, packages numeric,
  order_type text, placement_sla text, fetched_at timestamptz not null default now()
);
create index if not exists fn_retail_order_date on fn_retail_order (order_date);
create table if not exists fn_rulebook (
  upload_date date not null, store text not null, site text not null, fresh_qty numeric, rpl_qty numeric,
  fresh_handover_day text, rpl_handover_day text, fresh_tat text, rpl_tat text, zone text,
  primary key (upload_date, store, site)
);
create table if not exists fn_inward_daily (
  day date not null, site text not null, received numeric, boxes numeric, issues int, sku_lines int, source text,
  primary key (day, site)
);
update wcm_ipp set unit = 'box' where version = 'ipp-updated-2026-11-21' and stream in ('B2B Retail', 'B2B Marketplace')
  and stage in ('Bagging', 'Encoding/Stickering', 'Dispatch');
`;
