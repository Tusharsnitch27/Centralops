// S&OP (40-49): day-level plans (from the projection workbook's daily sheets) for day-by-day deviation alerts.
export const sql = /* sql */ `
create table if not exists sop_plan_daily (
  day date not null,
  view_key text not null,        -- review view: b2c | retail_fwd | …
  row_label text not null default '',
  south numeric not null default 0,
  north numeric not null default 0,
  source text not null default 'workbook',
  primary key (day, view_key, row_label)
);
`;
