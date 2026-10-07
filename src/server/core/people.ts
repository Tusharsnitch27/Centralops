import "server-only";
import { cache } from "react";
import { q } from "../db";

export interface Person { id: string; name: string; email: string | null; title: string | null; role: string; team_id: string | null; team_name: string | null; avatar_color: string | null }
export interface TeamLite { id: string; name: string; function: string | null; color: string | null }

/** Active people for pickers (cached per request). */
export const listPeople = cache(() =>
  q<Person>(`select u.id, u.name, u.email, u.title, u.role, u.team_id, t.name as team_name, u.avatar_color
             from users u left join teams t on t.id = u.team_id where u.active order by u.name`),
);
export const listTeams = cache(() => q<TeamLite>(`select id, name, function, color from teams order by name`));
export const listProjectsLite = cache(() =>
  q<{ id: string; name: string; code: string | null; program_id: string | null }>(
    `select id, name, code, program_id from projects where status not in ('completed','cancelled') order by name`),
);
export const listProgramsLite = cache(() => q<{ id: string; name: string; code: string | null }>(`select id, name, code from programs where status <> 'cancelled' order by name`));

/** Best-effort match of a free-text name ("Iqbal", "manish@snitch.com") to a user. */
export async function matchPerson(name: string | null | undefined): Promise<Person | null> {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/^@/, "");
  if (!n) return null;
  const people = await listPeople();
  return (
    people.find((p) => p.email?.toLowerCase() === n) ??
    people.find((p) => p.name.toLowerCase() === n) ??
    people.find((p) => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]) ??
    null
  );
}
export async function matchTeam(name: string | null | undefined): Promise<TeamLite | null> {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const teams = await listTeams();
  return teams.find((t) => t.name.toLowerCase() === n) ?? teams.find((t) => t.name.toLowerCase().startsWith(n) || n.startsWith(t.name.toLowerCase())) ?? null;
}
