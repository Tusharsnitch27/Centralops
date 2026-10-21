import "server-only";
import { q } from "../db";

/**
 * Object-level access from Settings › Permissions, for AOP functions (sections) and S&OP streams.
 * A grant to a person or to a team they belong to; entity_id null = every object of that type. Levels: view < edit < manage.
 */
export type GrantType = "aop_section" | "sop_stream";
export type GrantLevel = "view" | "edit" | "manage";
export interface Grant { entity_id: string | null; level: GrantLevel }

export async function grantsFor(userId: string, type: GrantType): Promise<Grant[]> {
  return q<Grant>(
    `select p.entity_id, p.level from permissions p
     where p.entity_type = $2 and (p.user_id = $1 or p.team_id in (select team_id from team_members where user_id = $1))`, [userId, type]);
}

const RANK: Record<GrantLevel, number> = { view: 1, edit: 2, manage: 3 };
/** Does any grant reach this object (or one of its ancestors) at the given level or above? */
export function granted(grants: Grant[], ids: (string | null)[], min: GrantLevel = "edit") {
  return grants.some((g) => RANK[g.level] >= RANK[min] && (g.entity_id == null || ids.includes(g.entity_id)));
}
