// Inventory by category for storage cost per item and holding cost by category / bin (Malhar M, 22 Nov 2026).
//   wcm_inv_cat: monthly average on-hand units per site × category (snitch_final_inventory_wh2 INVENTORY, day-on-day ÷ days).
//   wcm_bin_cat: bins in use per site × category from the live shelf snapshot (uc_new_get_shelfwise_inventory, good inventory,
//                NON_TRADING shelf excluded); a shared bin is split by units. Units ÷ bins = the category's units per bin.
export const sql = /* sql */ `
create table if not exists wcm_inv_cat (
  month date not null,
  site text not null check (site in ('South','North')),
  category text not null,
  avg_units numeric not null,
  days int not null,
  fetched_at timestamptz not null default now(),
  primary key (month, site, category)
);
create table if not exists wcm_bin_cat (
  site text not null check (site in ('South','North')),
  category text not null,
  units numeric not null,
  bins numeric not null,
  taken_at timestamptz not null,
  primary key (site, category)
);
`;
