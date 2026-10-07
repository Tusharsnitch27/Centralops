"use client";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronDown, Megaphone } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { Modal, type Option } from "@/components/ui/client";
import { cn } from "@/lib/cn";
import { RISK_LEVEL, type Tone } from "@/lib/meta";
import { escalateRisk, setRiskStatus } from "@/server/risks/actions";
import { RISK_STATUS, type RiskStatus } from "@/server/risks/meta";
import { TextArea, todayIST, useAction } from "@/components/projects/form";
import { RiskFormButton } from "./RiskForm";

export interface RiskView {
  id: string; title: string; description: string | null; project_id: string | null; project_name: string | null; project_code: string | null;
  owner_id: string | null; owner_name: string | null; owner_color: string | null; probability: number; impact: number; score: number;
  mitigation: string | null; trigger_signal: string | null; target_date: string | null; status: RiskStatus; meeting_id: string | null; meeting_title: string | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: string | null) => (d ? `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}` : "—");

export function RiskTable({ risks, options, focusId, editable, hideProject }: { risks: RiskView[]; options: { people: Option[]; projects: Option[] }; focusId?: string | null; editable: boolean; hideProject?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-[34%]">Risk</th>{!hideProject && <th>Project</th>}<th>Owner</th>
            <th className="text-center" title="Probability">P</th><th className="text-center" title="Impact">I</th><th>Score</th>
            <th>Target</th><th>Status</th><th className="w-[1%]" />
          </tr>
        </thead>
        <tbody>{risks.map((r) => <RiskRowView key={r.id} r={r} options={options} focused={r.id === focusId} editable={editable} hideProject={hideProject} />)}</tbody>
      </table>
    </div>
  );
}

function RiskRowView({ r, options, focused, editable, hideProject }: { r: RiskView; options: { people: Option[]; projects: Option[] }; focused: boolean; editable: boolean; hideProject?: boolean }) {
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (focused) { setOpen(true); ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, [focused]);
  const lvl = RISK_LEVEL(r.score);
  const st = RISK_STATUS[r.status];
  const closed = r.status === "closed";
  const late = r.target_date && r.target_date < todayIST() && !closed;
  const cols = hideProject ? 8 : 9;
  return (
    <Fragment>
      <tr ref={ref} className={cn("group cursor-pointer", focused && "bg-info-soft/40", closed && "opacity-60")} onClick={() => setOpen(!open)}>
        <td>
          <div className="flex items-start gap-2 py-1.5">
            <ChevronDown size={13} className={cn("mt-1 shrink-0 text-ink-4 transition-transform", open && "rotate-180")} />
            <span className="text-[13px] font-medium leading-snug text-ink">{r.title}</span>
          </div>
        </td>
        {!hideProject && <td>{r.project_id ? <Link onClick={(e) => e.stopPropagation()} href={`/projects/${r.project_id}?tab=risks`} className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 ring-1 ring-inset ring-line hover:text-ink">{r.project_code ?? r.project_name}</Link> : <span className="text-ink-4">—</span>}</td>}
        <td><span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar name={r.owner_name} color={r.owner_color} size={20} /><span className="text-ink-2">{r.owner_name ?? "—"}</span></span></td>
        <td className="text-center tabular text-ink-2">{r.probability}</td>
        <td className="text-center tabular text-ink-2">{r.impact}</td>
        <td><span className="flex items-center gap-1.5"><span className="w-5 text-right font-medium tabular text-ink">{r.score}</span><Badge tone={lvl.tone}>{lvl.label}</Badge></span></td>
        <td className={cn("whitespace-nowrap tabular", late ? "font-medium text-bad" : "text-ink-3")}>{fmt(r.target_date)}</td>
        <td><Badge tone={st.tone as Tone} dot={r.status === "escalated"}>{st.label}</Badge></td>
        <td onClick={(e) => e.stopPropagation()}>
          {editable && !closed && (
            <span className="flex items-center justify-end gap-1">
              {r.status !== "escalated" && <Escalate r={r} />}
              <CloseRisk id={r.id} />
              <RiskFormButton options={options} variant="ghost" size="xs" iconOnly initial={{
                id: r.id, title: r.title, description: r.description ?? "", projectId: r.project_id, ownerId: r.owner_id, probability: r.probability, impact: r.impact,
                mitigation: r.mitigation ?? "", triggerSignal: r.trigger_signal ?? "", targetDate: r.target_date ?? "", status: r.status,
              }} />
            </span>
          )}
          {editable && closed && <Reopen id={r.id} />}
        </td>
      </tr>
      {open && (
        <tr className="hover:bg-transparent">
          <td colSpan={cols} className="h-auto bg-subtle/40 py-3">
            <dl className="grid max-w-4xl gap-x-6 gap-y-2 pl-5 text-[13px] sm:grid-cols-[110px_1fr]">
              {r.description && <><dt className="text-[12px] text-ink-3">Detail</dt><dd className="text-ink-2">{r.description}</dd></>}
              <dt className="text-[12px] text-ink-3">Mitigation</dt><dd className={r.mitigation ? "text-ink-2" : "text-ink-4"}>{r.mitigation ?? "No mitigation recorded — add one"}</dd>
              <dt className="text-[12px] text-ink-3">Trigger</dt><dd className={r.trigger_signal ? "text-ink-2" : "text-ink-4"}>{r.trigger_signal ?? "—"}</dd>
              {r.meeting_id && <><dt className="text-[12px] text-ink-3">Raised in</dt><dd><Link href={`/meetings/${r.meeting_id}`} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">{r.meeting_title}<ArrowUpRight size={12} /></Link></dd></>}
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Escalate({ r }: { r: RiskView }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, run] = useAction();
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)} className="text-bad hover:bg-bad-soft hover:text-bad"><Megaphone size={12} />Escalate</Button>
      <Modal open={open} onClose={() => setOpen(false)} width={460} title="Escalate this risk" description="Notifies every admin and PM and puts it in their inbox."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" disabled={pending} onClick={() => run(() => escalateRisk(r.id, note), { onOk: () => setOpen(false) })}>{pending ? "Escalating…" : "Escalate"}</Button></>}>
        <div className="mb-3 rounded-lg border border-line bg-subtle/50 p-3 text-[13px] text-ink-2">{r.title}</div>
        <TextArea autoFocus rows={3} value={note} onChange={setNote} placeholder="What do you need from leadership? e.g. approve temp manpower budget by Friday" />
      </Modal>
    </>
  );
}

function CloseRisk({ id }: { id: string }) {
  const [pending, run] = useAction();
  return <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setRiskStatus(id, "closed"))} title="Close risk"><CheckCircle2 size={12} />Close</Button>;
}
function Reopen({ id }: { id: string }) {
  const [pending, run] = useAction();
  return <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setRiskStatus(id, "open" as RiskStatus))}>Reopen</Button>;
}
