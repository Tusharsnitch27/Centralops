// B2C courier cost by what the package holds (scripts/courier-category.mjs → CSV upload in AOP › Data › Logistics files; Malhar M, 24 Nov 2026).
// One row per month × channel × courier × group (Shoes, Perfume, Bags / trolley, Accessories / belts / sunglasses, Winterwear, Apparel only):
// forward shipments, pre-tax ₹ (all-in: RTO shares the forward AWB), charged kg. An upload replaces the months it carries.
export const sql = /* sql */ `
create table if not exists lg_b2c_cat (
  month date not null,
  channel text not null,
  courier text not null,
  grp text not null,
  ships int not null,
  cost numeric not null,
  kg numeric,
  source text not null,
  primary key (month, channel, courier, grp)
);
`;
// fn_category_month also carries factory issue quantity per inward category (issues_factory_sorted, pullCategories).
export const sqlIssues = /* sql */ `
alter table fn_category_month drop constraint if exists fn_category_month_metric_check;
alter table fn_category_month add constraint fn_category_month_metric_check check (metric in ('units','shipments','gate_put_h','asns','issue_qty'));
`;
