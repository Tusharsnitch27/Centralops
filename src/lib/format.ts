// Number formatting in Indian conventions.
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** ₹ compact: ₹1.32 Cr, ₹18.4 L, ₹45.2K, ₹950. */
export function inr(v: number | null | undefined, opts: { sign?: boolean; precise?: boolean } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  const a = Math.abs(v);
  let s: string;
  if (a >= 1e7) s = `${(a / 1e7).toFixed(a >= 1e9 ? 0 : 2)} Cr`;
  else if (a >= 1e5) s = `${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  else if (a >= 1e3 && !opts.precise) s = `${(a / 1e3).toFixed(1)}K`;
  else s = inr0.format(Math.round(a));
  return `${sign}₹${s.replace(/\.0+ /, " ").replace(/(\.\d)0 /, "$1 ")}`;
}
/** Full ₹ with Indian grouping: ₹12,34,567. */
export const inrFull = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}₹${inr0.format(Math.round(Math.abs(v)))}`);

/** Compact count: 1.2L, 45.3K. */
export function num(v: number | null | undefined, opts: { sign?: boolean } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}${inr1.format(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}${inr1.format(a / 1e5)}L`;
  if (a >= 1e4) return `${sign}${inr1.format(a / 1e3)}K`;
  return `${sign}${inr0.format(Math.round(a))}`;
}
export const pct = (v: number | null | undefined, digits = 0, sign = false) =>
  v == null || !Number.isFinite(v) ? "—" : `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
