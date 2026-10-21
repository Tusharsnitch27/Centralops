import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { requireSopOverview } from "@/server/sop/access";
import { DETAIL_VIEWS, detailedDaily, type DetailDay, type DetailKey } from "@/server/sop/detailed";
import { reviewPeriods } from "@/server/sop/monthly";
import { currentPeriod } from "@/server/sop/model";
import { today } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "S&OP · Detailed" };

const fmt = (v: number) => (v ? new Intl.NumberFormat("en-IN").format(Math.round(v)) : "—");
const mon = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const dow = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
const BAND = 0.2;

/** Read-only, day-on-day plan vs actual for one function: pick Outbound / Inward, the function, the month (and a channel). */
export default async function SopDetailed({ searchParams }: { searchParams: Promise<{ flow?: string; f?: string; p?: string; l?: string }> }) {
  await requireSopOverview();
  const sp = await searchParams;
  const flow = sp.flow === "inward" ? "inward" : "outbound";
  const views = DETAIL_VIEWS.filter((v) => v.flow === flow);
  const view = views.find((v) => v.key === sp.f) ?? views[0]!;
  const cur = currentPeriod(today());
  const months = [...new Set([cur, ...(await reviewPeriods())])].sort().reverse();
  const period = sp.p && months.includes(sp.p) ? sp.p : months.find((m) => m <= cur) ?? cur;
  const d = await detailedDaily(view.key as DetailKey, period, sp.l ?? null);
  const href = (o: Partial<Record<"flow" | "f" | "p" | "l", string | null>>) => {
    const x = { flow, f: view.key, p: period, l: d.label, ...o };
    return `/sop/detailed?${new URLSearchParams(Object.entries(x).filter(([, v]) => v) as [string, string][]).toString()}`;
  };

  const past = d.days.filter((x) => !x.future);
  const judged = past.filter((x) => x.sp + x.np > 0);
  const dev = (x: { sp: number; sa: number; np: number; na: number }) => { const p = x.sp + x.np; return p > 0 ? (x.sa + x.na) / p - 1 : null; };
  const above = judged.filter((x) => dev(x)! > BAND).length, below = judged.filter((x) => dev(x)! < -BAND).length;
  const sum = (ds: DetailDay[]) => ds.reduce((a, x) => ({ sp: a.sp + x.sp, sa: a.sa + x.sa, np: a.np + x.np, na: a.na + x.na }), { sp: 0, sa: 0, np: 0, na: 0 });
  const mtd = sum(past), month = sum(d.days);
  const weeks = [...new Set(d.days.map((x) => x.week))];

  return (
    <div className="space-y-4">
      {/* selectors */}
      <div className="card space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg">
            <Link href={`/sop/detailed?flow=outbound&p=${period}`} data-on={flow === "outbound"} className="seg-item gap-1.5"><ArrowUpFromLine size={12} />Outbound</Link>
            <Link href={`/sop/detailed?flow=inward&p=${period}`} data-on={flow === "inward"} className="seg-item gap-1.5"><ArrowDownToLine size={12} />Inward</Link>
          </div>
          <div className="ml-auto flex flex-wrap gap-1">
            {months.slice(0, 8).map((m) => <Link key={m} href={href({ p: m, l: null })} className={cn("rounded-md px-2 py-1 text-[12px]", m === period ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{mon(m)}</Link>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {views.map((v) => <Link key={v.key} href={href({ f: v.key, l: null })} className={cn("rounded-lg px-3 py-1.5 text-[12.5px] font-medium", v.key === view.key ? "bg-info-soft text-info ring-1 ring-inset ring-info/30" : "text-ink-2 ring-1 ring-inset ring-line hover:ring-line-strong")}>{v.title}</Link>)}
        </div>
        {d.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-line pt-3">
            <Link href={href({ l: null })} className={cn("rounded-md px-2 py-0.5 text-[12px]", !d.label ? "bg-ink text-white" : "text-ink-3 hover:bg-subtle")}>All</Link>
            {d.byLabel.map((b) => (
              <Link key={b.label} href={href({ l: b.label })} className={cn("rounded-md px-2 py-0.5 text-[12px]", d.label === b.label ? "bg-ink text-white" : "text-ink-3 hover:bg-subtle")}>
                {b.label}{b.judged ? <span className={cn("ml-1", d.label === b.label ? "text-white/70" : b.off ? "text-bad" : "text-ink-4")}>{b.off}/{b.judged}</span> : null}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* headline */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label={`Plan ${d.through ? `1–${d.through}` : ""}`} value={fmt(mtd.sp + mtd.np)} sub={`${view.unit} · month ${fmt(month.sp + month.np)}`} />
        <Tile label="Actual" value={fmt(mtd.sa + mtd.na)} sub={view.unit} />
        <Tile label="Of plan" value={dev(mtd) == null ? "—" : `${Math.round((dev(mtd)! + 1) * 100)}%`} tone={dev(mtd) != null && Math.abs(dev(mtd)!) > BAND ? "bad" : "ok"} sub={`South ${pct(mtd.sa, mtd.sp)} · North ${pct(mtd.na, mtd.np)}`} />
        <Tile label="Days above +20%" value={String(above)} tone={above ? "info" : undefined} sub={`of ${judged.length} planned days`} />
        <Tile label="Days below −20%" value={String(below)} tone={below ? "bad" : undefined} sub={`plan: ${d.basis}`} />
      </div>
      {!d.hasActuals && <p className="px-1 text-[12px] text-ink-4">No daily actuals for this month yet — they arrive with the Snowflake refresh. The plan is shown day by day.</p>}

      {/* day table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12.5px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-4">
              <th className="px-3 py-2 text-left" rowSpan={2}>Date</th>
              <th className="border-l border-line px-2 pt-2 text-center" colSpan={4}>Total</th>
              <th className="border-l border-line bg-[#e8f0fe] px-2 pt-2 text-center text-[#1e40af]" colSpan={3}>South</th>
              <th className="border-l border-line bg-[#fdf2e3] px-2 pt-2 text-center text-[#9a3412]" colSpan={3}>North</th>
            </tr>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-[0.06em] text-ink-4">
              {["Plan", "Actual", "Variance", "% of plan", "Plan", "Actual", "%", "Plan", "Actual", "%"].map((h, i) => <th key={i} className={cn("px-2 py-1.5 text-right font-medium", [0, 4, 7].includes(i) && "border-l border-line")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const wd = d.days.filter((x) => x.week === w);
              return [
                ...wd.map((x) => <DayRow key={x.day} x={x} />),
                <SumRow key={`w-${w}`} label={`${w.replace(/_/g, " ")} summary`} x={sum(wd.filter((y) => !y.future))} sub />,
              ];
            })}
          </tbody>
          <tfoot>
            <SumRow label={d.through && d.through < d.days.length ? `Month to date (1–${d.through})` : "Month"} x={mtd} />
          </tfoot>
        </table>
        <div className="flex flex-wrap gap-3 border-t border-line px-3 py-2 text-[11.5px] text-ink-4">
          <span>Every number is per day; week rows only add those days up.</span>
          <span><b className="text-[#2563eb]">Blue</b> above +20% · <b className="text-bad">red</b> below −20% · plain within ±20%.</span>
          <span>Plan basis: {d.basis === "daily" ? "day-wise inputs / projection sheet" : d.basis}.</span>
        </div>
      </div>
    </div>
  );
}

function pct(a: number, p: number) { return p > 0 ? `${Math.round((a / p) * 100)}%` : "—"; }
function tone(a: number, p: number) { if (p <= 0) return a > 0 ? "text-warn" : "text-ink-4"; const r = a / p - 1; return r > BAND ? "text-[#2563eb] font-semibold" : r < -BAND ? "text-bad font-semibold" : "text-ink-2"; }

function DayRow({ x }: { x: DetailDay }) {
  const p = x.sp + x.np, a = x.sa + x.na;
  const we = ["Sat", "Sun"].includes(dow(x.day));
  return (
    <tr className={cn("border-b border-line/60", x.future && "text-ink-4", we && !x.future && "bg-subtle/30")}>
      <td className="whitespace-nowrap px-3 py-1.5 tabular">{Number(x.day.slice(8))} <span className="text-[11px] text-ink-4">{dow(x.day)}</span></td>
      <td className="border-l border-line px-2 text-right tabular">{fmt(p)}</td>
      <td className="px-2 text-right tabular font-medium">{x.future ? "" : fmt(a)}</td>
      <td className={cn("px-2 text-right tabular", x.future ? "" : tone(a, p))}>{x.future || (!p && !a) ? "" : `${a - p >= 0 ? "+" : "−"}${fmt(Math.abs(a - p))}`}</td>
      <td className={cn("px-2 text-right tabular", x.future ? "" : tone(a, p))}>{x.future ? "" : p > 0 ? pct(a, p) : a > 0 ? "no plan" : "—"}</td>
      <td className="border-l border-line px-2 text-right tabular text-ink-3">{fmt(x.sp)}</td>
      <td className="px-2 text-right tabular">{x.future ? "" : fmt(x.sa)}</td>
      <td className={cn("px-2 text-right tabular", x.future ? "" : tone(x.sa, x.sp))}>{x.future ? "" : pct(x.sa, x.sp)}</td>
      <td className="border-l border-line px-2 text-right tabular text-ink-3">{fmt(x.np)}</td>
      <td className="px-2 text-right tabular">{x.future ? "" : fmt(x.na)}</td>
      <td className={cn("px-2 text-right tabular", x.future ? "" : tone(x.na, x.np))}>{x.future ? "" : pct(x.na, x.np)}</td>
    </tr>
  );
}

function SumRow({ label, x, sub }: { label: string; x: { sp: number; sa: number; np: number; na: number }; sub?: boolean }) {
  const p = x.sp + x.np, a = x.sa + x.na;
  return (
    <tr className={cn("font-semibold", sub ? "border-b border-line bg-subtle/70 text-[12px]" : "bg-subtle")}>
      <td className="whitespace-nowrap px-3 py-2">{label}</td>
      <td className="border-l border-line px-2 text-right tabular">{fmt(p)}</td>
      <td className="px-2 text-right tabular">{fmt(a)}</td>
      <td className={cn("px-2 text-right tabular", tone(a, p))}>{p || a ? `${a - p >= 0 ? "+" : "−"}${fmt(Math.abs(a - p))}` : ""}</td>
      <td className={cn("px-2 text-right tabular", tone(a, p))}>{pct(a, p)}</td>
      <td className="border-l border-line px-2 text-right tabular">{fmt(x.sp)}</td>
      <td className="px-2 text-right tabular">{fmt(x.sa)}</td>
      <td className={cn("px-2 text-right tabular", tone(x.sa, x.sp))}>{pct(x.sa, x.sp)}</td>
      <td className="border-l border-line px-2 text-right tabular">{fmt(x.np)}</td>
      <td className="px-2 text-right tabular">{fmt(x.na)}</td>
      <td className={cn("px-2 text-right tabular", tone(x.na, x.np))}>{pct(x.na, x.np)}</td>
    </tr>
  );
}

function Tile({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "info" }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={cn("text-[20px] font-semibold tabular leading-tight", t === "ok" ? "text-ok" : t === "bad" ? "text-bad" : t === "info" ? "text-[#2563eb]" : "text-ink")}>{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
