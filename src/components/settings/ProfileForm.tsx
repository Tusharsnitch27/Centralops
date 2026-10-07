"use client";
import { useState } from "react";
import { Button, Field } from "@/components/ui";
import { changePassword, updateProfile } from "@/server/settings/actions";
import { Section, useAction } from "./bits";

export function ProfileForm({ profile }: { profile: { name: string; title: string | null; email: string | null; phone: string | null; role: string; team_name: string | null; joined_at: string; has_password: boolean } }) {
  const [name, setName] = useState(profile.name);
  const [title, setTitle] = useState(profile.title ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const save = useAction();
  const pass = useAction();
  const dirty = name !== profile.name || title !== (profile.title ?? "") || phone !== (profile.phone ?? "");
  return (
    <div>
      <Section title="Profile" description="How you appear on tasks, meetings and reports.">
        <form className="grid max-w-xl gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.run(() => updateProfile({ name, title, phone })); }}>
          <Field label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Head · Logistics" /></Field>
          <Field label="Email" hint="Your sign-in. Ask an admin to change it."><input className="field" value={profile.email ?? ""} disabled /></Field>
          <Field label="Phone" hint="Optional — for WhatsApp follow-ups later."><input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" /></Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={!dirty || save.pending}>{save.pending ? "Saving…" : "Save profile"}</Button>
            <span className="text-[12px] text-ink-3">{profile.team_name ?? "No team"} · joined {profile.joined_at}</span>
          </div>
        </form>
      </Section>
      <Section title="Password" description="Use at least 8 characters. You'll stay signed in on this device.">
        <form className="grid max-w-xl gap-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); pass.run(() => changePassword(pw), { onOk: () => setPw({ current: "", next: "", confirm: "" }), refresh: false }); }}>
          {profile.has_password && <Field label="Current password" className="sm:col-span-2"><input type="password" autoComplete="current-password" className="field sm:max-w-[calc(50%-8px)]" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>}
          <Field label="New password"><input type="password" autoComplete="new-password" className="field" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} required /></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" className="field" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} minLength={8} required /></Field>
          <div className="sm:col-span-2"><Button type="submit" disabled={pass.pending || !pw.next}>{pass.pending ? "Updating…" : "Change password"}</Button></div>
        </form>
      </Section>
    </div>
  );
}
