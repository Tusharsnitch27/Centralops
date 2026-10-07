// Standard server-action result. Actions never throw to the client; they return { ok:false, error }.
export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
export const ok = <T,>(data?: T, message?: string): ActionResult<T> => ({ ok: true, data, message });
export const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : typeof e === "string" ? e : "Something went wrong" });
