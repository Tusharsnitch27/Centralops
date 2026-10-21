import "server-only";
import { one, q } from "../db";

export interface AdminUser {
  id: string; name: string; email: string | null; username: string | null; role: string; title: string | null; team_id: string | null; team_name: string | null;
  joined_at: string; active: boolean; has_password: boolean; last_seen_at: string | null; avatar_color: string | null; employee_no: string | null; department: string | null; phone: string | null; whatsapp_opt_in: boolean; full_overview: boolean;
}
export async function listUsersAdmin() {
  return q<AdminUser>(
    `select u.id, u.name, u.email, u.username, u.role, u.title, u.team_id, t.name as team_name, u.joined_at, u.active,
            (u.password_hash is not null) as has_password, u.last_seen_at, u.avatar_color, u.employee_no, u.department, u.phone, u.whatsapp_opt_in, u.full_overview
     from users u left join teams t on t.id = u.team_id order by u.active desc, u.name`);
}

export interface PermissionRow { id: string; user_id: string | null; user_name: string | null; team_id: string | null; team_name: string | null; entity_type: string; entity_id: string | null; entity_name: string | null; level: string; created_at: string }
export async function listPermissions() {
  return q<PermissionRow>(
    `select p.id, p.user_id, u.name as user_name, p.team_id, t.name as team_name, p.entity_type, p.entity_id, p.level, p.created_at,
            case p.entity_type
              when 'program' then (select name from programs where id = p.entity_id)
              when 'project' then (select name from projects where id = p.entity_id)
              when 'aop_section' then (select name from aop_sections where id = p.entity_id)
              when 'sop_stream' then (select name from sop_streams where id = p.entity_id)
            end as entity_name
     from permissions p left join users u on u.id = p.user_id left join teams t on t.id = p.team_id
     order by p.entity_type, entity_name nulls first, coalesce(u.name, t.name)`);
}

export interface EntityOption { value: string; label: string; hint?: string }
export async function permissionEntities(): Promise<Record<string, EntityOption[]>> {
  const [sections, streams] = await Promise.all([
    q<EntityOption>(`select s.id as value, s.name as label, c.name as hint from aop_sections s join aop_cycles c on c.id = s.cycle_id where s.parent_id is null order by c.fy_start desc, s.sort`),
    q<EntityOption>(`select id as value, name as label, area as hint from sop_streams where active order by sort`),
  ]);
  const clean = (r: EntityOption[]) => r.map((o) => ({ value: o.value, label: o.label, ...(o.hint ? { hint: o.hint } : {}) }));
  return { aop_section: clean(sections), sop_stream: clean(streams) };
}

export interface TeamAdmin { id: string; name: string; function: string | null; color: string | null; lead_id: string | null; member_ids: string[] }
export async function listTeamsAdmin() {
  return q<TeamAdmin>(
    `select t.id, t.name, t.function, t.color, t.lead_id,
            coalesce((select array_agg(m.user_id) from team_members m join users u on u.id = m.user_id where m.team_id = t.id and u.active), '{}') as member_ids
     from teams t order by t.name`);
}

/* ---------------- templates (app_settings) ---------------- */
export const TEMPLATE_KEYS = {
  mom: { key: "template.mom", label: "MoM template", hint: "Pre-filled when a MoM owner starts writing minutes." },
  weekly_report: { key: "template.weekly_report", label: "Weekly report template", hint: "Intro and sign-off for the Weekly Program Manager Review." },
} as const;
export type TemplateKind = keyof typeof TEMPLATE_KEYS;

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  mom: `Attendees:

Context / agenda

Discussion
-

Decisions
-

Actions (owner · due date)
-

Risks / blockers
-

Next review:`,
  weekly_report: `Hi all — here's the Central Ops program review for the week.

{{report}}

Reply here with corrections or anything I've missed.
— {{name}}`,
};

export async function getTemplates(): Promise<Record<TemplateKind, string>> {
  const rows = await q<{ key: string; value: unknown }>(`select key, value from app_settings where key like 'template.%'`);
  const out = { ...DEFAULT_TEMPLATES };
  for (const [k, meta] of Object.entries(TEMPLATE_KEYS) as [TemplateKind, (typeof TEMPLATE_KEYS)[TemplateKind]][]) {
    const r = rows.find((x) => x.key === meta.key);
    const v = r?.value as { body?: string } | string | undefined;
    if (typeof v === "string") out[k] = v;
    else if (v && typeof v.body === "string") out[k] = v.body;
  }
  return out;
}

export interface InsightRuleAdmin { id: string; module: string; key: string | null; name: string; description: string | null; rule: Record<string, unknown>; severity: string; enabled: boolean; builtin: boolean }
export async function listInsightRules() {
  return q<InsightRuleAdmin>(`select id, module, key, name, description, rule, severity, enabled, builtin from insight_rules order by array_position(array['tasks','projects','aop','sop'], module), name`);
}

export async function getUserProfile(id: string) {
  return one<{ id: string; name: string; title: string | null; email: string | null; phone: string | null; role: string; team_name: string | null; joined_at: string; has_password: boolean }>(
    `select u.id, u.name, u.title, u.email, u.phone, u.role, t.name as team_name, u.joined_at, (u.password_hash is not null) as has_password
     from users u left join teams t on t.id = u.team_id where u.id = $1`, [id]);
}
