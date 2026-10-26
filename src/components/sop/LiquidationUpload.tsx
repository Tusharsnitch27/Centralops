"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { uploadLiquidationActuals } from "@/server/sop/liquidation";
import { cn } from "@/lib/cn";

type Day = { day: string; south: number | null; north: number | null };
const fmt = (v: number | null | undefined) => (v == null ? "" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
const dayList = (p: string) => Array.from({ length: new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).getUTCDate() }, (_, i) => `${p.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
const monLabel = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Liquidation actuals from gatepasses: download the month's template (dates filled, current numbers in), fill South / North units per day,
 * upload. Saved days flow into S&OP › Liquidation (weeks, days, ±20% alerts) on the spot.
 */
export function LiquidationUpload({ months, saved, ownerName }: { months: string[]; saved: Record<string, { day: string; south: number; north: number }[]>; ownerName: string | null }) {
  const [period, setPeriod] = useState(months[0]!);
  const [preview, setPreview] = useState<Day[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const router = useRouter();
  const cur = saved[period] ?? [];

  async function download() {
    const XLSX = await import("xlsx");
    const rows = dayList(period).map((d) => { const s = cur.find((x) => x.day === d); return [d, new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), s?.south ?? null, s?.north ?? null]; });
    const ws = XLSX.utils.aoa_to_sheet([["Date", "Day", "South units", "North units"], ...rows]);
    ws["!cols"] = [{ wch: 12 }, { wch: 6 }, { wch: 13 }, { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Liquidation");
    XLSX.writeFile(wb, `Liquidation actuals (gatepass) - ${monLabel(period)}.xlsx`);
  }

  async function read(f: File) {
    try {
      setErr(null);
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: null });
      const head = (aoa[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
      const di = head.indexOf("date"), si = head.findIndex((h) => h.startsWith("south")), ni = head.findIndex((h) => h.startsWith("north"));
      if (di < 0 || (si < 0 && ni < 0)) throw new Error("Keep the template's header row: Date, Day, South units, North units");
      const num = (v: unknown) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; };
      const out: Day[] = [];
      for (const r of aoa.slice(1)) {
        const raw = r[di];
        const day = raw instanceof Date ? new Date(raw.getTime() - raw.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(raw ?? "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const south = si >= 0 ? num(r[si]) : null, north = ni >= 0 ? num(r[ni]) : null;
        if (Number.isNaN(south) || Number.isNaN(north)) throw new Error(`${day}: units must be numbers`);
        if (south != null || north != null) out.push({ day, south, north });
      }
      const inMonth = out.filter((x) => x.day.startsWith(period.slice(0, 7)));
      if (!inMonth.length) throw new Error(`No ${monLabel(period)} days with numbers in ${f.name}`);
      setPreview(inMonth);
    } catch (e) { setPreview(null); setErr(e instanceof Error ? e.message : "Couldn't read the file"); }
  }

  const save = () => start(async () => {
    const r = await uploadLiquidationActuals(period, preview!);
    if (!r.ok) return toast(r.error, "error");
    toast(r.message ?? "Saved", "success"); setPreview(null); router.refresh();
  });

  const shown = preview ?? cur;
  const tot = shown.reduce((a, x) => ({ s: a.s + (x.south ?? 0), n: a.n + (x.north ?? 0) }), { s: 0, n: 0 });
  return (
    <Card>
      <CardHeader title="Liquidation actuals · gatepass upload" subtitle={`Day-wise South / North units from gatepasses${ownerName ? ` · uploaded by ${ownerName}` : ""} · feeds S&OP › Liquidation`}
        action={<div className="flex items-center gap-2">
          <select className="field h-8 w-auto py-0 text-[12.5px]" value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); setErr(null); }}>
            {months.map((m) => <option key={m} value={m}>{monLabel(m)}</option>)}
          </select>
          <Button size="sm" onClick={download}><Download size={13} />Template</Button>
          <Button size="sm" variant="primary" onClick={() => file.current?.click()}><Upload size={13} />Upload filled</Button>
          <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
        </div>} />
      <div className="p-4">
        {err && <p className="mb-3 rounded-md bg-bad-soft px-3 py-1.5 text-[12.5px] text-bad">{err}</p>}
        {preview && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info">
            <span><b>{preview.length}</b> days ready · South {fmt(tot.s)} · North {fmt(tot.n)} units — replaces what is saved for these days.</span>
            <span className="ml-auto flex gap-2"><Button size="xs" variant="ghost" onClick={() => setPreview(null)}>Discard</Button><Button size="xs" variant="primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button></span>
          </div>
        )}
        {shown.length ? (
          <div className="max-h-[280px] overflow-y-auto rounded-lg border border-line">
            <table className="table-base">
              <thead className="sticky top-0 bg-surface"><tr><th>Date</th><th className="text-right">South</th><th className="text-right">North</th><th className="text-right">Total</th></tr></thead>
              <tbody>{shown.map((x) => (
                <tr key={x.day} className={cn(preview && "bg-info-soft/30")}>
                  <td className="tabular">{Number(x.day.slice(8))} {new Date(`${x.day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", month: "short", timeZone: "UTC" })}</td>
                  <td className="text-right tabular">{fmt(x.south)}</td><td className="text-right tabular">{fmt(x.north)}</td>
                  <td className="text-right font-semibold tabular">{fmt((x.south ?? 0) + (x.north ?? 0))}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="bg-subtle font-semibold"><td>{preview ? "To save" : "Saved"}</td><td className="text-right tabular">{fmt(tot.s)}</td><td className="text-right tabular">{fmt(tot.n)}</td><td className="text-right tabular">{fmt(tot.s + tot.n)}</td></tr></tfoot>
            </table>
          </div>
        ) : <p className="text-[12.5px] text-ink-3">Nothing uploaded for {monLabel(period)} yet — download the template, fill the gatepass units per day, upload.</p>}
      </div>
    </Card>
  );
}
