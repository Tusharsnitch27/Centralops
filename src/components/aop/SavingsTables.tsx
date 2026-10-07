"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field } from "@/components/ui";
import { Combobox, Modal, useToast } from "@/components/ui/client";
import { inr, pct } from "@/lib/format";
import { deleteCreditNote, deleteIncident, saveCreditNote, saveIncident } from "@/server/aop/actions";
import type { CreditNote, Incident } from "@/server/aop/queries";
import { usePeople } from "./Actions";

const MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
const CN_STATUS = { open: { label: "Open", tone: "amber" }, partial: { label: "Partial", tone: "info" }, received: { label: "Received", tone: "green" }, rejected: { label: "Rejected", tone: "red" } } as const;
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[₹,\s]/g, "")));

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error ?? "Failed", "error");
    toast(r.message ?? "Saved", "success"); after?.(); router.refresh();
  });
  return { pending, run };
}

export function CreditNotesTable({ cycleId, rows, functions, canEdit, canDelete }: { cycleId: string; rows: CreditNote[]; functions: string[]; canEdit: boolean; canDelete: boolean }) {
  const people = usePeople();
  const { pending, run } = useRun();
  const [d, setD] = useState<(Partial<CreditNote> & { amountS: string; receivedS: string }) | null>(null);
  const edit = (r?: CreditNote) => setD(r ? { ...r, amountS: r.amount?.toString() ?? "", receivedS: r.received?.toString() ?? "" } : { amountS: "", receivedS: "", status: "auto" as never, function_name: functions[0] ?? null });
  return (
    <Card className="min-w-0">
      <CardHeader title="Credit notes" subtitle="Claims raised against partners — recovery tracked to closure" action={canEdit ? <Button size="xs" variant="secondary" onClick={() => edit()}><Plus size={13} />Add credit note</Button> : null} />
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Partner</th><th>Type</th><th>Function</th><th>Month</th><th className="text-right">Amount</th><th className="text-right">Received</th><th className="text-right">Recovery</th><th>Status</th><th>Owner</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const rec = r.amount ? (r.received ?? 0) / r.amount : null;
                const st = CN_STATUS[r.status as keyof typeof CN_STATUS] ?? CN_STATUS.open;
                return (
                  <tr key={r.id} className="group">
                    <td><div className="font-medium text-ink">{r.partner}</div>{r.remarks && <div className="max-w-[260px] truncate text-[11.5px] text-ink-3">{r.remarks}</div>}</td>
                    <td className="text-ink-2">{r.cn_type ?? "—"}</td>
                    <td className="text-ink-3">{r.function_name ?? "—"}</td>
                    <td className="text-ink-3">{r.month_label ?? "—"}</td>
                    <td className="text-right tabular">{inr(r.amount)}</td>
                    <td className="text-right tabular">{inr(r.received)}</td>
                    <td className="text-right tabular text-ink-2">{pct(rec)}</td>
                    <td><Badge tone={st.tone} dot>{st.label}</Badge></td>
                    <td>{r.owner_name ? <span className="flex items-center gap-1.5 text-ink-2"><Avatar name={r.owner_name} size={18} />{r.owner_name}</span> : <span className="text-ink-4">—</span>}</td>
                    <td className="w-16 text-right">
                      {canEdit && <span className="invisible inline-flex gap-0.5 group-hover:visible">
                        <button className="rounded p-1 text-ink-3 hover:bg-muted hover:text-ink" onClick={() => edit(r)} aria-label="Edit"><Pencil size={13} /></button>
                        {canDelete && <button className="rounded p-1 text-ink-3 hover:bg-bad-soft hover:text-bad" onClick={() => confirm(`Remove ${r.partner} credit note?`) && run(() => deleteCreditNote(r.id))} aria-label="Remove"><Trash2 size={13} /></button>}
                      </span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState compact title="No credit notes yet" body="Log weight disputes, lost shipments and bad-inventory claims to track recovery." />}
      <Modal open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit credit note" : "Add credit note"} width={560}
        footer={<><Button variant="ghost" onClick={() => setD(null)}>Cancel</Button><Button variant="primary" disabled={pending || !d?.partner?.trim()} onClick={() => d && run(() => saveCreditNote({
          id: d.id ?? null, cycleId, function_name: d.function_name ?? null, partner: d.partner ?? "", cn_type: d.cn_type ?? null, month_label: d.month_label ?? null,
          amount: toNum(d.amountS), received: toNum(d.receivedS), owner_id: d.owner_id ?? null, status: (d.status as string) ?? "auto", remarks: d.remarks ?? null,
        }), () => setD(null))}>Save</Button></>}>
        {d && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Partner"><input className="field" value={d.partner ?? ""} onChange={(e) => setD({ ...d, partner: e.target.value })} autoFocus /></Field>
            <Field label="Type"><input className="field" list="cn-types" value={d.cn_type ?? ""} onChange={(e) => setD({ ...d, cn_type: e.target.value })} placeholder="Weight Dispute, B2C Lost…" />
              <datalist id="cn-types">{["Weight Dispute", "B2C Lost", "Lost Boxes & Adhoc", "Bad Inventory", "Damage", "SLA Penalty"].map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="Function"><input className="field" list="cn-fns" value={d.function_name ?? ""} onChange={(e) => setD({ ...d, function_name: e.target.value })} />
              <datalist id="cn-fns">{functions.map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="Month"><select className="field" value={d.month_label ?? ""} onChange={(e) => setD({ ...d, month_label: e.target.value })}><option value="">—</option>{MONTHS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Amount (₹)"><input className="field tabular" inputMode="decimal" value={d.amountS} onChange={(e) => setD({ ...d, amountS: e.target.value })} /></Field>
            <Field label="Received (₹)"><input className="field tabular" inputMode="decimal" value={d.receivedS} onChange={(e) => setD({ ...d, receivedS: e.target.value })} /></Field>
            <Field label="Owner"><Combobox options={people} value={d.owner_id ?? null} onChange={(v) => setD({ ...d, owner_id: v })} /></Field>
            <Field label="Status"><select className="field" value={(d.status as string) ?? "auto"} onChange={(e) => setD({ ...d, status: e.target.value })}>
              <option value="auto">Auto (from amounts)</option>{Object.entries(CN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="Remarks" className="col-span-2"><input className="field" value={d.remarks ?? ""} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export function IncidentsTable({ cycleId, rows, functions, canEdit, canDelete }: { cycleId: string; rows: Incident[]; functions: string[]; canEdit: boolean; canDelete: boolean }) {
  const people = usePeople();
  const { pending, run } = useRun();
  const [d, setD] = useState<(Partial<Incident> & { amountS: string }) | null>(null);
  const edit = (r?: Incident) => setD(r ? { ...r, amountS: r.amount?.toString() ?? "" } : { amountS: "", function_name: functions[0] ?? null });
  return (
    <Card className="min-w-0">
      <CardHeader title="Incident expenses" subtitle="Unplanned costs — OT, priority vehicles, holds, waiting charges" action={canEdit ? <Button size="xs" variant="secondary" onClick={() => edit()}><Plus size={13} />Log incident</Button> : null} />
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Type</th><th>Reason</th><th>Function</th><th>Channel</th><th>Month</th><th className="text-right">Amount</th><th>Owner</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group">
                  <td className="font-medium text-ink">{r.expense_type ?? "—"}</td>
                  <td className="max-w-[240px] truncate text-ink-2" title={r.remarks ?? undefined}>{r.reason ?? "—"}</td>
                  <td className="text-ink-3">{r.function_name ?? "—"}</td>
                  <td className="text-ink-3">{r.channel ?? "—"}</td>
                  <td className="text-ink-3">{r.month_label ?? "—"}</td>
                  <td className="text-right tabular">{inr(r.amount)}</td>
                  <td>{r.owner_name ? <span className="flex items-center gap-1.5 text-ink-2"><Avatar name={r.owner_name} size={18} />{r.owner_name}</span> : <span className="text-ink-4">—</span>}</td>
                  <td className="w-16 text-right">
                    {canEdit && <span className="invisible inline-flex gap-0.5 group-hover:visible">
                      <button className="rounded p-1 text-ink-3 hover:bg-muted hover:text-ink" onClick={() => edit(r)} aria-label="Edit"><Pencil size={13} /></button>
                      {canDelete && <button className="rounded p-1 text-ink-3 hover:bg-bad-soft hover:text-bad" onClick={() => confirm("Remove this incident?") && run(() => deleteIncident(r.id))} aria-label="Remove"><Trash2 size={13} /></button>}
                    </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState compact title="No incidents logged" />}
      <Modal open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit incident" : "Log incident expense"} width={560}
        footer={<><Button variant="ghost" onClick={() => setD(null)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={() => d && run(() => saveIncident({
          id: d.id ?? null, cycleId, function_name: d.function_name ?? null, month_label: d.month_label ?? null, channel: d.channel ?? null, expense_type: d.expense_type ?? null,
          reason: d.reason ?? null, amount: toNum(d.amountS), owner_id: d.owner_id ?? null, remarks: d.remarks ?? null,
        }), () => setD(null))}>Save</Button></>}>
        {d && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Type of expense"><input className="field" list="inc-types" value={d.expense_type ?? ""} onChange={(e) => setD({ ...d, expense_type: e.target.value })} autoFocus />
              <datalist id="inc-types">{["OT", "Priority Vehicle", "Driver Wait", "NSO Hold", "Marketplace", "Re-delivery"].map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="Amount (₹)"><input className="field tabular" inputMode="decimal" value={d.amountS} onChange={(e) => setD({ ...d, amountS: e.target.value })} /></Field>
            <Field label="Function"><input className="field" list="inc-fns" value={d.function_name ?? ""} onChange={(e) => setD({ ...d, function_name: e.target.value })} />
              <datalist id="inc-fns">{functions.map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="Channel"><input className="field" value={d.channel ?? ""} onChange={(e) => setD({ ...d, channel: e.target.value })} placeholder="B2C, Marketplace, Retail…" /></Field>
            <Field label="Month"><select className="field" value={d.month_label ?? ""} onChange={(e) => setD({ ...d, month_label: e.target.value })}><option value="">—</option>{MONTHS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Owner"><Combobox options={people} value={d.owner_id ?? null} onChange={(v) => setD({ ...d, owner_id: v })} /></Field>
            <Field label="Reason" className="col-span-2"><input className="field" value={d.reason ?? ""} onChange={(e) => setD({ ...d, reason: e.target.value })} /></Field>
            <Field label="Remarks" className="col-span-2"><input className="field" value={d.remarks ?? ""} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
