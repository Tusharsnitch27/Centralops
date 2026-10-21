"use client";
import { useMemo, useState } from "react";
import { ExternalLink, FileText, Search, User } from "lucide-react";
import type { LibraryItem } from "@/server/library/queries";
import { functionOrder } from "@/lib/opsFunctions";
import { cn } from "@/lib/cn";

/** Read view of the SOP register: what exists per function, its stream / channel, status and owner — the doc itself opens from the link. */
export function SopLibrary({ items: all }: { items: LibraryItem[] }) {
  const master = all.find((i) => i.category === "Source");
  const items = useMemo(() => all.filter((i) => i.category !== "Source").map((i) => ({
    ...i, fn: i.function_name || "General", stream: i.extra?.stream || i.category || "", channel: i.extra?.channel || "",
    state: !i.url ? (i.status === "To be created" ? "To be created" : "Link missing") : i.status === "Outdated" ? "Outdated" : "Active",
  })), [all]);
  const [qy, setQy] = useState("");
  const [fn, setFn] = useState("");
  const [stream, setStream] = useState("");
  const [state, setState] = useState("");
  const fns = [...new Set(items.map((i) => i.fn))].sort((a, b) => functionOrder(a) - functionOrder(b) || a.localeCompare(b));
  const streams = [...new Set(items.map((i) => i.stream).filter(Boolean))].sort();
  const shown = items.filter((i) => (!fn || i.fn === fn) && (!stream || i.stream === stream) && (!state || i.state === state)
    && (!qy || `${i.title} ${i.description} ${i.owner} ${i.channel} ${i.stream} ${i.extra?.remark ?? ""}`.toLowerCase().includes(qy.toLowerCase())));
  const tally = (s: string) => items.filter((i) => i.state === s).length;
  const STATES = [
    { k: "Active", tone: "text-ok", label: "Live with link" },
    { k: "Outdated", tone: "text-warn", label: "Old / not relevant" },
    { k: "Link missing", tone: "text-bad", label: "Link to be added" },
    { k: "To be created", tone: "text-ink-3", label: "To be created" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <button onClick={() => setState("")} className={cn("card p-3 text-left", !state && "ring-1 ring-ink/20")}>
          <div className="text-[22px] font-semibold tabular-nums leading-none">{items.length}</div>
          <div className="mt-1 text-[11.5px] text-ink-4">SOPs across {fns.length} functions</div>
        </button>
        {STATES.map((s) => (
          <button key={s.k} onClick={() => setState(state === s.k ? "" : s.k)} className={cn("card p-3 text-left", state === s.k && "ring-1 ring-ink/20")}>
            <div className={cn("text-[22px] font-semibold tabular-nums leading-none", s.tone)}>{tally(s.k)}</div>
            <div className="mt-1 text-[11.5px] text-ink-4">{s.label}</div>
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto p-3">
        <div className="mb-2 text-[11.5px] font-medium text-ink-4">Coverage — SOPs by function and stream</div>
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead><tr className="text-ink-4"><th className="py-1 text-left font-normal">Function</th>{streams.map((s) => <th key={s} className="px-2 py-1 text-right font-normal">{s}</th>)}<th className="py-1 pl-2 text-right font-normal">Total</th></tr></thead>
          <tbody>{fns.map((f) => (
            <tr key={f} className="border-t border-line">
              <td className="py-1.5"><button onClick={() => setFn(fn === f ? "" : f)} className={cn("font-medium hover:underline", fn === f && "text-info")}>{f}</button></td>
              {streams.map((s) => { const n = items.filter((i) => i.fn === f && i.stream === s).length; return (
                <td key={s} className="px-2 text-right tabular-nums"><button disabled={!n} onClick={() => { setFn(f); setStream(s); }} className={cn(n ? "text-ink hover:underline" : "text-ink-4/50")}>{n || "·"}</button></td>); })}
              <td className="pl-2 text-right font-semibold tabular-nums">{items.filter((i) => i.fn === f).length}</td>
            </tr>))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-[300px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input className="field h-9 pl-8" placeholder="Search SOPs, owners, channels…" value={qy} onChange={(e) => setQy(e.target.value)} />
        </label>
        <select className="field h-9 w-auto" value={fn} onChange={(e) => setFn(e.target.value)}><option value="">All functions</option>{fns.map((f) => <option key={f}>{f}</option>)}</select>
        <select className="field h-9 w-auto" value={stream} onChange={(e) => setStream(e.target.value)}><option value="">All streams</option>{streams.map((s) => <option key={s}>{s}</option>)}</select>
        {(fn || stream || state || qy) && <button onClick={() => { setFn(""); setStream(""); setState(""); setQy(""); }} className="text-[12px] text-ink-3 hover:text-ink">Clear</button>}
        {master?.url && <a href={master.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-info ring-1 ring-inset ring-line hover:bg-info-soft">Master SOP register<ExternalLink size={11} /></a>}
      </div>

      {fns.filter((f) => shown.some((i) => i.fn === f)).map((f) => (
        <section key={f} className="min-w-0">
          <h3 className="mb-2 flex items-baseline gap-2 px-1 text-[13px] font-semibold">{f}<span className="text-[11.5px] font-normal text-ink-4">{shown.filter((i) => i.fn === f).length}</span></h3>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {shown.filter((i) => i.fn === f).map((i) => (
              <article key={i.id} className={cn("card flex min-w-0 flex-col p-3.5", i.state === "Outdated" && "opacity-70")}>
                <div className="flex items-start gap-2">
                  <FileText size={14} className="mt-0.5 shrink-0 text-ink-4" />
                  <div className="min-w-0 flex-1">
                    {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-[13.5px] font-semibold leading-snug hover:text-info hover:underline">{i.title}</a>
                      : <span className="text-[13.5px] font-semibold leading-snug">{i.title}</span>}
                    {i.description && <p className="mt-0.5 text-[12.5px] text-ink-3">{i.description}</p>}
                  </div>
                  <StateDot state={i.state} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1 text-[11px]">
                  {i.stream && <span className="rounded bg-subtle px-1.5 py-0.5 text-ink-2">{i.stream}</span>}
                  {i.channel && <span className="rounded bg-info-soft px-1.5 py-0.5 text-info">{i.channel}</span>}
                  {i.extra?.version && <span className="rounded px-1.5 py-0.5 text-ink-3 ring-1 ring-inset ring-line">{i.extra.version}</span>}
                  {/^review done/i.test(i.extra?.remark ?? "") && <span className="rounded bg-ok-soft px-1.5 py-0.5 text-ok">Reviewed</span>}
                </div>
                {i.extra?.remark && i.extra.remark !== i.extra.version && !/^review done$/i.test(i.extra.remark) && <p className="mt-2 text-[11.5px] text-ink-4">{i.extra.remark.replace(/^review done,?\s*/i, "Reviewed · ")}</p>}
                <div className="mt-auto flex items-center gap-2 pt-3 text-[11.5px] text-ink-4">
                  {i.owner && <span className="flex min-w-0 items-center gap-1"><User size={11} className="shrink-0" /><span className="truncate">{i.owner}</span></span>}
                  {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="ml-auto flex shrink-0 items-center gap-1 text-info hover:underline"><span className="max-w-[160px] truncate">{i.extra?.link_text || "Open doc"}</span><ExternalLink size={11} /></a>
                    : <span className="ml-auto shrink-0 text-bad">{i.state === "To be created" ? "Not written yet" : "No link yet"}</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!shown.length && <div className="card p-8 text-center text-[13px] text-ink-3">Nothing matches.</div>}
    </div>
  );
}

function StateDot({ state }: { state: string }) {
  const c = state === "Active" ? "bg-ok" : state === "Outdated" ? "bg-warn" : state === "Link missing" ? "bg-bad" : "bg-ink-4";
  return <span title={state} className="mt-1.5 flex shrink-0 items-center gap-1 text-[10.5px] text-ink-4"><span className={cn("size-1.5 rounded-full", c)} />{state !== "Active" && state}</span>;
}
