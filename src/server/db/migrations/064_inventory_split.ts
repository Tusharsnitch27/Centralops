// Warehouse space used = good (INVENTORY) + bad + other (blocked, putaway pending, putback pending); kept apart for the review.
// `units` / `inventory` stay the total space used, so every utilisation figure counts all three.
export const sql = /* sql */ `
alter table sop_inventory_daily add column if not exists good_units numeric not null default 0;
alter table sop_inventory_daily add column if not exists bad_units numeric not null default 0;
alter table sop_inventory_daily add column if not exists other_units numeric not null default 0;
alter table sop_wh_capacity add column if not exists good_units numeric;
alter table sop_wh_capacity add column if not exists bad_units numeric;
alter table sop_wh_capacity add column if not exists other_units numeric;
`;
