"use server";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { canManage, requireUser, type Role } from "../auth";
import { hashPassword, verifyPassword, validPassword, PASSWORD_RULE } from "../auth/passwords";
import { logActivity } from "../core/activity";
import { fail, ok, type ActionResult } from "../core/result";
import { savePreferences, type Preferences } from "./prefs";
import { TEMPLATE_KEYS, type TemplateKind } from "./queries";
import { today } from "@/lib/dates";

const ROLES: Role[] = ["admin", "pm", "owner", "viewer", "leadership"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f-]{36}$/i;
const refresh = () => revalidatePath("/", "layout");

async function requireManager() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only admins and program managers can do that");
  return u;
}
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optId = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

/* ---------------- profile ---------------- */
export async function updateProfile(input: { name: string; title: string; phone?: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const name = str(input.name, 80);
    if (!name) throw new Error("Name is required");
    await q(`update users set name = $2, title = nullif($3, ''), phone = nullif($4, '') where id = $1`, [u.id, name, str(input.title, 120), str(input.phone, 30)]);
    await logActivity({ actorId: u.id, entityType: "user", entityId: u.id, action: "updated", summary: "Profile updated" });
    refresh();
    return ok(undefined, "Profile saved");
  } catch (e) { return fail(e); }
}

export async function changePassword(input: { current: string; next: string; confirm: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const row = await one<{ password_hash: string | null }>(`select password_hash from users where id = $1`, [u.id]);
    if (row?.password_hash && !(await verifyPassword(input.current ?? "", row.password_hash))) throw new Error("Current password is incorrect");
    if (!validPassword(input.next)) throw new Error(`New password must be ${PASSWORD_RULE}`);
    if (input.next !== input.confirm) throw new Error("Passwords don't match");
    await q(`update users set password_hash = $2 where id = $1`, [u.id, await hashPassword(input.next)]);
    await logActivity({ actorId: u.id, entityType: "user", entityId: u.id, action: "password_changed", summary: "Password changed" });
    return ok(undefined, "Password changed");
  } catch (e) { return fail(e); }
}

/* ---------------- users & access ---------------- */
export interface UserInput { name: string; email: string; password?: string; role: string; teamId?: string | null; title?: string; joinedAt?: string }

export async function createUser(input: UserInput): Promise<ActionResult<{ id: string }>> {
  try {
    const me = await requireManager();
    const name = str(input.name, 80);
    const email = str(input.email, 160).toLowerCase();
    if (!name) throw new Error("Name is required");
    if (!EMAIL.test(email)) throw new Error("A valid email is required — it's how people sign in");
    if (!validPassword(input.password ?? "")) throw new Error(`Temporary password must be ${PASSWORD_RULE}`);
    const role = ROLES.includes(input.role as Role) ? input.role : "owner";
    if (role === "admin" && me.role !== "admin") throw new Error("Only an admin can create another admin");
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(input.joinedAt ?? "") ? input.joinedAt! : today();
    if (await one(`select 1 from users where lower(email) = $1`, [email])) throw new Error("Someone already uses that email");
    const teamId = optId(input.teamId);
    const hash = await hashPassword(input.password!);
    const id = await tx(async (x) => {
      let username = email.split("@")[0].replace(/[^a-z0-9._-]/g, "");
      if (await x.one(`select 1 from users where username = $1`, [username])) username = email;
      const r = await x.one<{ id: string }>(
        `insert into users (username, email, name, title, role, password_hash, team_id, joined_at) values ($1,$2,$3,nullif($4,''),$5,$6,$7,$8) returning id`,
        [username, email, name, str(input.title, 120), role, hash, teamId, joined]);
      if (teamId) await x.q(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [teamId, r!.id]);
      await logActivity({ actorId: me.id, entityType: "user", entityId: r!.id, action: "created", summary: `${name} (${role})` }, x);
      return r!.id;
    });
    refresh();
    return ok({ id }, `${name} can now sign in with ${email}`);
  } catch (e) { return fail(e); }
}

