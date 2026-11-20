"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { decideRule, draftRule, previewDraft, reverseRule, type DraftInput } from "@/server/wcm/actions";
import { CHANNELS, FUNCTIONS, type Family } from "@/server/wcm/math";
import { inrFull } from "@/lib/format";

type Row = { fn: string; target: string; pct: string }; // target: a channel, "shared" or "open"
type Preview = { period: string; site: string; basis: string; paise: number; now: Record<string, number>; next: Record<string, number> }[];
const rs = (p: number) => inrFull(p / 100);

/** Map or split one cost head (effective-dated, recurring). Saved as a draft; nothing changes until an approver approves it. */
export function MapDrawer({ family, head, site, period, label }: { family: Family; head: string; site: "South" | "North" | "Both"; period: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ fn: "", target: "open", pct: "100" }]);
  const [scope, setScope] = useState<string>(site);
  const [from, setFrom] = useState(period);
  const [reason, setReason] = useState(""), [driver, setDriver] = useState(""), [evidence, setEvidence] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(), router = useRouter();
  const total = rows.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  const input = (): DraftInput => ({
    family, head, site: scope as DraftInput["site"], from, reason, driver, evidence,
    slices: rows.map((r) => ({ fn: r.fn || null, channel: r.target === "shared" || r.target === "open" ? null : r.target, shared: r.target === "shared", share: (Number(r.pct) || 0) / 100 })),
  });
  const set = (i: number, p: Partial<Row>) => { setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r))); setPreview(null); };
  const runPreview = () => start(async () => { const r = await previewDraft(input()); if (!r.ok) return toast(r.error, "error"); setPreview(r.data ?? []); });
  const save = () => start(async () => { const r = await draftRule(input()); if (!r.ok) return toast(r.error, "error"); toast(r.message ?? "Draft saved", "success"); setOpen(false); router.refresh(); });
  const sum = (k: "now" | "next", f: string) => (preview ?? []).filter((p) => p.basis === "actual").reduce((a, p) => a + p[k][f]!, 0);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{label ?? "Map"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} width={720} title={`Map ${head}`}
        description="One rule for this cost head from the month you pick, every basis. It stays a draft until an approver approves it; whatever it doesn't cover stays Unallocated."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending} onClick={runPreview}>Preview impact</Button>
          <Button variant="primary" disabled={pending || !reason.trim() || total <= 0 || total > 100} onClick={save}>Save draft</Button></>}>
        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5"><span className="label">Applies to site</span>
              <select className="field h-8" value={scope} onChange={(e) => { setScope(e.target.value); setPreview(null); }}>
                {site !== "Both" && <option value={site}>{site} only</option>}{site === "Both" && <option value="Both">Site-unassigned (Both) lines</option>}<option value="*">Every site</option>
              </select></label>
            <label className="flex flex-col gap-0.5"><span className="label">Effective from</span>
              <input className="field h-8" type="month" value={from.slice(0, 7)} onChange={(e) => { setFrom(`${e.target.value}-01`); setPreview(null); }} /></label>
          </div>
          <table className="table-base">
            <thead><tr><th>Function</th><th>Channel</th><th className="w-24 text-right">Share %</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td><select aria-label="Function" className="field h-8 w-full" value={r.fn} onChange={(e) => set(i, { fn: e.target.value })}>
                  <option value="">— not confirmed —</option>{FUNCTIONS.map((f) => <option key={f}>{f}</option>)}</select></td>
                <td><select aria-label="Channel" className="field h-8 w-full" value={r.target} onChange={(e) => set(i, { target: e.target.value })}>
                  <option value="open">Open (stays Unallocated)</option><option value="shared">Shared — pooled beneficiary</option>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></td>
                <td><input aria-label="Share %" className="field h-8 w-full text-right tabular" inputMode="decimal" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} /></td>
                <td>{rows.length > 1 && <button className="text-ink-4 hover:text-bad" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label="Remove slice">×</button>}</td>
              </tr>))}</tbody>
          </table>
          <div className="flex items-center justify-between">
            <Button size="sm" onClick={() => setRows([...rows, { fn: "", target: "open", pct: "" }])}>Add slice</Button>
            <span className={total > 100 ? "text-bad" : total < 100 ? "text-warn" : "text-ok"}>{total.toFixed(2)}% mapped{total < 100 ? ` · ${(100 - total).toFixed(2)}% stays Unallocated` : ""}</span>
          </div>
          <label className="flex flex-col gap-0.5"><span className="label">Reason (required)</span><input className="field h-8" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. rent is space cost for pooled stock" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5"><span className="label">Driver (numerator ÷ denominator)</span><input className="field h-8" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="e.g. Oct day-equivalents B2C Forward ÷ all" /></label>
            <label className="flex flex-col gap-0.5"><span className="label">Evidence</span><input className="field h-8" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="link or document" /></label>
          </div>
          {preview && (
            <div className="rounded-lg border border-line p-2">
              <div className="mb-1 font-medium">Impact on {preview.length} source lines ({[...new Set(preview.map((p) => p.period.slice(0, 7)))].join(", ") || "none"})</div>
              {preview.length ? (
                <table className="table-base"><thead><tr><th>Actuals</th><th className="text-right">Assigned</th><th className="text-right">Shared</th><th className="text-right">Unallocated</th></tr></thead>
                  <tbody>{(["now", "next"] as const).map((k) => (
                    <tr key={k}><td>{k === "now" ? "Today" : "If approved"}</td>{["assigned", "shared", "unallocated"].map((f) => <td key={f} className="text-right tabular">{rs(sum(k, f))}</td>)}</tr>))}
                  </tbody></table>) : <p className="text-ink-3">No booked lines for this head in range yet — the rule will apply when they arrive.</p>}
            </div>)}
        </div>
      </Modal>
    </>
  );
}

/** Approve / reject a draft, or reverse an approved rule (server re-checks the approver's rights). */
export function RuleDecision({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<"reject" | "reverse" | null>(null), [note, setNote] = useState("");
  const toast = useToast(), router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const r = await fn(); if (!r.ok) return toast(r.error ?? "Failed", "error"); toast(r.message ?? "Done", "success"); setAsk(null); setNote(""); router.refresh();
  });
  if (ask) return (
    <span className="flex gap-1">
      <input autoFocus className="field h-7 w-44" aria-label={`Reason to ${ask}`} placeholder={ask === "reject" ? "Why reject?" : "Why reverse?"} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" variant="primary" disabled={pending || !note.trim()} onClick={() => act(() => (ask === "reject" ? decideRule(id, "reject", note) : reverseRule(id, note)))}>Confirm</Button>
      <Button size="sm" onClick={() => setAsk(null)}>Cancel</Button>
    </span>);
  if (status === "draft") return (
    <span className="flex gap-1">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => decideRule(id, "approve"))}>Approve</Button>
      <Button size="sm" disabled={pending} onClick={() => setAsk("reject")}>Reject</Button>
    </span>);
  if (status === "approved") return <Button size="sm" disabled={pending} onClick={() => setAsk("reverse")} title="Its amounts go back to Unallocated">Reverse</Button>;
  return null;
}
