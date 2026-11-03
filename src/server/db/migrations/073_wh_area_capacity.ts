// Warehouse capacity by area, set from a month onwards (S&OP › Monthly review › Warehouse utilisation › capacity bar):
//  main area   = every category except the ones below
//  pre-pack area = pre-packs (a set of any category, stored as packs) + perfumes, shoes, bags, trolleys
export const sql = /* sql */ `
create table if not exists sop_wh_capacity_settings (
  warehouse text not null check (warehouse in ('South', 'North')),
  effective_from date not null,
  capacity numeric not null,
  special_capacity numeric,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (warehouse, effective_from)
);
insert into sop_wh_capacity_settings (warehouse, effective_from, capacity) values ('South', '2026-04-01', 1600000), ('North', '2026-04-01', 1200000)
  on conflict do nothing;
alter table sop_wh_capacity add column if not exists special_capacity numeric;
alter table sop_wh_capacity add column if not exists special_units numeric;  -- perfumes / shoes / bags / trolleys (not pre-pack), all stock columns
alter table sop_wh_capacity add column if not exists prepack_packs numeric;
alter table sop_inventory_daily add column if not exists special_units numeric not null default 0;
`;