export async function updateUserAccess(id: string, input: { name?: string; email?: string | null; role?: string; teamId?: string | null; title?: string; active?: boolean; joinedAt?: string }): Promise<ActionResult> {
  try {
    const me = await requireManager();
    if (!UUID.test(id)) throw new Error("Unknown user");
    const cur = await one<{ id: string; role: string; name: string; team_id: string | null; email: string | null }>(`select id, role, name, team_id, email from users where id = $1`, [id]);
    if (!cur) throw new Error("Unknown user");
    if ((cur.role === "admin" || input.role === "admin") && me.role !== "admin") throw new Error("Only an admin can change an admin's access");
    if (id === me.id && input.active === false) throw new Error("You can't deactivate yourself");
    if (id === me.id && input.role && input.role !== cur.role && cur.role === "admin") throw new Error("You can't remove your own admin role");
    const sets: string[] = []; const vals: unknown[] = [];
    const set = (c: string, v: unknown) => { vals.push(v); sets.push(`${c} = $${vals.length}`); };
    if (input.name !== undefined) { const n = str(input.name, 80); if (!n) throw new Error("Name is required"); set("name", n); }
    if (input.title !== undefined) set("title", str(input.title, 120) || null);
    if (input.email !== undefined) {
      const e = str(input.email ?? "", 160).toLowerCase();
      if (e && !EMAIL.test(e)) throw new Error("That email doesn't look right");
      if (e && (await one(`select 1 from users where lower(email) = $1 and id <> $2`, [e, id]))) throw new Error("Someone already uses that email");
      set("email", e || null);
    }
    if (input.role !== undefined) { if (!ROLES.includes(input.role as Role)) throw new Error("Unknown role"); set("role", input.role); }
    if (input.teamId !== undefined) set("team_id", optId(input.teamId));
    if (input.active !== undefined) set("active", !!input.active);
    if (input.joinedAt !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.joinedAt)) set("joined_at", input.joinedAt);
    if (!sets.length) return ok();
    vals.push(id);
    await tx(async (x) => {
      await x.q(`update users set ${sets.join(", ")} where id = $${vals.length}`, vals);
      if (input.teamId !== undefined) {
        const t = optId(input.teamId);
        if (cur.team_id && cur.team_id !== t) await x.q(`delete from team_members where team_id = $1 and user_id = $2`, [cur.team_id, id]);
        if (t) await x.q(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [t, id]);
      }
      await logActivity({ actorId: me.id, entityType: "user", entityId: id, action: "updated", summary: `Access updated for ${cur.name}`, to: { role: input.role, active: input.active } }, x);
    });
    refresh();
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  try {
    const me = await requireManager();
    const cur = await one<{ name: string; email: string | null; role: string }>(`select name, email, role from users where id = $1`, [id]);
    if (!cur) throw new Error("Unknown user");
    if (cur.role === "admin" && me.role !== "admin") throw new Error("Only an admin can reset an admin's password");
    if (!cur.email) throw new Error("Add an email first — people sign in with their email");
    if (!validPassword(password)) throw new Error(`Password must be ${PASSWORD_RULE}`);
    await q(`update users set password_hash = $2 where id = $1`, [id, await hashPassword(password)]);
    await logActivity({ actorId: me.id, entityType: "user", entityId: id, action: "password_reset", summary: `Password reset for ${cur.name}` });
    return ok(undefined, `Temporary password set for ${cur.name}`);
  } catch (e) { return fail(e); }
}

/* ---------------- permissions ---------------- */
const ENTITY_TYPES = ["program", "project", "aop_section", "sop_stream"];
export async function addPermission(input: { subject: "user" | "team"; subjectId: string; entityType: string; entityId: string | null; level: string }): Promise<ActionResult> {
  try {
    const me = await requireManager();
    if (!UUID.test(input.subjectId)) throw new Error("Pick a person or team");
    if (!ENTITY_TYPES.includes(input.entityType)) throw new Error("Pick what the access applies to");
    if (!["view", "edit", "manage"].includes(input.level)) throw new Error("Pick an access level");
    const entityId = optId(input.entityId);
    const userId = input.subject === "user" ? input.subjectId : null;
    const teamId = input.subject === "team" ? input.subjectId : null;
    const dup = await one<{ id: string }>(
      `select id from permissions where user_id is not distinct from $1 and team_id is not distinct from $2 and entity_type = $3 and entity_id is not distinct from $4`,
      [userId, teamId, input.entityType, entityId]);
    if (dup) await q(`update permissions set level = $2 where id = $1`, [dup.id, input.level]);
    else await q(`insert into permissions (user_id, team_id, entity_type, entity_id, level) values ($1,$2,$3,$4,$5)`, [userId, teamId, input.entityType, entityId, input.level]);
    await logActivity({ actorId: me.id, entityType: input.subject === "user" ? "user" : "team", entityId: input.subjectId, action: "permission_granted", to: { entityType: input.entityType, entityId, level: input.level } });
    revalidatePath("/settings");
    return ok(undefined, dup ? "Access updated" : "Access granted");
  } catch (e) { return fail(e); }
}
export async function removePermission(id: string): Promise<ActionResult> {
  try {
    const me = await requireManager();
    const r = await one<{ user_id: string | null; team_id: string | null }>(`delete from permissions where id = $1 returning user_id, team_id`, [id]);
    if (r) await logActivity({ actorId: me.id, entityType: r.user_id ? "user" : "team", entityId: r.user_id ?? r.team_id, action: "permission_revoked" });
    revalidatePath("/settings");
    return ok(undefined, "Access removed");
  } catch (e) { return fail(e); }
}

