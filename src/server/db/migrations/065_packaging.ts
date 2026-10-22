// AOP · Packaging: package rates with effective dates, daily package counts from Snowflake, and month-end snapshots (with year).
export const sql = /* sql */ `
create table if not exists pkg_rates (
  package_type text not null,                 -- upper-cased, as in shippingpackagetype
  effective_from date not null,               -- the rate applies from this day until the next row for the same type
  rate numeric not null,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (package_type, effective_from)
);
create table if not exists pkg_usage_daily (
  day date not null,
  marketplace text not null,
  package_type text not null,
  packages numeric not null default 0,
  primary key (day, marketplace, package_type)
);
-- frozen month: one row per marketplace × package type, with the rate(s) used and the amount
create table if not exists pkg_monthly (
  period date not null,                       -- month start (year included)
  marketplace text not null,
  package_type text not null,
  aop_line text not null,                     -- Shopify | Marketplace | B2B MP | Store
  qty numeric not null default 0,
  rate numeric,
  amount numeric not null default 0,
  source text not null default 'snowflake' check (source in ('file','snowflake')),
  primary key (period, marketplace, package_type)
);
create table if not exists pkg_months (
  period date primary key,
  status text not null default 'open' check (status in ('open','closed')),
  source text not null default 'snowflake',
  closed_at timestamptz,
  aop_written_at timestamptz
);
`;
