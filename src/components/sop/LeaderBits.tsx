import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Problem } from "@/server/sop/brief";
import type { DailyView, DaySeries } from "@/server/sop/daily";
import { cn } from "@/lib/cn";

const TYPE_TONE: Record<string, string> = {
  "Monthly miss": "bg-bad-soft text-bad", "Day-to-day swings": "bg-violet-soft text-violet", "Unplanned volume": "bg-warn-soft text-warn",
  "Warehouse skew": "bg-info-soft text-info", Capacity: "bg-bad-soft text-bad", "Data gap": "bg-subtle text-ink-3",
};

export function ProblemsList({ items, max = 6 }: { items: Problem[]; max?: number }) {
  if (!items.length) return <div className="card px-4 py-6 text-center text-[13px] text-ok">Nothing off plan beyond the thresholds — all flows within ±20% and no capacity alerts.</div>;
  return (
    <div className="card divide-y divide-line/70 overflow-hidden">
      {items.slice(0, max).map((p, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", p.tone === "bad" ? "bg-bad" : p.tone === "warn" ? "bg-warn" : "bg-ink-4")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.04em]", TYPE_TONE[p.type])}>{p.type}</span>
              <span className="text-[13px] font-semibold text-ink">{p.title}</span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-ink-3">{p.detail}</p>
          </div>
          {p.href && <Link href={p.href} className="shrink-0 self-center text-ink-4 hover:text-ink" aria-label="Open"><ArrowRight size={14} /></Link>}
        </div>
      ))}
    </div>
  );
}

const cell = (dev: number | null, plan: number, actual: number) => {
  if (plan <= 0) return actual > 0 ? "bg-warn" : "bg-muted";
  const d = dev ?? 0;
  if (d > 0.4) return "bg-[#2563eb]"; if (d > 0.2) return "bg-[#93b4f5]";
  if (d < -0.4) return "bg-bad"; if (d < -0.2) return "bg-[#f1a3a3]";
  return "bg-ok/70";
};
const fmt = (v: number) => new Intl.NumberFormat("en-IN").format(Math.round(v));

function Strip({ s }: { s: DaySeries }) {
  return (
    <div className="flex gap-[2px]">
      {s.days.map((d) => (
        <span key={d.day} title={`${d.day.slice(8)}: plan ${fmt(d.plan)}, actual ${fmt(d.actual)}${d.dev != null ? ` (${d.dev > 0 ? "+" : ""}${Math.round(d.dev * 100)}%)` : d.actual > 0 ? " — no plan" : ""}`}
          className={cn("h-5 w-[14px] shrink-0 rounded-[3px]", cell(d.dev, d.plan, d.actual))} />
      ))}
    </div>
  );
}

/** Day-by-day plan vs actual: one coloured square per day; counts of days beyond ±20%. */
export function DailyGrid({ views }: { views: DailyView[] }) {
  const days = views[0]?.total.days ?? [];
  if (!days.length) return null;
  const Row = ({ name, s, sub }: { name: string; s: DaySeries; sub?: boolean }) => (
    <tr className={cn(sub && "text-ink-3")}>
      <td className={cn("whitespace-nowrap", sub ? "pl-6 text-[12px]" : "font-medium")}>{name}</td>
      <td><Strip s={s} /></td>
      <td className="text-right tabular text-[#2563eb]">{s.up || "—"}</td>
      <td className="text-right tabular text-bad">{s.down || "—"}</td>
      <td className="text-right tabular text-ok">{s.ok || "—"}</td>
      <td className="text-right text-[11.5px] text-ink-4">{s.basis}</td>
    </tr>
  );
  return (
    <div className="card overflow-x-auto">
      <table className="table-base min-w-[880px]">
        <thead><tr><th>Flow</th><th>
          <span className="flex gap-[2px]">{days.map((d) => <span key={d.day} className="w-[14px] text-center text-[9.5px] font-normal">{Number(d.day.slice(8))}</span>)}</span>
        </th><th className="text-right">Above</th><th className="text-right">Below</th><th className="text-right">On plan</th><th className="text-right">Plan basis</th></tr></thead>
        <tbody>{views.map((v) => [
          <Row key={v.key} name={v.title} s={v.total} />,
          ...v.rows.map((r) => <Row key={`${v.key}${r.label}`} name={r.label} s={r.series} sub />),
        ])}</tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2 text-[11.5px] text-ink-4">
        {[["bg-ok/70", "within ±20%"], ["bg-[#93b4f5]", "20–40% above"], ["bg-[#2563eb]", ">40% above"], ["bg-[#f1a3a3]", "20–40% below"], ["bg-bad", ">40% below"], ["bg-warn", "volume with no plan"], ["bg-muted", "no plan, no volume"]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1"><span className={cn("h-3 w-3 rounded-[2px]", c)} />{l}</span>
        ))}
        <span>· hover a square for plan vs actual</span>
      </div>
    </div>
  );
}
