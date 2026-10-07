"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { KeyRound, MailWarning, Plus, Search, UserPlus, Wand2 } from "lucide-react";
import { Avatar, Badge, Button, Field } from "@/components/ui";
import { Combobox, Modal } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { createUser, resetUserPassword, updateUserAccess } from "@/server/settings/actions";
import type { AdminUser } from "@/server/settings/queries";
import { ROLE_OPTIONS, Toggle, useAction } from "./bits";

type Team = { id: string; name: string };
const ROLE_TONE: Record<string, "violet" | "info" | "neutral" | "muted"> = { admin: "violet", pm: "info", owner: "neutral", leadership: "neutral", viewer: "muted" };
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

function tempPassword() {
  const words = ["amber", "cedar", "delta", "ember", "fjord", "gamma", "harbor", "indigo", "jasper", "kilo", "lumen", "maple", "nova", "orbit"];
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${words[a[1] % words.length]}-${(a[2] % 900) + 100}`;
}

export function UsersAdmin({ users, teams, today, focus, isAdmin }: { users: AdminUser[]; teams: Team[]; today: string; focus?: string; isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "noemail" | "inactive">("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(() => users.find((u) => u.id === focus) ?? null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const act = useAction();
  const noEmail = users.filter((u) => u.active && !u.email);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => (filter === "noemail" ? u.active && !u.email : filter === "inactive" ? !u.active : true))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.team_name?.toLowerCase().includes(q));
  }, [users, query, filter]);
  const teamOptions = teams.map((t) => ({ value: t.id, label: t.name }));
  const roles = isAdmin ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r.value !== "admin");

  return (
    <div>
      {noEmail.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-[13px]">
          <MailWarning size={16} className="shrink-0 text-warn" />
          <div className="min-w-0 flex-1 text-ink-2">
            <span className="font-medium text-ink">{noEmail.length} people can't sign in yet</span> — they were imported from the plans without an email.
            Add an email and a temporary password to invite them.
          </div>
          <Button size="xs" onClick={() => setFilter("noemail")}>Show them</Button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[260px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, emails, teams" className="field h-8 py-1 pl-8 text-[12.5px]" />
        </div>
        <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 text-[12px]">
          {([["all", "All"], ["noemail", `Missing email · ${noEmail.length}`], ["inactive", "Inactive"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-md px-2.5 py-1", filter === k ? "bg-subtle font-medium text-ink" : "text-ink-3 hover:text-ink")}>{l}</button>
          ))}
        </div>
        <div className="ml-auto"><Button variant="primary" onClick={() => setCreating(true)}><UserPlus size={14} />Add user</Button></div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Person</th><th>Email (sign-in)</th><th>Role</th><th>Team</th><th>Joined</th><th>Active</th><th /></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={cn(!u.active && "opacity-60")}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} color={u.avatar_color} size={26} />
                      <div className="min-w-0">
                        <Link href={`/people/${u.id}`} className="block truncate font-medium text-ink hover:underline">{u.name}</Link>
                        <div className="truncate text-[12px] text-ink-3">{u.title ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {u.email ? (
                      <span className="text-ink-2">{u.email}{!u.has_password && <span className="ml-2 text-[11.5px] text-warn">no password</span>}</span>
                    ) : (
                      <button onClick={() => setEditing(u)} className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-1.5 py-0.5 text-[12px] font-medium text-warn ring-1 ring-inset ring-warn/20 hover:bg-warn/10">
                        <MailWarning size={12} />Add email to enable sign-in
                      </button>
                    )}
                  </td>
                  <td><Badge tone={ROLE_TONE[u.role] ?? "neutral"}>{roleLabel(u.role)}</Badge></td>
                  <td className="text-ink-2">{u.team_name ?? <span className="text-ink-4">—</span>}</td>
                  <td className="tabular text-ink-3">{u.joined_at}</td>
                  <td><Toggle checked={u.active} label="Active" disabled={act.pending || (u.role === "admin" && !isAdmin)} onChange={(v) => act.run(() => updateUserAccess(u.id, { active: v }), { success: v ? "Reactivated" : "Deactivated" })} /></td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                      <Button size="xs" variant="ghost" onClick={() => setResetting(u)} disabled={!u.email} title={u.email ? "Set a temporary password" : "Add an email first"}><KeyRound size={13} />Reset</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="py-10 text-center text-ink-3">No one matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {creating && <CreateUserModal onClose={() => setCreating(false)} teams={teamOptions} roles={roles} today={today} />}
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} teams={teamOptions} roles={roles} />}
      {resetting && <ResetModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function CreateUserModal({ onClose, teams, roles, today }: { onClose: () => void; teams: { value: string; label: string }[]; roles: typeof ROLE_OPTIONS; today: string }) {
  const [f, setF] = useState({ name: "", email: "", password: tempPassword(), role: "owner", teamId: null as string | null, title: "", joinedAt: today });
  const { pending, run } = useAction();
  const submit = () => run(() => createUser(f), { onOk: onClose });
  return (
    <Modal open onClose={onClose} title="Add user" description="They sign in with their email and this temporary password. Share it with them directly." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !f.name || !f.email} onClick={submit}><Plus size={14} />{pending ? "Creating…" : "Create user"}</Button></>}>
      <form className="grid gap-3.5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Full name"><input autoFocus className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Priya Sharma" /></Field>
        <Field label="Work email"><input type="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="priya@snitch.com" /></Field>
        <Field label="Temporary password" hint="At least 8 characters.">
          <div className="flex gap-1.5">
            <input className="field font-mono text-[12.5px]" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <Button size="md" title="Generate" onClick={() => setF({ ...f, password: tempPassword() })}><Wand2 size={14} /></Button>
          </div>
        </Field>
        <Field label="Title"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Warehouse Ops Manager" /></Field>
        <Field label="Role"><Combobox options={roles} value={f.role} allowClear={false} onChange={(v) => setF({ ...f, role: v ?? "owner" })} /></Field>
        <Field label="Team"><Combobox options={teams} value={f.teamId} placeholder="No team" onChange={(v) => setF({ ...f, teamId: v })} /></Field>
        <Field label="Joining date" hint="Nothing before this date is shown to them."><input type="date" className="field" value={f.joinedAt} onChange={(e) => setF({ ...f, joinedAt: e.target.value })} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, teams, roles }: { user: AdminUser; onClose: () => void; teams: { value: string; label: string }[]; roles: typeof ROLE_OPTIONS }) {
  const [f, setF] = useState({ name: user.name, email: user.email ?? "", role: user.role, teamId: user.team_id, title: user.title ?? "", joinedAt: user.joined_at, active: user.active });
  const [password, setPassword] = useState(user.has_password ? "" : tempPassword());
  const { pending, run } = useAction();
  const needsInvite = !user.email || !user.has_password;
  const submit = () => run(async () => {
    const r = await updateUserAccess(user.id, { name: f.name, email: f.email || null, role: f.role, teamId: f.teamId, title: f.title, joinedAt: f.joinedAt, active: f.active });
    if (r.ok && needsInvite && f.email && password) return resetUserPassword(user.id, password);
    return r;
  }, { onOk: onClose, success: "Saved" });
  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`} description="Role, team and sign-in access." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={submit}>{pending ? "Saving…" : "Save changes"}</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Full name"><input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work email" hint={!user.email ? "Required to sign in." : undefined}>
          <input type="email" className={cn("field", !f.email && "border-warn/50")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@snitch.com" />
        </Field>
        {needsInvite && (
          <Field label="Temporary password" hint="Set with the email so they can sign in." className="sm:col-span-2">
            <div className="flex gap-1.5 sm:max-w-[calc(50%-8px)]">
              <input className="field font-mono text-[12.5px]" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button size="md" title="Generate" onClick={() => setPassword(tempPassword())}><Wand2 size={14} /></Button>
            </div>
          </Field>
        )}
        <Field label="Role"><Combobox options={roles} value={f.role} allowClear={false} onChange={(v) => setF({ ...f, role: v ?? f.role })} /></Field>
        <Field label="Team"><Combobox options={teams} value={f.teamId} placeholder="No team" onChange={(v) => setF({ ...f, teamId: v })} /></Field>
        <Field label="Title"><input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Joining date"><input type="date" className="field" value={f.joinedAt} onChange={(e) => setF({ ...f, joinedAt: e.target.value })} /></Field>
        <label className="flex items-center gap-2.5 text-[13px] text-ink-2 sm:col-span-2"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />Active — can sign in and be assigned work</label>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState(tempPassword());
  const { pending, run } = useAction();
  return (
    <Modal open onClose={onClose} title={`Reset password · ${user.name}`} description={`They'll sign in as ${user.email} with this temporary password and can change it in Settings → Profile.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || password.length < 8} onClick={() => run(() => resetUserPassword(user.id, password), { onOk: onClose, refresh: false })}>{pending ? "Saving…" : "Set password"}</Button></>}>
      <div className="flex gap-1.5">
        <input className="field font-mono text-[12.5px]" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button size="md" title="Generate" onClick={() => setPassword(tempPassword())}><Wand2 size={14} /></Button>
        <Button size="md" onClick={() => navigator.clipboard?.writeText(password)}>Copy</Button>
      </div>
    </Modal>
  );
}
