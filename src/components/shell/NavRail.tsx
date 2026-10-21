"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { LogoMark } from "./Logo";

type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
export const navIcon = (name: string) => ((Icons as unknown as Record<string, IconCmp>)[name] ?? Icons.Circle) as IconCmp;
export const isNavActive = (path: string, href: string, match: string[] = []) => (href === "/" ? path === "/" : [href, ...match].some((h) => path === h || path.startsWith(`${h}/`)));

/** Desktop sidebar: quiet, flat, monochrome icons; the active item gets a white chip and the accent. */
export function NavRail({ counts, user }: { counts: Record<string, number>; user: { name: string; title: string | null } }) {
  const path = usePathname();
  const Item = ({ href, label, icon, count, alert, match }: { href: string; label: string; icon: string; count?: number; alert?: boolean; match?: string[] }) => {
    const Icon = navIcon(icon);
    const on = isNavActive(path, href, match);
    return (
      <Link href={href} prefetch={false}
        className={cn("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
          on ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgb(20_20_18/0.06)] ring-1 ring-line" : "font-medium text-ink-3 hover:bg-surface/70 hover:text-ink")}>
        <Icon size={16} strokeWidth={on ? 2.2 : 1.8} className={on ? "text-accent" : "text-ink-4"} />
        <span className="flex-1 truncate">{label}</span>
        {!!count && <span className={cn("min-w-[20px] rounded-md px-1.5 text-center text-[11px] font-semibold tabular", alert ? "bg-bad-soft text-bad" : "bg-muted text-ink-3")}>{count}</span>}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh print:!hidden w-[220px] shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1.5">
        <LogoMark size={30} />
        <span className="leading-tight">
          <span className="block text-[14px] font-semibold tracking-[-0.01em] text-ink">Central Ops</span>
          <span className="block text-[11px] text-ink-4">Program Manager 2.0</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto [scrollbar-width:none]">
        {NAV.map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => <Item key={it.href} href={it.href} label={it.label} icon={it.icon} match={it.match} count={it.countKey ? counts[it.countKey] ?? 0 : 0} alert={it.countKey === "overdue"} />)}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-line pt-3">
        <Item href="/settings" label="Settings" icon="Settings2" />
        <form action="/api/auth/logout" method="post" className="flex items-center gap-2.5 rounded-lg px-1.5 py-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-white">{user.name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[12.5px] font-semibold text-ink">{user.name}</span>
            <span className="block truncate text-[11px] text-ink-4">{user.title}</span>
          </span>
          <button className="rounded-md p-1.5 text-ink-4 hover:bg-surface hover:text-ink" title="Sign out"><Icons.LogOut size={14} /></button>
        </form>
      </div>
    </aside>
  );
}

/** Phone / tablet: fixed bottom tab bar with the primary sections. */
export function BottomNav({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  const items = NAV.flatMap((g) => g.items);
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-line bg-surface/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto grid max-w-[560px]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const Icon = navIcon(it.icon);
          const on = isNavActive(path, it.href, it.match);
          const n = it.countKey ? counts[it.countKey] ?? 0 : 0;
          return (
            <Link key={it.href} href={it.href} prefetch={false} className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[10.5px]", on ? "font-semibold text-ink" : "font-medium text-ink-4")}>
              {on && <span className="absolute inset-x-5 top-0 h-[2px] rounded-b-full bg-accent" />}
              <span className="relative">
                <Icon size={19} strokeWidth={on ? 2.2 : 1.8} className={on ? "text-accent" : undefined} />
                {n > 0 && <span className={cn("absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-semibold leading-[16px] tabular text-white", it.countKey === "overdue" ? "bg-bad" : "bg-ink-3")}>{n > 99 ? "99+" : n}</span>}
              </span>
              {it.short ?? it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
