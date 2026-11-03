"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtMonth } from "@/lib/dates";

/** Stream + month for the entry form: picking either opens it straight away (the values below change with it). */
export function InputPicker({ streams, periods, stream, period }: { streams: { id: string; label: string }[]; periods: string[]; stream?: string; period: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (s: string | undefined, p: string) => start(() => router.push(`/sop/inputs?stream=${s ?? ""}&period=${p}#submit`, { scroll: false }));
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label><span className="label">Stream</span>
        <select value={stream} onChange={(e) => go(e.target.value, period)} className="field h-9 w-64 py-1" disabled={pending}>
          {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label><span className="label">Month</span>
        <select value={period} onChange={(e) => go(stream, e.target.value)} className="field h-9 w-40 py-1" disabled={pending}>
          {periods.map((p) => <option key={p} value={p}>{fmtMonth(p)}</option>)}
        </select>
      </label>
      {pending && <span className="pb-2 text-[12px] text-ink-4">Loading…</span>}
    </div>
  );
}
