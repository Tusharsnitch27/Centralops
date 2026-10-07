// Server component: clickable 5×5 heat map (probability × impact). Clicking a cell filters the register.
import Link from "next/link";
import { cn } from "@/lib/cn";
import { riskLevelKey } from "@/server/risks/meta";

const CELL: Record<string, string> = {
  critical: "bg-bad-soft text-bad ring-bad/20",
  high: "bg-warn-soft text-warn ring-warn/20",
  medium: "bg-info-soft/70 text-info ring-info/15",
  low: "bg-subtle text-ink-3 ring-line",
};

export function RiskMatrix({ counts, selected, hrefFor }: { counts: { probability: number; impact: number; n: number }[]; selected?: { p: number; i: number } | null; hrefFor: (p: number, i: number) => string }) {
  const get = (p: number, i: number) => counts.find((c) => c.probability === p && c.impact === i)?.n ?? 0;
  return (
    <div className="flex gap-2">
      <div className="flex w-4 items-center justify-center"><span className="-rotate-90 text-[10.5px] tracking-wide whitespace-nowrap text-ink-4 uppercase">Probability</span></div>
      <div className="flex-1">
        <div className="grid grid-cols-[14px_repeat(5,1fr)] gap-1">
          {[5, 4, 3, 2, 1].map((p) => (
            <div key={p} className="contents">
              <span className="flex items-center justify-center text-[10.5px] tabular text-ink-4">{p}</span>
              {[1, 2, 3, 4, 5].map((i) => {
                const n = get(p, i);
                const lvl = riskLevelKey(p * i);
                const on = selected?.p === p && selected?.i === i;
                return (
                  <Link key={i} href={hrefFor(p, i)} scroll={false} title={`P${p} × I${i} = ${p * i}${n ? ` · ${n} risk${n === 1 ? "" : "s"}` : ""}`}
                    className={cn("flex aspect-[1.5] items-center justify-center rounded-md text-[13px] font-medium tabular ring-1 ring-inset transition-all hover:brightness-95",
                      n ? CELL[lvl] : "bg-surface text-transparent ring-line/70 hover:text-ink-4",
                      on && "ring-2 ring-ink", selected && !on && "opacity-50")}>
                    {n || p * i}
                  </Link>
                );
              })}
            </div>
          ))}
          <span />
          {[1, 2, 3, 4, 5].map((i) => <span key={i} className="pt-0.5 text-center text-[10.5px] tabular text-ink-4">{i}</span>)}
        </div>
        <div className="mt-0.5 text-center text-[10.5px] tracking-wide text-ink-4 uppercase">Impact</div>
      </div>
    </div>
  );
}
