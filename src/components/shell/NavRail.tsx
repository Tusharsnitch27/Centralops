"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { LogoMark } from "./Logo";

type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** Vertical navigation panel (sits on the right edge; flip `side` in the app layout to move it). */
export function NavRail({ counts, user }: { counts: Record<string, number>; user: { name: string; title: string | null } }) {
  const path = usePathname();
  const isActive = (href: string, match: string[] = []) => (href === "/" ? path === "/" : [href, ...match].some((h) => path === h || path.startsWith(`${h}/`)));
  const Item = ({ href, label, icon, count, alert, match, hue = "#64748b" }: { href: string; label: string; icon: string; count?: number; alert?: boolean; match?: string[]; hue?: string }) => {
    const Icon = ((Icons as unknown as Record<string, IconCmp>)[icon] ?? Icons.Circle) as IconCmp;
    const on = isActive(href, match);
    return (
      <Link href={href} prefetch={false}
        className={cn("group relative flex h-12 items-center gap-3 rounded-2xl px-2.5 text-[14px] font-semibold transition-all", on ? "bg-white text-ink shadow-[0_1px_2px_rgb(17_18_20/0.05),0_10px_24px_-14px_rgb(17_18_20/0.35)] ring-1 ring-line" : "text-ink-3 hover:bg-white/70 hover:text-ink")}>
        {on && <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full" style={{ background: hue }} />}
        <span className="flex size-9 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
          style={on
            ? { background: `linear-gradient(135deg, ${hue}, color-mix(in srgb, ${hue} 55%, white))`, color: "#fff", boxShadow: `0 8px 16px -8px ${hue}` }
            : { background: `color-mix(in srgb, ${hue} 12%, white)`, color: hue }}>
          <Icon size={17} strokeWidth={2.1} />
        </span>
        <span className="flex-1 truncate">{label}</span>
        {!!count && <span className="min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular" style={alert ? { background: "var(--color-bad)", color: "#fff" } : { background: `color-mix(in srgb, ${hue} 14%, white)`, color: `color-mix(in srgb, ${hue} 80%, black)` }}>{count}</span>}
      </Link>
    );
  };
  return (
    <aside className="sticky top-3 mt-3 hidden h-[calc(100dvh-24px)] self-start w-[240px] shrink-0 flex-col rounded-[24px] border border-white p-3 shadow-[0_1px_2px_rgb(17_18_20/0.04),0_14px_36px_-16px_rgb(17_18_20/0.18)] backdrop-blur-xl lg:flex" style={{ background: "linear-gradient(180deg, rgb(255 255 255 / 0.95), color-mix(in srgb, var(--color-subtle) 85%, white))" }}>
      <Link href="/" className="mb-4 flex items-center gap-3 rounded-2xl p-2">
        <LogoMark size={42} />
        <span className="leading-tight">
          <span className="block text-[16px] font-extrabold tracking-[-0.025em] text-ink">Central Ops</span>
          <span className="block text-[11.5px] font-medium text-ink-3">Program Manager 2.0</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto [scrollbar-width:none]">
        {NAV.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-4">{g.label}</div>
            <div className="space-y-1">
              {g.items.map((it) => <Item key={it.href} href={it.href} label={it.label} icon={it.icon} match={it.match} hue={it.hue} count={it.countKey ? counts[it.countKey] ?? 0 : 0} alert={it.countKey === "overdue"} />)}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-line pt-3">
        <Item href="/settings" label="Settings" icon="SlidersHorizontal" hue="#64748b" />
        <form action="/api/auth/logout" method="post" className="flex items-center gap-2.5 rounded-2xl bg-subtle p-2.5">
          <span className="flex size-9 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: "linear-gradient(135deg, var(--color-ink-2), var(--color-ink))" }}>{user.name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold text-ink">{user.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{user.title}</span>
          </span>
          <button className="rounded-lg p-1.5 text-ink-4 hover:bg-white hover:text-ink" title="Sign out"><Icons.LogOut size={15} /></button>
        </form>
      </div>
    </aside>
  );
}
