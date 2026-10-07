// Small formatting helpers shared by reports, insights and the assistant (pure).
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 'September' (or 'September 2027' when withYear). */
export const monthLong = (period: string, withYear = false) => `${LONG[Number(period.slice(5, 7)) - 1]}${withYear ? ` ${period.slice(0, 4)}` : ""}`;
/** Lower-case the first letter unless it starts an acronym ("RFID tunnel" stays). */
export const lc1 = (s: string) => (!s || /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
export const firstName = (n: string | null | undefined) => (n ?? "").split(/\s+/)[0] || "the owner";
/** Resolve to null if the promise doesn't settle within ms (keeps pages responsive when the AI endpoint is slow). */
export const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
