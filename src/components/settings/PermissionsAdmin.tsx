"use client";
import { useMemo, useState } from "react";
import { ShieldCheck, Trash2, Users } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Field } from "@/components/ui";
import { Combobox, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { addPermission, removePermission } from "@/server/settings/actions";
import type { PermissionRow } from "@/server/settings/queries";
import { useAction } from "./bits";

const TYPES = [
  { value: "aop_section", label: "AOP function" },
  { value: "sop_stream", label: "S&OP stream" },
];
const LEVELS = [
  { value: "view", label: "View", hint: "See the S&OP stream in Inputs" },
  { value: "edit", label: "Edit", hint: "Enter AOP inputs / S&OP projections" },
  { value: "manage", label: "Manage", hint: "Edit + assign, approve, configure" },
];
const LEVEL_TONE = { view: "muted", edit: "info", manage: "violet" } as const;

export function PermissionsAdmin({ rows, people, teams, entities }: { rows: PermissionRow[]; people: Option[]; teams: Option[]; entities: Record<string, Option[]> }) {
  const [subject, setSubject] = useState<"user" | "team">("user");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("aop_section");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [level, setLevel] = useState("edit");
  const { pending, run } = useAction();
  const entityOptions = useMemo(() => [{ value: "*", label: `All ${TYPES.find((t) => t.value === entityType)?.label.toLowerCase()}s` }, ...(entities[entityType] ?? [])], [entities, entityType]);
  const grouped = useMemo(() => {
    const m = new Map<string, PermissionRow[]>();
    for (const r of rows) m.set(r.entity_type, [...(m.get(r.entity_type) ?? []), r]);
    return m;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-ink"><ShieldCheck size={15} className="text-ink-3" />Grant access</div>
        <div className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_150px_minmax(0,1fr)_150px_auto] md:items-end">
          <Field label="Grant to">
            <div className="flex rounded-lg border border-line-strong bg-surface p-0.5 text-[12.5px]">
              {(["user", "team"] as const).map((k) => (
                <button key={k} type="button" onClick={() => { setSubject(k); setSubjectId(null); }} className={cn("flex-1 rounded-md px-2 py-1.5", subject === k ? "bg-subtle font-medium text-ink" : "text-ink-3")}>{k === "user" ? "Person" : "Team"}</button>
              ))}
            </div>
          </Field>
          <Field label={subject === "user" ? "Person" : "Team"}><Combobox options={subject === "user" ? people : teams} value={subjectId} onChange={setSubjectId} placeholder={subject === "user" ? "Choose a person" : "Choose a team"} /></Field>
          <Field label="On"><Combobox options={TYPES} value={entityType} allowClear={false} onChange={(v) => { setEntityType(v ?? "aop_section"); setEntityId(null); }} /></Field>
          <Field label="Which"><Combobox options={entityOptions} value={entityId ?? "*"} allowClear={false} onChange={(v) => setEntityId(v === "*" ? null : v)} /></Field>
          <Field label="Level"><Combobox options={LEVELS} value={level} allowClear={false} onChange={(v) => setLevel(v ?? "view")} /></Field>
          <Button variant="primary" size="md" disabled={!subjectId || pending}
            onClick={() => run(() => addPermission({ subject, subjectId: subjectId!, entityType, entityId, level }), { onOk: () => setSubjectId(null) })}>Grant</Button>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">Roles set the baseline (admins & PMs manage everything; leadership and viewers read). Grants here add object-level access on top — e.g. let Iqbal enter inputs for the Logistics AOP function, or the Retail team enter the Retail-Forward S&OP projections.</p>
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState icon={<ShieldCheck size={18} />} title="No object-level grants yet" body="Owners and POCs already edit their own AOP functions and S&OP streams. Grant access here when someone else needs to enter inputs for a specific AOP function or S&OP stream (or all of them)." /></div>
      ) : (
        TYPES.filter((t) => grouped.has(t.value)).map((t) => (
          <div key={t.value} className="card overflow-hidden">
            <div className="border-b border-line px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t.label}s</div>
            <table className="table-base">
              <tbody>
                {grouped.get(t.value)!.map((r) => (
                  <tr key={r.id}>
                    <td className="w-[40%]">{r.entity_name ?? <span className="text-ink-3">All {t.label.toLowerCase()}s</span>}</td>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        {r.user_name ? <Avatar name={r.user_name} size={20} /> : <span className="flex size-5 items-center justify-center rounded-md bg-muted text-ink-3"><Users size={11} /></span>}
                        {r.user_name ?? r.team_name}{r.team_name && <span className="text-[11.5px] text-ink-4">team</span>}
                      </span>
                    </td>
                    <td><Badge tone={LEVEL_TONE[r.level as keyof typeof LEVEL_TONE] ?? "neutral"}>{LEVELS.find((l) => l.value === r.level)?.label ?? r.level}</Badge></td>
                    <td className="w-10 text-right"><button title="Remove" disabled={pending} onClick={() => run(() => removePermission(r.id))} className="rounded-md p-1.5 text-ink-4 hover:bg-bad-soft hover:text-bad"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
