// Server-safe display bits for AOP › Processing / Analysis.
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/format";

/** ₹ per item: two decimals (CPIs are small). */
export const cpi = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `₹${v.toFixed(2)}`);
export const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("en-IN").format(Math.round(v)));
export const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v));
export const monLabel = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Collapsible section with a dark high-contrast bar; native <details> so it works without JS and can start open. */
export function Section({ title, sub, summary, open, children }: { title: ReactNode; sub?: ReactNode; summary?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group card overflow-hidden">
      <summary className="bar-dark flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 md:px-5">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <ChevronRight size={15} className="shrink-0 text-white/70 transition-transform group-open:rotate-90" />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold text-white">{title}</span>
            {sub && <span className="block text-[11.5px] text-white/65">{sub}</span>}
          </span>
        </span>
        {summary && <span className="flex flex-wrap items-center gap-x-3 text-[12px]">{summary}</span>}
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

/** Adherence as a chip: within ±10% green, ±20% amber, beyond red. */
export function AdhChip({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-ink-4">—</span>;
  const d = Math.abs(v - 1);
  const t = d <= 0.1 ? "bg-ok-soft text-ok" : d <= 0.2 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";
  return <span className={cn("inline-flex h-[20px] items-center rounded-md px-1.5 text-[11.5px] font-medium tabular", t)}>{pct(v)}</span>;
}

/** Favourable = green, adverse = red (₹ impact, + = favourable). */
export const impactTone = (v: number | null | undefined) => (v == null || Math.abs(v) < 1 ? "text-ink-3" : v > 0 ? "text-ok" : "text-bad");

/** Hoverable split bar with the total beside it. */
export function SplitBar({ parts, total, fmt }: { parts: { label: string; value: number }[]; total?: number; fmt: (v: number) => string }) {
  const t = total ?? parts.reduce((a, p) => a + p.value, 0);
  const shades = ["bg-ink/80", "bg-ink/55", "bg-ink/35", "bg-ink/20", "bg-ink/10"];
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-2 w-40 overflow-hidden rounded-full bg-muted">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <span key={p.label} title={`${p.label} · ${fmt(p.value)} · ${t ? pct(p.value / t) : "—"}`} className={cn("h-full hover:opacity-70", shades[i % shades.length])} style={{ width: `${t ? (p.value / t) * 100 : 0}%` }} />
        ))}
      </span>
      <span className="tabular text-[12px] font-medium">{fmt(t)}</span>
    </span>
  );
}

/** Month chips + warehouse segment, as links. */
export function Pickers({ months, month, wh, href }: { months: string[]; month: string; wh: string; href: (o: { month?: string; wh?: string }) => string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="seg">
        <span className="seg-label">Warehouse</span>
        {["Both", "South", "North"].map((w) => <Link key={w} href={href({ wh: w })} data-on={wh === w} className="seg-item">{w}</Link>)}
      </div>
      <div className="ml-auto flex flex-wrap gap-1">
        {months.slice(0, 13).map((m) => (
          <Link key={m} href={href({ month: m })} className={cn("rounded-md px-2 py-1 text-[12px]", m === month ? "bg-ink text-white" : "text-ink-3 ring-1 ring-inset ring-line hover:text-ink")}>{monLabel(m)}</Link>
        ))}
      </div>
    </div>
  );
}
