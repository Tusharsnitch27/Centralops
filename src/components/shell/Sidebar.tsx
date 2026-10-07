"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/cn";

type IconName = keyof typeof Icons;

export function Sidebar({ counts, user }: { counts: Record<string, number>; user: { name: string; title: string | null; role: string } }) {
  const path = usePathname();
  const isActive = (href: string, match: string[] = []) =>
    href === "/" ? path === "/" : [href, ...match].some((h) => path === h || path.startsWith(`${h}/`));
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-canvas lg:flex">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="relative flex size-7 items-center justify-center rounded-[8px] bg-ink text-white">
          <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="7.5" opacity=".45" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="font-serif text-[17px] tracking-[-0.01em] text-ink">Central Ops</div>
          <div className="text-[10.5px] text-ink-4">Program Management OS</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 scroll-thin">
        {NAV.map((g) => (
          <div key={g.label} className="mt-4 first:mt-1">
            <div className="mb-1 px-2 font-serif text-[12.5px] text-ink-3">{g.label}</div>
            {g.items.map((it) => {
              const Icon = (Icons[it.icon as IconName] ?? Icons.Circle) as React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
              const active = isActive(it.href, it.match);
              const count = it.countKey ? counts[it.countKey] ?? 0 : 0;
              return (
                <Link key={it.href} href={it.href} prefetch={false}
                  className={cn("group relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                    active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.04)]" : "text-ink-2 hover:bg-subtle hover:text-ink")}>
                  <Icon size={15} strokeWidth={active ? 2.1 : 1.8} className={active ? "text-ink" : "text-ink-3 group-hover:text-ink-2"} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {count > 0 && (
                    <span className={cn("min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-medium tabular",
                      it.countKey === "overdue" ? "bg-bad-soft text-bad" : it.countKey === "inbox" ? "bg-ink text-white" : "bg-warn-soft text-warn")}>{count}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="px-2.5 pb-2">
        <Link href="/settings" prefetch={false} className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors", isActive("/settings") ? "bg-surface font-medium text-ink" : "text-ink-3 hover:bg-subtle hover:text-ink")}>
          <Icons.Settings size={15} strokeWidth={1.8} /> Settings
        </Link>
      </div>
      <div className="border-t border-line p-3">
        <form action="/api/auth/logout" method="post" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-ink-2 text-[11px] font-medium text-white">{user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-medium text-ink">{user.name}</div>
            <div className="truncate text-[11px] text-ink-3">{user.title ?? user.role}</div>
          </div>
          <button className="rounded-md p-1.5 text-ink-4 hover:bg-subtle hover:text-ink" title="Sign out"><Icons.LogOut size={14} /></button>
        </form>
      </div>
    </aside>
  );
}
