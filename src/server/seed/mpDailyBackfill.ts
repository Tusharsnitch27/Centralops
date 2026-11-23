import "server-only";
import type { RunQ } from "../db";
import rows from "../../db/seed/mp-daily-backfill.json";
import { guessFunc } from "../manpower/model";

/** Present heads 1 Apr – 28 Oct 2026 (attendance app dump + site workbooks; scripts/attendance-backfill.mjs). Days the API wrote win. */
export async function seedMpDailyBackfill(S: RunQ) {
  await S(`insert into mp_daily (day, site, func, heads) select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[])
           on conflict (day, site, func) do nothing`,
    [rows.map((r) => r.day), rows.map((r) => r.site), rows.map((r) => r.func), rows.map((r) => r.heads)]);
  await S(`insert into mp_site_map (site, warehouse) values ('NORTH','North'), ('WH1','South'), ('WH2','South') on conflict (site) do nothing`);
  const fs = [...new Set(rows.map((r) => r.func))];
  await S(`insert into mp_func_map (func, department) select * from unnest($1::text[], $2::text[]) on conflict (func) do nothing`, [fs, fs.map(guessFunc)]);
  return rows.length;
}
