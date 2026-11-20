"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { raiseFollowUp, refreshStageOutput, saveDeployment } from "@/server/wcm/dailyActions";
import { IDLE_REASONS, idleKey, type DeployLine } from "@/server/wcm/ops";
import { cn } from "@/lib/cn";

type Opt = { target: string; label: string; homeFn: string | null };
type Row = { target: string; de: string; reason: string };
const r2 = (x: number) => Math.round(x * 100) / 100;

/** One pool (site × day × home function): the lead confirms where its present day-equivalents went. Server re-validates everything. */
export function PoolEditor({ day, site, homeFn, available, revision, lines, options, proposal, canEdit, updated }: {
  day: string; site: string; homeFn: string; available: number; revision: number; lines: { target: string; de: number; reason: string | null }[];
  options: Opt[]; proposal: DeployLine[]; canEdit: boolean; updated: string | null;
}) {
  const init = lines.map((l) => ({ target: l.target, de: String(l.de), reason: l.reason ?? "" }));
  const [rows, setRows] = useState<Row[]>(init);
  const [pending, start] = useTransition();
  const toast = useToast(), router = useRouter();
  const confirmed = rows.reduce((a, r) => a + (Number(r.de) || 0), 0), left = r2(available - confirmed);
  const own = options.filter((o) => o.homeFn === homeFn), other = options.filter((o) => o.homeFn !== homeFn);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const isTransfer = (t: string) => { const o = options.find((x) => x.target === t); return !!o && !!o.homeFn && o.homeFn !== homeFn; };
  const save = () => start(async () => {
    const r = await saveDeployment(day, site, homeFn, rows.filter((x) => x.target && Number(x.de) > 0).map((x) => ({ target: x.target, de: Number(x.de), reason: x.reason || null })), revision);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Saved", "success"); router.refresh();
  });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">{homeFn}</span>
        <span className="text-[12px] text-ink-3 tabular">{r2(available)} DE present (attendance)</span>
        <span className={cn("ml-auto text-[12px] font-medium tabular", left < 0 ? "text-bad" : left > 0.005 ? "text-warn" : "text-ok")}>
          {left < 0 ? `over by ${-left} DE` : left > 0.005 ? `${left} DE unassigned` : "fully accounted"}</span>
      </div>
      {rows.length > 0 && (
        <table className="table-base mb-2">
          <thead><tr><th className="w-[45%]">Where the time went</th><th className="w-24 min-w-[88px] text-right">DE</th><th>Reason (transfer / other idle)</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td><select aria-label="Target" disabled={!canEdit} className="field h-8 w-full" value={r.target} onChange={(e) => set(i, { target: e.target.value })}>
                <option value="">— pick —</option>
                <optgroup label={`${homeFn} stages`}>{own.map((o) => <option key={o.target} value={o.target}>{o.label}</option>)}</optgroup>
                <optgroup label="Transfer to another function">{other.map((o) => <option key={o.target} value={o.target}>{o.label}</option>)}</optgroup>
                <optgroup label="Confirmed idle">{IDLE_REASONS.map((x) => <option key={x} value={idleKey(x)}>Idle · {x}</option>)}</optgroup>
              </select></td>
              <td><input aria-label="Day-equivalents" disabled={!canEdit} className="field h-8 w-full text-right tabular" inputMode="decimal" value={r.de} onChange={(e) => set(i, { de: e.target.value })} /></td>
              <td><input aria-label="Reason" disabled={!canEdit} className={cn("field h-8 w-full", (isTransfer(r.target) || r.target.startsWith("idle:Other")) && !r.reason && "ring-1 ring-warn")}
                value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} placeholder={isTransfer(r.target) ? "transfer reason (required)" : ""} /></td>
              <td>{canEdit && <button className="text-ink-4 hover:text-bad" aria-label="Remove line" onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>}</td>
            </tr>))}</tbody>
        </table>)}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setRows([...rows, { target: "", de: "", reason: "" }])}>Add line</Button>
          <Button size="sm" disabled={!proposal.length} title="Split present DE across this function's stages by today's workload (output ÷ IPP); review before saving"
            onClick={() => setRows(proposal.map((p) => ({ target: p.target, de: String(p.de), reason: "" })))}>Propose from workload</Button>
          <Button size="sm" variant="primary" disabled={pending} onClick={save}>Confirm split</Button>
          {updated && <span className="text-[11.5px] text-ink-4">last saved {updated}</span>}
        </div>)}
    </div>
  );
}

/** Raise a Central Ops task for a bottleneck / surplus (owner = you; due date = review date). */
export function FollowUp({ site, day, suggestion }: { site: string; day: string; suggestion: string }) {
  const [title, setTitle] = useState(suggestion), [note, setNote] = useState(""), [date, setDate] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast(), router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-1 flex-col gap-0.5"><span className="label">Action</span><input className="field h-8" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="flex flex-1 flex-col gap-0.5"><span className="label">Note</span><input className="field h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="who moves where, expected effect" /></label>
      <label className="flex flex-col gap-0.5"><span className="label">Review on</span><input className="field h-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <Button size="sm" variant="primary" disabled={pending || !title.trim()} onClick={() => start(async () => {
        const r = await raiseFollowUp(site, day, title, note, date); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Created", "success"); router.refresh();
      })}>Create follow-up</Button>
    </div>
  );
}

export function RefreshFeed() {
  const [pending, start] = useTransition();
  const toast = useToast(), router = useRouter();
  return <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await refreshStageOutput(); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Refreshed", "success"); router.refresh(); })}>
    {pending ? "Reading Snowflake…" : "Refresh stage output"}</Button>;
}
