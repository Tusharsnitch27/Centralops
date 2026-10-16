"use client";
import Link from "next/link";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowUpRight, Wallet } from "lucide-react";
import { inr, pct } from "@/lib/format";
import { fmtMonth } from "@/lib/dates";

/** Dark feature tile: YTD opex vs budget with gradient monthly bars. */
export function HeroSpend({ title, ytdActual, variance, variancePct, projection, fyPlan, lastClosed, labels, trend, cost }: {
  title: string; ytdActual: number; variance: number; variancePct: number; projection: number; fyPlan: number; lastClosed: string; cost: boolean;
  labels: { plan: string; actual: string; forecast: string }; trend: { period: string; plan: number; actual: number | null }[];
}) {
  const bad = cost ? variance > 0 : variance < 0;
  const data = trend.filter((t) => t.plan || t.actual).map((t) => ({ m: fmtMonth(t.period, false), plan: t.plan, actual: t.actual ?? 0, closed: t.period <= lastClosed }));
  return (
    <div className="hero flex flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-white/80"><Wallet size={15} className="text-white/60" />{title}</span>
        <Link href="/aop" className="flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-white/20">Open AOP <ArrowUpRight size={13} /></Link>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular text-white">{inr(ytdActual)}</span>
        <span className={bad ? "rounded-full bg-[#ff6b6b]/20 px-2.5 py-1 text-[12.5px] font-semibold text-[#ffb3b3]" : "rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-white"}
          style={bad ? undefined : { background: "color-mix(in srgb, var(--color-accent) 50%, transparent)" }}>
          {pct(variancePct, 1, true)} vs {labels.plan.toLowerCase()}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-white/55">
        {labels.actual} YTD through {fmtMonth(lastClosed)} · <b className="font-semibold text-white/85">{inr(Math.abs(variance))} {bad ? "over" : "under"}</b> · FY projection <b className="font-semibold text-white/85">{inr(projection)}</b> of {inr(fyPlan)}
      </div>
      <div className="mt-5 h-[150px]">
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="heroAct" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-accent-2)" /><stop offset="100%" stopColor="var(--color-accent)" /></linearGradient>
            </defs>
            <XAxis dataKey="m" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: "rgba(255,255,255,0.5)", fontWeight: 500 }} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={{ borderRadius: 12, border: "none", background: "#fff", fontSize: 12.5, boxShadow: "0 10px 30px -10px rgba(0,0,0,.4)" }}
              formatter={(v, n) => [inr(Number(v)), n === "plan" ? labels.plan : labels.actual]} />
            <Bar isAnimationActive={false} dataKey="plan" radius={[5, 5, 0, 0]} maxBarSize={14} fill="rgba(255,255,255,0.16)" />
            <Bar isAnimationActive={false} dataKey="actual" radius={[5, 5, 0, 0]} maxBarSize={14}>
              {data.map((d, i) => <Cell key={i} fill={d.closed ? "url(#heroAct)" : "rgba(255,255,255,0.3)"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