/* ---------------- teams ---------------- */
export async function saveTeam(input: { id?: string | null; name: string; fn?: string; color?: string; leadId?: string | null; memberIds: string[] }): Promise<ActionResult<{ id: string }>> {
  try {
    const me = await requireManager();
    const name = str(input.name, 80);
    if (!name) throw new Error("Team name is required");
    const color = /^#[0-9a-f]{6}$/i.test(input.color ?? "") ? input.color! : null;
    const lead = optId(input.leadId);
    const members = [...new Set([...(input.memberIds ?? []).filter((m) => UUID.test(m)), ...(lead ? [lead] : [])])];
    const id = await tx(async (x) => {
      const clash = await x.one(`select 1 from teams where lower(name) = lower($1) and id is distinct from $2`, [name, optId(input.id)]);
      if (clash) throw new Error("A team with that name already exists");
      let teamId = optId(input.id);
      if (teamId) await x.q(`update teams set name = $2, function = nullif($3,''), color = coalesce($4, color), lead_id = $5 where id = $1`, [teamId, name, str(input.fn, 80), color, lead]);
      else teamId = (await x.one<{ id: string }>(`insert into teams (name, function, color, lead_id) values ($1, nullif($2,''), $3, $4) returning id`, [name, str(input.fn, 80), color ?? "#71717a", lead]))!.id;
      await x.q(`delete from team_members where team_id = $1 and not (user_id = any($2::uuid[]))`, [teamId, members]);
      for (const m of members) await x.q(`insert into team_members (team_id, user_id) values ($1,$2) on conflict do nothing`, [teamId, m]);
      // a person's primary team follows membership when they had none
      await x.q(`update users set team_id = $1 where id = any($2::uuid[]) and team_id is null`, [teamId, members]);
      await logActivity({ actorId: me.id, entityType: "team", entityId: teamId, action: input.id ? "updated" : "created", summary: name }, x);
      return teamId;
    });
    refresh();
    return ok({ id }, input.id ? "Team saved" : "Team created");
  } catch (e) { return fail(e); }
}

/* ---------------- templates ---------------- */
export async function saveTemplate(kind: TemplateKind, body: string): Promise<ActionResult> {
  try {
    const me = await requireManager();
    const meta = TEMPLATE_KEYS[kind];
    if (!meta) throw new Error("Unknown template");
    const text = String(body ?? "").slice(0, 8000);
    await q(`insert into app_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [meta.key, JSON.stringify({ body: text, updated_by: me.id })]);
    await logActivity({ actorId: me.id, entityType: "integration", entityId: null, action: "template_updated", summary: meta.label });
    revalidatePath("/settings");
    return ok(undefined, `${meta.label} saved`);
  } catch (e) { return fail(e); }
}

/* ---------------- insight rules ---------------- */
// Only these numeric fields are editable, each with safe bounds.
const RULE_FIELDS: Record<string, { min: number; max: number; int?: boolean }> = {
  threshold: { min: 0, max: 100 },
  periods: { min: 1, max: 12, int: true },
};
export async function updateInsightRule(id: string, input: { enabled?: boolean; values?: Record<string, number>; severity?: string }): Promise<ActionResult> {
  try {
    const me = await requireManager();
    const cur = await one<{ rule: Record<string, unknown>; name: string; key: string | null }>(`select rule, name, key from insight_rules where id = $1`, [id]);
    if (!cur) throw new Error("Unknown rule");
    const rule = { ...cur.rule };
    for (const [k, v] of Object.entries(input.values ?? {})) {
      const spec = RULE_FIELDS[k];
      if (!spec || !(k in rule)) throw new Error(`“${k}” can't be edited`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
      // day thresholds are integers; ratio thresholds (< 1 by convention) stay fractional
      const isDays = cur.key === "tasks.no_update" || cur.key === "projects.milestone_slip";
      const max = k === "threshold" && !isDays ? 1 : spec.max;
      if (n < spec.min || n > max) throw new Error(`${k} must be between ${spec.min} and ${max}`);
      rule[k] = spec.int || (k === "threshold" && isDays) ? Math.round(n) : Math.round(n * 1000) / 1000;
    }
    const severity = input.severity && ["info", "warning", "critical"].includes(input.severity) ? input.severity : null;
    await q(`update insight_rules set rule = $2, enabled = coalesce($3, enabled), severity = coalesce($4, severity) where id = $1`,
      [id, JSON.stringify(rule), typeof input.enabled === "boolean" ? input.enabled : null, severity]);
    await logActivity({ actorId: me.id, entityType: "integration", entityId: null, action: "rule_updated", summary: cur.name, from: cur.rule, to: rule });
    revalidatePath("/settings");
    revalidatePath("/insights");
    revalidatePath("/exceptions");
    return ok(undefined, input.enabled === false ? `${cur.name} turned off` : input.enabled === true ? `${cur.name} turned on` : "Rule saved");
  } catch (e) { return fail(e); }
}

/* ---------------- personalisation ---------------- */
export async function savePersonalisation(prefs: Preferences): Promise<ActionResult> {
  try {
    const u = await requireUser();
    await savePreferences(u.id, prefs);
    refresh();
    return ok(undefined, "Preferences saved");
  } catch (e) { return fail(e); }
}
