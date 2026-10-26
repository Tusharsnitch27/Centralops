import { cn } from "@/lib/cn";

const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Utilisation chip: green near plan, amber drifting, red far off; grey when nothing was planned. */
export function UtilChip({ u, plan, actual, strong }: { u: number | null; plan: number; actual: number; strong?: boolean }) {
  if (plan === 0) return actual > 0 ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-semibold text-warn">Unplanned</span> : <span className="text-ink-4">—</span>;
  const v = u ?? 0;
  const cls = v >= 1.5 ? "bg-bad text-white" : v > 1.2 ? "bg-bad-soft text-bad" : v >= 0.8 ? "bg-accent-soft text-accent-ink" : v > 0.5 ? "bg-bad-soft text-bad" : "bg-bad text-white";
  return <span className={cn("inline-block min-w-[52px] rounded-full px-2 py-0.5 text-center text-[12px] font-semibold tabular", cls, strong && "ring-2 ring-white")}>{pc(u)}</span>;
}
