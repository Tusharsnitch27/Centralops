// AOP › Functions: category split per function and the justification inputs (Malhar M, 24 Nov 2026).
//   fn_category_month: per month × site × stream × category, one row per metric — units (dispatched items / putaway units),
//     shipments (distinct packages holding the category; a mixed package counts under each of its categories; category '(all)' =
//     the stream's distinct packages), gate_put_h (inward: median hours gate entry → last putaway over the ASNs) and asns.
//   fn_adhoc / fn_note: rows Malhar returns in the justification workbook, loaded by a versioned seed. fn = FnKey.
export const sql = /* sql */ `
create table if not exists fn_category_month (
  month date not null,
  site text not null check (site in ('South','North')),
  stream text not null,
  category text not null,
  metric text not null check (metric in ('units','shipments','gate_put_h','asns')),
  value numeric not null,
  fetched_at timestamptz not null default now(),
  primary key (month, site, stream, category, metric)
);
create table if not exists fn_adhoc (
  id serial primary key,
  site text not null check (site in ('South','North')),
  month date not null,
  fn text not null,
  task text not null,
  dates text,
  days numeric,
  qty numeric,
  heads numeric,
  man_days numeric not null,
  source_dept text,
  note text,
  source text not null
);
create index if not exists fn_adhoc_fn on fn_adhoc (fn, month);
create table if not exists fn_note (
  id serial primary key,
  site text not null check (site in ('South','North')),
  month date not null,
  fn text not null,
  note text not null,
  source text not null
);
create index if not exists fn_note_fn on fn_note (fn, month);
`;
