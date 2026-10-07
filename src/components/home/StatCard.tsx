import Link from "next/link";
import { cn } from "@/lib/cn";

/** Bento stat card: label, bold number, optional badge, and a mini bar chart. */
export function StatCard({ label, value, href, badge, badgeTone = "accent", bars, icon, foot }: {
  label: string; value: React.ReactNode; href: string; badge?: string; badgeTone?: "accent" | "bad" | "warn" | "muted";
  bars?: number[]; icon?: React.ReactNode; foot?: string;
}) {
  const max = Math.max(1, ...(bars ?? [1]));
  return (
    <Link href={href} className="card group flex flex-col justify-between gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-18px_rgb(17_18_20/0.25)]">
      <div className="flex items-center gap-2 whitespace-nowrap text-[13.5px] font-semibold text-ink-2">
        {icon && <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3" title={foot}>
        <div>
          <div className="text-[34px] font-extrabold leading-none tracking-[-0.04em] tabular text-ink">{value}</div>
          {badge && (
            <span className={cn("mt-2 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", badgeTone === "bad" ? "bg-bad-soft text-bad" : badgeTone === "warn" ? "bg-warn-soft text-warn" : badgeTone === "muted" ? "bg-subtle text-ink-3" : "bg-accent-soft text-accent-ink")}>{badge}</span>
          )}
          {foot && !badge && <div className="mt-1.5 text-[12px] font-medium text-ink-3">{foot}</div>}
        </div>
        {bars && (
          <div className="flex h-10 items-end gap-[3px]">
            {bars.map((b, i) => (
              <span key={i} className="w-[5px] rounded-full transition-all group-hover:opacity-100"
                style={{ height: `${Math.max(12, (b / max) * 100)}%`, background: b ? "linear-gradient(180deg, var(--color-accent-2), var(--color-accent))" : "var(--color-muted)", opacity: i >= bars.length - 7 ? 1 : 0.55 }} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
