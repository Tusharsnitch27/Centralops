// Date helpers. All business dates are IST calendar dates as 'YYYY-MM-DD' strings.
export const TZ = "Asia/Kolkata";

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's IST date, 'YYYY-MM-DD'. */
export const today = (now: Date = new Date()) => ymd.format(now);
/** IST date of a timestamp. */
export const dateOf = (d: Date | string) => ymd.format(typeof d === "string" ? new Date(d) : d);

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export function addMonths(period: string, n: number) {
  const d = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week containing date. */
export function weekStart(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 'Oct 7' or 'Oct 7, 2025' when not the current year. */
export function fmtDate(date: string | null | undefined, opts: { year?: boolean; dow?: boolean } = {}) {
  if (!date) return "—";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const base = `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const withYear = opts.year || y !== Number(today().slice(0, 4)) ? `${base}, ${y}` : base;
  return opts.dow ? `${DOW[d.getUTCDay()]}, ${withYear}` : withYear;
}
/** 'Oct 26' style month label for a period. */
export const fmtMonth = (period: string, withYear = true) => {
  const d = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  return withYear ? `${MON[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}` : MON[d.getUTCMonth()];
};

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
/** '3:30 pm' in IST. */
export const fmtTime = (ts: string | Date | null | undefined) => (ts ? timeFmt.format(typeof ts === "string" ? new Date(ts) : ts).replace(" ", " ").toLowerCase() : "—");

/** Relative: 'today', 'tomorrow', 'in 3 days', '2 days ago', or a date. */
export function relDay(date: string | null | undefined, ref = today()) {
  if (!date) return "—";
  const n = diffDays(date.slice(0, 10), ref);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return `In ${n} days`;
  if (n < -1 && n > -14) return `${-n} days ago`;
  return fmtDate(date);
}

/** '5m ago', '3h ago', '2d ago'. */
export function ago(ts: string | Date | null | undefined, now = Date.now()) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(dateOf(new Date(ts)));
}

/** Indian FY label for a date: FY 26-27. */
export function fyLabel(date = today()) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `FY ${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}
