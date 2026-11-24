// B2B logistics store → zone (Malhar M, 24 Nov 2026).
//   lg_key(store): one store key for LR file, spine and rulebook names — retail_flow's normStoreKey (trim, collapse spaces, " - ", upper)
//     plus a glued city suffix dropped ("… -BENGALURU", "… - FO -THANE") and punctuation ignored. A spaced dash ("- RAIPUR") or digits
//     ("PHASE -1") are kept.
//   lg_store_zone: overrides keyed by lg_key — spine stores the spine leaves UNMAPPED (Malhar: Telangana / Hyderabad → SOUTH, Chhattisgarh
//     → WEST), LR names that differ from the spine, and city-only LR destinations (NSO / dedicated loads) by their city's state.
//     EXCLUDED = warehouse transfers, HQ and marketplace loads: kept out of zone maths.
//   lg_zone: overrides first, else the store's most common zone in the spine (lg_retail_month).
// ponytail: overrides are by store key; a new spine store in an unmapped state needs a row here (or the spine fixed upstream).
const Z: [string, string][] = [
  // spine UNMAPPED stores
  ["SNITCH - COFO - MAGNETO MALL", "WEST"], ["SNITCH - COFO - RAIPUR", "WEST"], ["SNITCH - COFO - BILASPUR", "WEST"],
  ["SNITCH - COFO - KARIMNAGAR", "SOUTH"], ["SNITCH - COFO - KOTHAPET", "SOUTH"], ["SNITCH - MFC - HYDERABAD", "SOUTH"],
  ["SNITCH - COFO - KUKATPALLY", "SOUTH"], ["SNITCH - COFO - GATEWAY MALL", "SOUTH"], ["SNITCH - COFO - NIZAMABAD", "SOUTH"],
  ["SNITCH - COFO - HIMAYAT NAGAR", "SOUTH"], ["SNITCH - COFO - SARATH CITY", "SOUTH"], ["SUVIDHA STORES - SONIPAT", "NORTH"],
  ["SNITCH - COCO - CENTRAL IKON", "NORTH"],
  // LR names that differ from the spine
  ["SNITCH - COCO - HINJEWADI", "WEST"], ["SNITCH - COCO - RAIPUR", "WEST"], ["SNITCH - COFO - CITY CENTER NASHIK", "WEST"],
  ["SNITCH - COCO - BHUMI WORLD", "WEST"], ["SNITCH - FOCO - VASUPUJYA", "WEST"], ["SNITCH - COCO - CHIKJALA", "SOUTH"],
  ["COFO - PMC KURLA", "WEST"], ["SNITCH- COCO-BANGALORE", "SOUTH"], ["FUTURE TRENDS -OSMANABAD", "WEST"], ["SNITCH-NEW DELHI TRRUU GLOBAL", "NORTH"],
  // city-only destinations, by state
  ["LUDHIANA", "NORTH"], ["GURGAON", "NORTH"], ["GURUGRAM", "NORTH"], ["DELHI", "NORTH"], ["JAIPUR", "NORTH"], ["ZIRAKPUR", "NORTH"], ["KARNAL NSO", "NORTH"],
  ["KOTA", "NORTH"], ["KAMALANAGAR", "NORTH"], ["NOIDA", "NORTH"], ["GT ROAD GHAZIABAD", "NORTH"], ["JANAKPURI", "NORTH"],
  ["SURAT", "WEST"], ["MUMBAI", "WEST"], ["THANE", "WEST"], ["RAIPUR", "WEST"], ["HYDERABAD", "SOUTH"], ["BANGALORE", "SOUTH"],
  // not stores
  ["SAPL-NORTH-TAURU", "EXCLUDED"], ["SALP-YLK-WH", "EXCLUDED"], ["SNITCH HQ", "EXCLUDED"], ["SNITCH - HO -BENGALURU", "EXCLUDED"], ["NOON ORDER MP", "EXCLUDED"],
];
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const sql = /* sql */ `
create or replace function lg_key(s text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(upper(trim(coalesce(s, ''))), '\\s+-[A-Z]+$', ''), '[^A-Z0-9]', '', 'g')
$$;
create table if not exists lg_store_zone (
  key text primary key,
  name text not null,
  zone text not null check (zone in ('NORTH','SOUTH','EAST','WEST','EXCLUDED')),
  source text not null default 'migration 094'
);
insert into lg_store_zone (key, name, zone) values
${Z.map(([n, z]) => `  (lg_key(${lit(n)}), ${lit(n)}, ${lit(z)})`).join(",\n")}
on conflict (key) do update set name = excluded.name, zone = excluded.zone;
create or replace view lg_zone as
  select key, zone from lg_store_zone
  union all
  select lg_key(store) as key, mode() within group (order by zone) as zone from lg_retail_month
   where zone <> 'UNMAPPED' and lg_key(store) not in (select key from lg_store_zone) group by 1;
`;
