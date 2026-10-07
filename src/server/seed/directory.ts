import "server-only";
import type { RunQ } from "../db";
import directory from "../../db/seed/directory.json";

const COLORS: Record<string, string> = {
  "Central Operations": "#111214", Logistics: "#2563eb", Product: "#7c3aed", "Product Ops (ERP)": "#0891b2", "Special Projects": "#ea580c", Warehouse: "#16a34a",
};

/** Upserts the Central Operations org (from HR's list): teams, employee no., full names, titles, departments, leads. */
export async function syncDirectory(S: RunQ, adminId: string) {
  const teamId = new Map<string, string>();
  // reuse the old team names where they map 1:1
  await S(`update teams set name = 'Warehouse' where name = 'Warehousing & Fulfilment' and not exists (select 1 from teams where name = 'Warehouse')`);
  await S(`update teams set name = 'Central Operations' where name = 'Central Ops PMO' and not exists (select 1 from teams where name = 'Central Operations')`);
  for (const t of Object.keys(COLORS)) {
    const r = await S<{ id: string }>(`insert into teams (name, function, color) values ($1,'Central Operations',$2) on conflict (name) do update set function = 'Central Operations', color = excluded.color returning id`, [t, COLORS[t]]);
    teamId.set(t, r[0].id);
  }
  for (const d of directory as { emp: string; name: string; dept: string; team: string; title: string; username: string; role?: string; lead?: boolean }[]) {
    const tid = teamId.get(d.team)!;
    const existing = d.role === "admin"
      ? await S<{ id: string }>(`select id from users where id = $1`, [adminId])
      : await S<{ id: string }>(`select id from users where employee_no = $1 or lower(username) = $2 limit 1`, [d.emp, d.username]);
    let id: string;
    if (existing.length) {
      id = existing[0].id;
      await S(`update users set name = $2, title = $3, employee_no = $4, department = $5, team_id = $6, role = case when role = 'admin' then role else coalesce($7, role) end, active = true where id = $1`,
        [id, d.name, d.title, d.emp, d.dept, tid, d.role ?? null]);
    } else {
      id = (await S<{ id: string }>(`insert into users (username, name, title, role, employee_no, department, team_id, joined_at) values ($1,$2,$3,$4,$5,$6,$7,current_date) returning id`,
        [d.username, d.name, d.title, d.role ?? "owner", d.emp, d.dept, tid]))[0].id;
    }
    await S(`delete from team_members where user_id = $1 and team_id in (select id from teams where function = 'Central Operations') and team_id <> $2`, [id, tid]);
    await S(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [tid, id]);
    if (d.lead || d.role === "pm") await S(`update teams set lead_id = $2 where id = $1`, [tid, id]);
  }
}
