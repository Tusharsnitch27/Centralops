import "server-only";
import type { RunQ } from "../db";

// Starting org chart (Oct 2026). Roles and top levels from Tushar; function heads and reportees inferred from the
// directory (department + title). Admins rearrange it in Settings › Org chart (drag & drop).
const LEVEL: Record<string, string> = {
  "Mahadevan Pillai": "manager", "Tushar Gupta": "program_manager", "Pradhyum Shivhare": "program_manager",
  "Manish Charan": "dept_manager", "Iqbal Akram Choudhary": "dept_manager",
  "Mohd Faisal Jamal Kidwai": "lead", "E Sagar Kumar Patra": "lead",
};
const REPORTS: Record<string, string> = {
  "Tushar Gupta": "Mahadevan Pillai", "Pradhyum Shivhare": "Mahadevan Pillai", "Manish Charan": "Mahadevan Pillai", "Iqbal Akram Choudhary": "Mahadevan Pillai",
  "Mohd Faisal Jamal Kidwai": "Mahadevan Pillai", "E Sagar Kumar Patra": "Mahadevan Pillai",
};
const DEPT_HEAD: Record<string, string> = {
  Warehouse: "Manish Charan", Logistics: "Iqbal Akram Choudhary", Product: "Mohd Faisal Jamal Kidwai",
  "Product Ops (ERP)": "E Sagar Kumar Patra", "Special Projects": "Tushar Gupta",
};
// roles: Mahadevan + Tushar admin (all control); Pradhyum program manager (all control, no settings)
const ROLE: Record<string, string> = { "Mahadevan Pillai": "admin", "Tushar Gupta": "admin", "Pradhyum Shivhare": "pm" };

export async function seedOrgChart(S: RunQ) {
  const users = await S<{ id: string; name: string; team_name: string | null }>(
    `select u.id, u.name, t.name as team_name from users u left join teams t on t.id = u.team_id where u.active`);
  const id = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  for (const u of users) {
    const head = REPORTS[u.name] ?? (u.team_name ? DEPT_HEAD[u.team_name] : undefined);
    const boss = head && head !== u.name ? id(head) : null;
    await S(`update users set org_level = $2, org_function = coalesce(org_function, $3), reports_to = coalesce(reports_to, $4) where id = $1`,
      [u.id, LEVEL[u.name] ?? "member", u.team_name, boss]);
    if (ROLE[u.name]) await S(`update users set role = $2 where id = $1 and role <> 'admin'`, [u.id, ROLE[u.name]]);
  }
}
