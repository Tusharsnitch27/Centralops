// D-1 cost of doing business (additive).
//  wcm_mp_rate  salary master per site, effective-dated: monthly ₹ per head ÷ days_basis = ₹ per present day-equivalent;
//               ot_hourly prices approved OT hours. Seeded with the legacy Processing salary (₹21,983 / 26 days, both sites) and
//               flagged in the view until real rates are entered. Booked Cost Master figures replace the estimate once a month closes.
export const sql = /* sql */ `
create table if not exists wcm_mp_rate (
  site text not null check (site in ('South','North')),
  effective_from date not null,
  monthly_salary numeric not null check (monthly_salary > 0),
  days_basis int not null default 26 check (days_basis between 20 and 31),
  ot_hourly numeric,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (site, effective_from)
);
insert into wcm_mp_rate (site, effective_from, monthly_salary, days_basis, note)
values ('South','2026-04-01',21983,26,'legacy Processing salary (default) — replace with the salary master'),
       ('North','2026-04-01',21983,26,'legacy Processing salary (default) — replace with the salary master')
on conflict do nothing;
`;
