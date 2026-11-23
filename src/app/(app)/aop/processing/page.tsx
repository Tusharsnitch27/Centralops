import { Fragment } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { AopHeader } from "@/components/aop/AopNav";
import { cpi, n0, n1, Pickers } from "@/components/aop/processing/bits";
import { requireUser } from "@/server/auth";
import { processingMonths } from "@/components/aop/processing/months";
import { listCycles, resolveCycle } from "@/server/aop/model";
import { processingMonth } from "@/server/aop/processing";
import { type Wh } from "@/server/aop/processingTypes";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "AOP · Processing" };

type SP = { month?: string; wh?: string; cycle?: string };

/** AOP › Processing: actual output, heads the output needed at IPP vs current heads, actual cost per item — per stream × process. */
export default async function ProcessingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireUser();
  const [cycles, cycle, months] = await Promise.all([listCycles(), resolveCycle(sp.cycle), processingMonths()]);
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  const wh = sp.wh === "South" || sp.wh === "North" ? sp.wh : "Both";
  const whs: Wh[] = wh === "Both" ? ["South", "North"] : [wh];
  const href = (o: { month?: string; wh?: string }) =>
    `/aop/processing?${new URLSearchParams(Object.entries({ cycle: cycles.length > 1 ? cycle?.id : undefined, month, wh, ...o }).filter(([, v]) => v) as [string, string][])}`;

  const header = <AopHeader active="processing" cycleId={cycle?.id ?? null} cycles={cycles} title="Processing"
    actions={<Link href="/aop/processing/daily" className="rounded-md px-2 py-1 text-[12.5px] font-medium ring-1 ring-inset ring-line hover:bg-subtle">Daily planner →</Link>} />;
  if (!month) return <div className="animate-fade-in">{header}<div className="card"><EmptyState title="No processing data yet" /></div></div>;

  const pm = await Promise.all(whs.map((w) => processingMonth(month, w)));
  const days = pm.find((m) => m.actualDays)?.actualDays ?? null;
  const sum = (f: (m: (typeof pm)[number]) => number | null) => (pm.some((m) => f(m) != null) ? pm.reduce((a, m) => a + (f(m) ?? 0), 0) : null);
  const cur = sum((m) => m.totals.actualMp), need = sum((m) => m.totals.needMp);
  const curExp = sum((m) => m.totals.actualExp), needExp = sum((m) => m.totals.needExp);
  // forward cost per item = forward streams' actual ₹ ÷ their output over the same days (each stream's cost per item × its output, Σ over streams)
  const fwd = pm.flatMap((m) => m.streams).filter((s) => s.dept.endsWith("Forward") && s.actualCpi != null && s.finalOutput);
  const fwdExp = fwd.reduce((a, s) => a + s.actualCpi! * s.finalOutput!, 0), fwdOut = fwd.reduce((a, s) => a + s.finalOutput!, 0);
  const fwdStd = fwd.reduce((a, s) => a + (s.idealCpi ?? 0) * s.finalOutput!, 0);
  const basis = days ? `${days.days} of ${days.of} days, through yesterday` : "full month";

  return (
    <div className="animate-fade-in">
      {header}
      <Pickers months={months} month={month} wh={wh} href={href} />

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Current heads" value={n0(cur)} sub={`${inr(curExp)} · ${basis}`} />
        <Tile label="Heads needed for actual output" value={n0(need)} sub={`${inr(needExp)} at IPP`} />
        <Tile label="Excess heads" value={cur != null && need != null ? n0(cur - need) : "—"} tone={cur != null && need != null ? (cur - need > 0 ? "text-bad" : "text-ok") : undefined}
          sub={curExp != null && needExp != null ? `${inr(curExp - needExp, { sign: true })} over need` : undefined} />
        <Tile label="Forward cost per item" value={fwdOut ? cpi(fwdExp / fwdOut) : "—"} sub={fwdOut ? `standard ${cpi(fwdStd / fwdOut)} at IPP · ${n0(fwdOut)} items` : undefined} />
      </div>

      <div className="space-y-3">
        {pm.map((m) => (
          <div key={m.warehouse} className="card overflow-x-auto">
            <div className="border-b border-line bg-subtle px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">{m.warehouse === "South" ? "South · YLK 1 & 2" : "North · Tauru"}</div>
            <table className="table-base min-w-[960px]">
              <thead><tr><th>Process</th><th className="text-right">IPP / head / day</th><th className="text-right">Output</th><th className="text-right">Heads needed</th><th className="text-right">Current heads</th>
                <th className="text-right">Excess</th><th className="text-right">Actual ₹</th><th className="text-right">₹ / item</th><th className="text-right">Standard ₹ / item</th></tr></thead>
              <tbody>{m.streams.map((s) => (
                <Fragment key={s.stream}>
                  <tr className="bg-subtle/70 font-semibold"><td>{s.stream}</td><td /><td className="text-right tabular">{n0(s.finalOutput)}</td>
                    <td className="text-right tabular">{n0(s.needMp)}</td><td className="text-right tabular">{n1(s.actualMp)}</td><Gap a={s.actualMp} n={s.needMp} />
                    <td className="text-right tabular">{inr(s.actualExp)}</td><Cpi a={s.actualCpi} std={s.idealCpi} /><td className="text-right tabular text-ink-3">{cpi(s.idealCpi)}</td></tr>
                  {s.rows.map((r) => (
                    <tr key={r.process}><td className="pl-6 text-ink-2">{r.process}</td><td className="text-right tabular text-ink-3">{n0(r.targetPerDay)}</td><td className="text-right tabular text-ink-3">{n0(r.finalOutput)}</td>
                      <td className="text-right tabular">{n0(r.needMp)}</td><td className="text-right tabular">{n1(r.actualMp)}</td><Gap a={r.actualMp} n={r.needMp} />
                      <td className="text-right tabular">{inr(r.actualExp)}</td><Cpi a={r.actualCpi} std={r.idealCpi} /><td className="text-right tabular text-ink-3">{cpi(r.idealCpi)}</td></tr>
                  ))}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gap({ a, n }: { a: number | null; n: number | null }) {
  if (a == null || n == null) return <td className="text-right text-ink-4">—</td>;
  const d = a - n;
  return <td className={cn("text-right tabular", Math.abs(d) < 0.5 ? "text-ink-3" : d > 0 ? "text-bad" : "text-ok")}>{d > 0 ? "+" : d < 0 ? "−" : ""}{n1(Math.abs(d))}</td>;
}

function Cpi({ a, std }: { a: number | null; std: number | null }) {
  // ₹0 = no heads booked to the line (e.g. B2B MP returns sit with store returns): not a cost per item
  return <td className={cn("text-right tabular", a != null && std != null && a > std * 1.1 && "text-bad")}>{a ? cpi(a) : "—"}</td>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={cn("text-[20px] font-semibold leading-tight tabular", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
