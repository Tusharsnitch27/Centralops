import "server-only";
import { one, q } from "../db";
import { SOP_CUTOVER } from "../sop/sync";
import { guessFunc } from "./model";
import { autoDeployDays } from "../wcm/daily";

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
  heads: ["present_day_equivalent", "present_headcount", "headcount", "head_count", "heads", "manpower", "present", "present_count", "count", "hc", "total", "man_days", "mandays", "total_manpower"],
  person: ["employee_id", "emp_id", "emp_code", "employee_code", "employee_no", "staff_id", "user_id"],
  status: ["status", "attendance_status", "attendance", "present_status"],
  shift: ["shift", "shift_name"],
};
const ABSENT = /^(a|ab|absent|leave|l|wo|week ?off|off|holiday|h|lwp|cl|sl|el|na)$/i;

const env = (k: string) => process.env[k]?.trim().replace(/^["']|["']$/g, "") || null;
/** The attendance app hands over ATTENDANCE_API_BASE_URL + MANPOWER_API_PATH + ATTENDANCE_MANPOWER_API_TOKEN; MANPOWER_API_URL / _KEY also work. */
export function manpowerUrl() {
  const base = env("ATTENDANCE_API_BASE_URL");
  if (base) return new URL(env("MANPOWER_API_PATH") ?? "/api/v1/integrations/manpower", base).toString();
  return env("MANPOWER_API_URL");
}
// tolerate a pasted "Bearer " prefix or "NAME=value" line
const apiKey = () => (env("ATTENDANCE_MANPOWER_API_TOKEN") ?? env("MANPOWER_API_KEY"))?.replace(/^ATTENDANCE_MANPOWER_API_TOKEN=/, "").replace(/^bearer\s+/i, "").trim() || null;
/** What the configured token looks like — never the value — so a 401 says which mistake it is. */
function tokenShape() {
  const t = apiKey();
  if (!t) return "no token is set";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(t)) return "the token looks like MANPOWER_TOKEN_ID (a bare UUID) — paste ATTENDANCE_MANPOWER_API_TOKEN instead";
  const okShape = /^sapl_mp_[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,}$/.test(t);
  const id = env("MANPOWER_TOKEN_ID");
  const idMatch = id && t.startsWith("sapl_mp_") ? (t.slice(8, 44).toLowerCase() === id.toLowerCase() ? "matches MANPOWER_TOKEN_ID" : "does NOT match MANPOWER_TOKEN_ID") : null;
  return `token is ${t.length} chars, ${okShape ? "in the sapl_mp_<id>.<secret> format" : `NOT in the sapl_mp_<id>.<secret> format (starts "${t.slice(0, 8)}", ${/\s/.test(t) ? "contains spaces/line breaks" : "no spaces"})`}${idMatch ? `, its id ${idMatch}` : ""} — if the format is right it is revoked, rotated, expired or a synthetic (test) token`;
}
/** The attendance app only has captured days from its release; earlier dates are refused (400). */
const COVERAGE_START = () => env("MANPOWER_COVERAGE_START") ?? "2026-10-29";
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

export function parseManpower(body: unknown): { rows: MpRow[]; shiftRows: (MpRow & { shift: string })[]; shape: string; skipped: number } {
  const arr = Array.isArray(body) ? body
    : body && typeof body === "object" ? (["data", "rows", "items", "records", "results", "manpower"].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) : undefined;
  if (!arr) throw new Error("The manpower API didn't return a list of rows (expected an array, or { data: [...] })");
  if (!arr.length) return { rows: [], shiftRows: [], shape: "empty", skipped: 0 };
  const sample = lower(arr[0] as Record<string, unknown>);
  const has = (names: string[]) => names.some((n) => n in sample);
  if (!has(KEYS.day)) throw new Error(`No date field in the manpower rows (fields: ${Object.keys(sample).join(", ")})`);
  if (!has(KEYS.func)) throw new Error(`No function / department field in the manpower rows (fields: ${Object.keys(sample).join(", ")})`);
  const aggregated = has(KEYS.heads);
  const agg = new Map<string, { row: MpRow; people: Set<string> }>();
  const bySh = new Map<string, { row: MpRow & { shift: string }; people: Set<string> }>(); // same figures split by shift (Day / Night)
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
    const shift = String(pick(r, KEYS.shift) ?? "").trim() || "Unspecified";
    const ks = `${k}|${shift}`;
    const cs = bySh.get(ks) ?? { row: { day, site, func, shift, heads: 0 }, people: new Set<string>() };
    if (aggregated) {
      const n = Number(String(pick(r, KEYS.heads) ?? "0").replace(/,/g, ""));
      if (!Number.isFinite(n)) { skipped++; continue; }
      cur.row.heads += n; cs.row.heads += n;
    } else { const p = String(pick(r, KEYS.person) ?? `row${i}`); cur.people.add(p); cs.people.add(p); }
    agg.set(k, cur); bySh.set(ks, cs);
  }
  const rows = [...agg.values()].map((x) => ({ ...x.row, heads: aggregated ? x.row.heads : x.people.size }));
  const shiftRows = [...bySh.values()].map((x) => ({ ...x.row, heads: aggregated ? x.row.heads : x.people.size }));
  return { rows, shiftRows, shape: aggregated ? "headcount rows" : "per-person rows (counted)", skipped };
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

async function fetchJson(url: string, day: string) {
  const key = apiKey();
  const res = await fetch(withRange(url, day, day), {
    headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(60_000), cache: "no-store",
  });
  // 503 = that day's capture isn't available (or their DB is down) — never treated as zero manpower
  if (res.status === 503) return { missing: true as const };
  if (res.status === 401) throw new Error(`Manpower API refused the token (401): ${tokenShape()}`);
  if (res.status === 403) throw new Error("Manpower API: token isn't granted all facilities (403) — it needs WH1, WH2 and NORTH");
  if (!res.ok) throw new Error(`Manpower API answered ${res.status} for ${day}: ${(await res.text()).slice(0, 160)}`);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error(`Manpower API didn't return JSON (starts with: ${text.slice(0, 80)})`); }
  return { missing: false as const, body };
}
async function fetchDay(url: string, day: string) {
  const r = await fetchJson(url, day);
  return r.missing ? r : { missing: false as const, ...parseManpower(r.body) };
}

