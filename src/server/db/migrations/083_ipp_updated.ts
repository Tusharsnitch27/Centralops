// Updated IPP per site from the warehouse answer sheets (21 Nov 2026), effective 21 Nov 2026 as a new active version.
// Earlier versions stay for history: activeIpps takes, per day, only the latest version in effect at that site.
import { UPDATED_IPP, UPDATED_IPP_VERSION } from "../../wcm/ops";

const lit = (v: string | number | null | undefined) => (v == null ? "null" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const rows = (Object.entries(UPDATED_IPP) as [string, (string | number | null | undefined)[][]][]).flatMap(([site, us]) =>
  us.map(([stream, stage, home, ipp, feed], i) => `(${lit(site)},${lit(stream)},${lit(stage)},${lit(home)},'unit',${lit(ipp)},${lit(feed)},${lit(UPDATED_IPP_VERSION)},'active','2026-11-21',true,'Updated IPP — warehouse answer sheet 21 Nov 2026',${i})`));
export const sql = /* sql */ `
insert into wcm_ipp (site, stream, stage, home_fn, unit, ipp, feed, version, status, effective_from, verified, note, sort) values
${rows.join(",\n")}
on conflict (site, stream, stage, version) do nothing;
`;
