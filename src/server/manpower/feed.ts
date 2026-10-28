import "server-only";
import { one, q } from "../db";
import { SOP_CUTOVER } from "../sop/sync";

/**
 * Pulls daily manpower from the warehouse manpower tool's read-only API and keeps only heads per day × site × function.
 * The API shape isn't fixed here: the reader accepts a JSON array (or { data | rows | items | records | results: [...] }) of either
 *  - aggregated rows: date + site + function + a headcount field, or
 *  - one row per person per day: date + site + function (+ employee id) — counted, never stored per person.
 * Rows marked absent / leave / week-off are skipped, so only people on the floor count.
 */
const KEYS = {
  day: ["date", "day", "work_date", "attendance_date", "shift_date", "dt", "for_date"],
  site: ["warehouse", "wh", "site", "facility", "location", "warehouse_name", "site_name", "facility_name", "branch", "region"],
  func: ["function", "department", "dept", "process", "function_name", "department_name", "team", "sub_department", "activity"],
  heads: ["headcount", "head_count", "heads", "manpower", "present", "present_count", "count", "hc", "total", "man_days", "mandays", "total_manpower"],
  person: ["employee_id", "emp_id", "emp_code", "employee_code", "employee_no", "staff_id", "user_id"],
  status: ["status", "attendance_status", "attendance", "present_status"],
};
const ABSENT = /^(a|ab|absent|leave|l|wo|week ?off|off|holiday|h|lwp|cl|sl|el|na)$/i;

