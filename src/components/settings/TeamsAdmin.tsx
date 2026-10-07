"use client";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AvatarStack, Button, Field } from "@/components/ui";
import { Combobox, Modal } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { saveTeam } from "@/server/settings/actions";
import type { TeamAdmin } from "@/server/settings/queries";
import { useAction } from "./bits";

type P = { id: string; name: string; color: string | null; title: string | null };
const SWATCHES = ["#18181b", "#0f766e", "#1d4ed8", "#7e22ce", "#0e7490", "#a16207", "#9f1239", "#9a3412", "#4d7c0f", "#3730a3", "#78716c"];

export function TeamsAdmin({ teams, people }: { teams: TeamAdmin[]; people: P[] }) {
  const [editing, setEditing] = useState<TeamAdmin | "new" | null>(null);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />New team</Button></div>
      <div className="card overflow-hidden">
        <table className="table-base">
          <thead><tr><th>Team</th><th>Function</th><th>Lead</th><th>Members</th><th /></tr></thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td><span className="inline-flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: t.color ?? "#a1a1aa" }} />{t.name}</span></td>
                <td className="text-ink-3">{t.function ?? "—"}</td>
                <td className="text-ink-2">{t.lead_id ? byId.get(t.lead_id)?.name ?? "—" : <span className="text-warn">Not set</span>}</td>
                <td><span className="inline-flex items-center gap-2"><AvatarStack people={t.member_ids.map((id) => byId.get(id)).filter(Boolean).map((p) => ({ name: p!.name, color: p!.color }))} max={6} size={20} /><span className="text-[12px] text-ink-4">{t.member_ids.length}</span></span></td>
                <td className="text-right"><Button size="xs" variant="ghost" onClick={() => setEditing(t)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TeamModal team={editing === "new" ? null : editing} people={people} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TeamModal({ team, people, onClose }: { team: TeamAdmin | null; people: P[]; onClose: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [fn, setFn] = useState(team?.function ?? "");
  const [color, setColor] = useState(team?.color ?? SWATCHES[1]);
  const [lead, setLead] = useState<string | null>(team?.lead_id ?? null);
  const [members, setMembers] = useState<Set<string>>(new Set(team?.member_ids ?? []));
  const [q, setQ] = useState("");
  const { pending, run } = useAction();
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setMembers((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open onClose={onClose} title={team ? `Edit ${team.name}` : "New team"} description="Teams can own tasks, projects and AOP functions." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !name.trim()} onClick={() => run(() => saveTeam({ id: team?.id, name, fn, color, leadId: lead, memberIds: [...members] }), { onOk: onClose })}>{pending ? "Saving…" : team ? "Save team" : "Create team"}</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name"><input autoFocus className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Returns" /></Field>
        <Field label="Function"><input className="field" value={fn} onChange={(e) => setFn(e.target.value)} placeholder="e.g. Central Operations" /></Field>
        <Field label="Lead"><Combobox options={people.map((p) => ({ value: p.id, label: p.name, hint: p.title ?? undefined }))} value={lead} onChange={setLead} placeholder="Choose a lead" /></Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {SWATCHES.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={cn("size-5 rounded-full ring-offset-2 ring-offset-surface", color === c && "ring-2 ring-ink-3")} style={{ background: c }} aria-label={c} />)}
          </div>
        </Field>
        <div className="sm:col-span-2">
          <div className="label flex items-center justify-between">Members <span className="font-normal text-ink-4">{members.size} selected</span></div>
          <div className="rounded-lg border border-line-strong">
            <div className="relative border-b border-line"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter people" className="w-full bg-transparent py-2 pl-8 pr-3 text-[13px] outline-none" /></div>
            <div className="max-h-56 overflow-y-auto p-1 scroll-thin">
              {list.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-subtle">
                  <input type="checkbox" checked={members.has(p.id) || lead === p.id} disabled={lead === p.id} onChange={() => toggle(p.id)} className="accent-ink" />
                  <span className="flex-1 text-ink">{p.name}</span><span className="truncate text-[11.5px] text-ink-4">{p.title}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
