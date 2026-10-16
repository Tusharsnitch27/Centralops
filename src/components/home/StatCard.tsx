import Link from "next/link";
import { cn } from "@/lib/cn";

/** Minimal stat tile: quiet label, number, one status line, and a hairline sparkline (desktop only). */
export function StatCard({ label, value, href, badge, badgeTone = "accent", bars, icon, foot }: {
  label: string; value: React.ReactNode; href: string; badge?: string; badgeTone?: "accent" | "bad" | "warn" | "muted";
  bars?: number[]; icon?: React.ReactNode; foot?: string;
}) {
  const recent = bars?.slice(-10) ?? [];
  const max = Math.max(1, ...recent);
  const tone = badgeTone === "bad" ? "text-bad" : badgeTone === "warn" ? "text-warn" : badgeTone === "muted" ? "text-ink-4" : "text-accent-ink";
  return (
    <Link href={href} title={foot} className="card group flex min-w-0 flex-col gap-3 p-4 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        {icon && <span className="shrink-0 text-ink-4">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] tabular text-ink">{value}</div>
        {bars && (
          <div className="hidden h-6 items-end gap-[2px] sm:flex">
            {recent.map((b, i) => (
              <span key={i} className="w-[3px] rounded-full" style={{ height: `${Math.max(14, (b / max) * 100)}%`, background: b ? "var(--color-accent)" : "var(--color-muted)", opacity: b ? 0.85 : 1 }} />
            ))}
          </div>
        )}
      </div>
      <div className={cn("truncate text-[11.5px] font-medium", badge ? tone : "text-ink-4")}>{badge ?? foot}</div>
    </Link>
  );
}
