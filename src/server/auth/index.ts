import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { one } from "../db";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export type Role = "admin" | "pm" | "owner" | "viewer" | "leadership";
export interface User {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: Role;
  title: string | null;
  team_id: string | null;
  avatar_color: string | null;
  joined_at: string;
  onboarded_at: string | null;
  full_overview: boolean;
}

const COLS = "id, name, email, username, role, title, team_id, avatar_color, joined_at, onboarded_at, full_overview";

/** Current signed-in user (null when signed out or deactivated). Cached per request. */
export const getUser = cache(async (): Promise<User | null> => {
  if (process.env.AUTH_MODE === "dev" && process.env.NODE_ENV !== "production") {
    const u = await one<User>(`select ${COLS} from users where active and role = 'admin' order by created_at limit 1`);
    if (u) return u;
  }
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  return one<User>(`select ${COLS} from users where id = $1 and active`, [s.uid]);
});

/** For pages/actions: the user, or redirect to /login. */
export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

/** Throws unless the user has one of the roles. Use in server actions. */
export async function requireRole(...roles: Role[]): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin" && !roles.includes(u.role)) throw new Error("You don't have permission to do that");
  return u;
}

/** Program-management capabilities (create/assign/distribute). */
export const canManage = (u: Pick<User, "role">) => u.role === "admin" || u.role === "pm";
/** Sees the whole S&OP program and every Weekly-update section (admins + people given "Full overview"). Others see only their own part. */
export const canOverview = (u: Pick<User, "role"> & { full_overview?: boolean }) => u.role === "admin" || !!u.full_overview;
/** Can edit anything they own; viewers/leadership are read-only. */
export const canEdit = (u: Pick<User, "role">) => u.role !== "viewer" && u.role !== "leadership";