export function manpowerUrl() { return process.env.MANPOWER_API_URL?.trim().replace(/^["']|["']$/g, "") || null; }
const apiKey = () => process.env.MANPOWER_API_KEY?.trim().replace(/^["']|["']$/g, "") || null;
export const manpowerConfigured = () => !!manpowerUrl();

const pick = (row: Record<string, unknown>, names: string[]) => {
  for (const n of names) if (n in row && row[n] != null && row[n] !== "") return row[n];
  return undefined;
};
const lower = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/[\s-]+/g, "_"), v]));
function toDay(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // dd/mm/yyyy (Indian format)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

export interface MpRow { day: string; site: string; func: string; heads: number }

export function parseManpower(body: unknown): { rows: MpRow[]; shape: string; skipped: number } {
  const arr = Array.isArray(body) ? body
    : body && typeof body === "object" ? (["data", "rows", "items", "records", "results", "manpower"].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) : undefined;
  if (!arr) throw new Error("The manpower API didn't return a list of rows (expected an array, or { data: [...] })");
  if (!arr.length) return { rows: [], shape: "empty", skipped: 0 };
  const sample = lower(arr[0] as Record<string, unknown>);
  const has = (names: string[]) => names.some((n) => n in sample);
  if (!has(KEYS.day)) throw new Error(`No date field in the manpower rows (fields: ${Object.keys(sample).join(", ")})`);
  if (!has(KEYS.func)) throw new Error(`No function / department field in the manpower rows (fields: ${Object.keys(sample).join(", ")})`);
  const aggregated = has(KEYS.heads);
  const agg = new Map<string, { row: MpRow; people: Set<string> }>();
  let skipped = 0, i = 0;
  for (const raw of arr) {
    i++;
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const r = lower(raw as Record<string, unknown>);
    const day = toDay(pick(r, KEYS.day));
    const func = String(pick(r, KEYS.func) ?? "").trim();
    const site = String(pick(r, KEYS.site) ?? "All").trim() || "All";
    if (!day || !func) { skipped++; continue; }
    const st = pick(r, KEYS.status);
    if (st != null && ABSENT.test(String(st).trim())) { skipped++; continue; }
    const k = `${day}|${site}|${func}`;
    const cur = agg.get(k) ?? { row: { day, site, func, heads: 0 }, people: new Set<string>() };
    if (aggregated) {
      const n = Number(String(pick(r, KEYS.heads) ?? "0").replace(/,/g, ""));
      if (!Number.isFinite(n)) { skipped++; continue; }
      cur.row.heads += n;
    } else cur.people.add(String(pick(r, KEYS.person) ?? `row${i}`));
    agg.set(k, cur);
  }
  const rows = [...agg.values()].map((x) => ({ ...x.row, heads: aggregated ? x.row.heads : x.people.size }));
  return { rows, shape: aggregated ? "headcount rows" : "per-person rows (counted)", skipped };
}

function withRange(url: string, from: string, to: string) {
  if (url.includes("{from}") || url.includes("{to}")) return url.replace("{from}", from).replace("{to}", to);
  const u = new URL(url);
  if (!u.searchParams.has("from")) u.searchParams.set("from", from);
  if (!u.searchParams.has("to")) u.searchParams.set("to", to);
  return u.toString();
}

const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const minus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/** First pull goes back to the S&OP cutover; after that the last 10 days are re-read each morning (late corrections land). */
export async function pullManpower(trigger: "manual" | "schedule" = "manual", actorId: string | null = null, fromOverride?: string) {
  const url = manpowerUrl();
  if (!url) throw new Error("MANPOWER_API_URL isn't set on the server");
  const to = istToday();
  const any = await one<{ n: number }>(`select count(*)::int as n from mp_daily`);
  const from = fromOverride ?? (any?.n ? minus(to, 10) : SOP_CUTOVER);
  const [run] = await q<{ id: string }>(`insert into mp_sync_runs (trigger, from_date, to_date, actor_id) values ($1,$2,$3,$4) returning id`, [trigger, from, to, actorId]);
  try {
    const key = apiKey();
    const res = await fetch(withRange(url, from, to), {
      headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}`, "x-api-key": key } : {}) },
      signal: AbortSignal.timeout(60_000), cache: "no-store",
    });
    if (!res.ok) throw new Error(`Manpower API answered ${res.status} ${res.statusText}${res.status === 401 || res.status === 403 ? " — check MANPOWER_API_KEY" : ""}`);
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Error(`Manpower API didn't return JSON (starts with: ${text.slice(0, 80)})`); }
    const { rows, shape, skipped } = parseManpower(body);
    const inRange = rows.filter((r) => r.day >= from && r.day <= to);
    if (inRange.length) {
      // replace only the days the API returned, so a partial answer never wipes other days
      const days = [...new Set(inRange.map((r) => r.day))];
      await q(`delete from mp_daily where day = any($1::date[])`, [days]);
      for (let i = 0; i < inRange.length; i += 500) {
        const c = inRange.slice(i, i + 500);
        await q(`insert into mp_daily (day, site, func, heads) select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[])
                 on conflict (day, site, func) do update set heads = excluded.heads, fetched_at = now()`,
          [c.map((x) => x.day), c.map((x) => x.site), c.map((x) => x.func), c.map((x) => x.heads)]);
      }
      // new names show up unmapped until someone maps them
      await q(`insert into mp_site_map (site, warehouse) select distinct s, case when s ~* 'north|tauru|ggn|gurgaon|delhi|ncr' then 'North' when s ~* 'south|blr|bangalore|bengaluru|wh1|wh2|sapl-wh' then 'South' else 'ignore' end
               from unnest($1::text[]) s on conflict (site) do nothing`, [[...new Set(inRange.map((r) => r.site))]]);
      await q(`insert into mp_func_map (func, department) select distinct f, null from unnest($1::text[]) f on conflict (func) do nothing`, [[...new Set(inRange.map((r) => r.func))]]);
    }
    const note = `${shape} · ${inRange.length} day × site × function rows${skipped ? ` · ${skipped} skipped (absent / no date)` : ""}`;
    await q(`update mp_sync_runs set status = 'ok', rows_read = $2, rows_written = $3, message = $4, finished_at = now() where id = $1`, [run!.id, rows.length + skipped, inRange.length, note]);
    return { ok: true as const, read: rows.length, written: inRange.length, note, from, to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q(`update mp_sync_runs set status = 'failed', message = $2, finished_at = now() where id = $1`, [run!.id, msg.slice(0, 1000)]);
    return { ok: false as const, error: msg, from, to };
  }
}

export const lastManpowerRuns = () => q<{ id: string; trigger: string; status: string; from_date: string | null; to_date: string | null; rows_written: number | null; message: string | null; started_at: string }>(
  `select id, trigger, status, from_date::text, to_date::text, rows_written, message, started_at::text from mp_sync_runs order by started_at desc limit 8`);
