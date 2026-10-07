import "server-only";
import { one, q } from "../db";
import { normalisePrefs, type Preferences } from "./constants";

export * from "./constants";

/** A user's preferences with sensible defaults. `dashboard.sections` is the ordered list of visible Command Centre sections. */
export async function getPreferences(userId: string): Promise<Preferences> {
  const r = await one<{ prefs: unknown }>(`select prefs from user_preferences where user_id = $1`, [userId]);
  return normalisePrefs(r?.prefs);
}

export async function savePreferences(userId: string, prefs: Preferences) {
  const clean = normalisePrefs(prefs);
  await q(`insert into user_preferences (user_id, prefs, updated_at) values ($1, $2, now())
           on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now()`, [userId, JSON.stringify(clean)]);
  return clean;
}