/** Attendance roles: availability rows (date × facility × post-transfer department × sub_department × designation × shift) summed to role × shift. */
export function parseRoles(body: unknown, day: string) {
  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) throw new Error("The availability API didn't return { rows: [...] }");
  const agg = new Map<string, { site: string; func: string; role: string; shift: string; de: number }>();
  for (const r of rows as Record<string, unknown>[]) {
    if (r.date !== day) continue;
    const x = { site: String(r.facility ?? ""), func: String(r.department ?? ""), role: String(r.sub_department ?? "") || "Not captured", shift: String(r.shift ?? "") || "Unspecified", de: Number(r.present_day_equivalent) || 0 };
    if (!x.site || !x.func) continue;
    const k = [x.site, x.func, x.role, x.shift].join("|"), cur = agg.get(k);
    if (cur) cur.de += x.de; else agg.set(k, x);
  }
  return [...agg.values()];
}

/**
 * One request per day, and each answered day replaces that day completely (transfers move heads between departments, so
 * nothing is appended or kept from an earlier poll). First pull starts at the API's coverage; after that the last 10 days are
 * re-read each morning so attendance corrections land. Days the API reports as not captured are skipped, never zeroed.
 */
export async function pullManpower(trigger: "manual" | "schedule" = "manual", actorId: string | null = null, fromOverride?: string) {
  const url = manpowerUrl();
  if (!url) throw new Error("ATTENDANCE_API_BASE_URL (or MANPOWER_API_URL) isn't set on the server");
  const to = istToday();
  const any = await one<{ n: number }>(`select count(*)::int as n from mp_daily`);
  const cover = COVERAGE_START();
  const from = [fromOverride ?? (any?.n ? minus(to, 10) : cover), cover].sort().at(-1)!;
  const [run] = await q<{ id: string }>(`insert into mp_sync_runs (trigger, from_date, to_date, actor_id) values ($1,$2,$3,$4) returning id`, [trigger, from, to, actorId]);
  try {
    if (from > to) throw new Error(`Manpower data starts ${cover} — nothing to pull yet`);
    const days: string[] = [];
    for (let d = from; d <= to; d = minus(d, -1)) days.push(d);
    if (days.length > 400) throw new Error("Pick a back-fill date within 400 days");
    const missing: string[] = [];
    let written = 0, skipped = 0, shape = "", roleErr = "";
    const roleDays: string[] = [];
    for (const day of days) {
      const r = await fetchDay(url, day);
      if (r.missing) { missing.push(day); continue; }
      shape = r.shape; skipped += r.skipped;
      const rows = r.rows.filter((x) => x.day === day);
      await q(`delete from mp_daily where day = $1`, [day]);
      await q(`delete from mp_daily_shift where day = $1`, [day]);
      const sr = r.shiftRows.filter((x) => x.day === day);
      if (sr.length)
        await q(`insert into mp_daily_shift (day, site, func, shift, heads) select * from unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::numeric[])`,
          [sr.map((x) => x.day), sr.map((x) => x.site), sr.map((x) => x.func), sr.map((x) => x.shift), sr.map((x) => x.heads)]);
      if (rows.length) {
        await q(`insert into mp_daily (day, site, func, heads) select * from unnest($1::date[], $2::text[], $3::text[], $4::numeric[])
                 on conflict (day, site, func) do update set heads = excluded.heads, fetched_at = now()`,
          [rows.map((x) => x.day), rows.map((x) => x.site), rows.map((x) => x.func), rows.map((x) => x.heads)]);
        // new names show up unmapped until someone maps them
        await q(`insert into mp_site_map (site, warehouse) select distinct s, case when s ~* 'north|tauru|ggn|gurgaon|delhi|ncr' then 'North' when s ~* 'south|blr|bangalore|bengaluru|wh1|wh2|sapl-wh' then 'South' else 'ignore' end
                 from unnest($1::text[]) s on conflict (site) do nothing`, [[...new Set(rows.map((x) => x.site))]]);
        const fs = [...new Set(rows.map((x) => x.func))];
        await q(`insert into mp_func_map (func, department) select * from unnest($1::text[], $2::text[]) on conflict (func) do nothing`, [fs, fs.map(guessFunc)]);
      }
      written += rows.length;
      // roles for the auto deployment split: own failure never blocks the manpower day
      try {
        const a = await fetchJson(new URL("/api/v1/integrations/availability", url).toString(), day);
        if (!a.missing) {
          const rr = parseRoles(a.body, day);
          await q(`delete from mp_role_daily where day = $1`, [day]);
          if (rr.length) await q(`insert into mp_role_daily (day, site, func, role, shift, de) select $1::date, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[])`,
            [day, rr.map((x) => x.site), rr.map((x) => x.func), rr.map((x) => x.role), rr.map((x) => x.shift), rr.map((x) => x.de)]);
          roleDays.push(day);
        }
      } catch (e) { roleErr = e instanceof Error ? e.message : String(e); }
    }
    let autoNote = "";
    if (roleDays.length) {
      try { autoNote = ` · ${await autoDeployDays(roleDays)} pools auto-split from roles`; }
      catch (e) { autoNote = ` · auto-split failed: ${e instanceof Error ? e.message : e}`; }
    }
    if (roleErr) autoNote += ` · roles not read: ${roleErr.slice(0, 160)}`;
    if (missing.length === days.length) throw new Error(`Manpower capture unavailable for ${missing.length === 1 ? missing[0] : `all ${missing.length} days`} (503) — will retry`);
    const note = `${days.length - missing.length} days · ${written} day × facility × department rows${shape ? ` · ${shape}` : ""}${skipped ? ` · ${skipped} skipped` : ""}${missing.length ? ` · not captured yet: ${missing.join(", ")}` : ""}${autoNote}`;
    await q(`update mp_sync_runs set status = 'ok', rows_read = $2, rows_written = $3, message = $4, finished_at = now() where id = $1`, [run!.id, written + skipped, written, note]);
    return { ok: true as const, read: written, written, note, from, to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q(`update mp_sync_runs set status = 'failed', message = $2, finished_at = now() where id = $1`, [run!.id, msg.slice(0, 1000)]);
    return { ok: false as const, error: msg, from, to };
  }
}

export const lastManpowerRuns = () => q<{ id: string; trigger: string; status: string; from_date: string | null; to_date: string | null; rows_written: number | null; message: string | null; started_at: string }>(
  `select id, trigger, status, from_date::text, to_date::text, rows_written, message, started_at::text from mp_sync_runs order by started_at desc limit 8`);
