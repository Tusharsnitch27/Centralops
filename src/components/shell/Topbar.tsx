"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bell, Plus, Search } from "lucide-react";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { Kbd } from "@/components/ui";
import { Popover } from "@/components/ui/client";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { markNotificationsRead } from "@/server/shell/actions";
import { openPalette } from "./CommandPalette";
import { openQuickAdd } from "./QuickAdd";
import { ThemePicker } from "./ThemePicker";

interface Note { id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string; actor_name: string | null }

type IconCmp = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

/** Floating top bar: brand · primary navigation · search · actions. */
export function Topbar({ unread, counts, user }: { unread: number; counts: Record<string, number>; user: { name: string; title: string | null } }) {
  const path = usePathname();
  const items = NAV.flatMap((g) => g.items);
  const isActive = (href: string, match: string[] = []) => (href === "/" ? path === "/" : [href, ...match].some((h) => path === h || path.startsWith(`${h}/`)));
  return (
    <div className="sticky top-0 z-30 px-3 pt-3 md:px-6">
      <div className="mx-auto flex h-[64px] max-w-[1440px] items-center gap-3 rounded-[22px] border border-white bg-white/85 px-3 shadow-[0_1px_2px_rgb(17_18_20/0.04),0_10px_30px_-12px_rgb(17_18_20/0.12)] backdrop-blur-xl md:px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 pr-2">
          <span className="flex size-9 items-center justify-center rounded-xl text-white shadow-[0_6px_16px_-6px_var(--color-accent)]" style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-2))" }}>
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="7.5" opacity=".55" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></svg>
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[15.5px] font-bold tracking-[-0.02em] text-ink">Central Ops</span>
            <span className="block text-[11px] font-medium text-ink-3">Program Manager 2.0</span>
          </span>
        </Link>
        <nav className="mx-auto flex items-center gap-1 overflow-x-auto rounded-full bg-subtle p-1 [scrollbar-width:none]">
          {items.map((it) => {
            const Icon = ((Icons as unknown as Record<string, IconCmp>)[it.icon] ?? Icons.Circle) as IconCmp;
            const on = isActive(it.href, it.match);
            const n = it.countKey ? counts[it.countKey] ?? 0 : 0;
            return (
              <Link key={it.href} href={it.href} prefetch={false}
                className={cn("relative flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-semibold transition-all", on ? "text-white shadow-[0_6px_16px_-8px_var(--color-accent)]" : "text-ink-3 hover:bg-white hover:text-ink")}
                style={on ? { background: "linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 70%, var(--color-accent-2)))" } : undefined}>
                <Icon size={16} strokeWidth={2} />
                <span className="hidden md:inline">{it.label}</span>
                {n > 0 && <span className={cn("min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-bold tabular", on ? "bg-white/25 text-white" : it.countKey === "overdue" ? "bg-bad text-white" : "bg-accent-soft text-accent-ink")}>{n}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => openPalette()} title="Search (⌘K)" className="flex h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink">
            <Search size={15} /><span className="hidden xl:inline">Search</span><span className="hidden items-center gap-0.5 xl:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
          <ThemePicker />
          <Notifications unread={unread} />
          <button onClick={() => openQuickAdd()} title="Quick add (C)" className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-ink-2">
            <Plus size={15} strokeWidth={2.4} /><span className="hidden sm:inline">New</span>
          </button>
          <UserMenu user={user} />
        </div>
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; title: string | null } }) {
  return (
    <Popover align="end" className="w-[220px]" trigger={({ toggle }) => (
      <button onClick={toggle} className="flex size-9 items-center justify-center rounded-full text-[13px] font-bold text-white ring-2 ring-white" style={{ background: "linear-gradient(135deg, var(--color-ink-2), var(--color-ink))" }} title={user.name}>
        {user.name.slice(0, 1)}
      </button>
    )}>
      <div className="px-2 pb-2 pt-1.5">
        <div className="text-[13.5px] font-semibold text-ink">{user.name}</div>
        <div className="text-[12px] text-ink-3">{user.title}</div>
      </div>
      <Link href="/settings" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-subtle hover:text-ink"><Icons.Settings size={14} /> Settings</Link>
      <form action="/api/auth/logout" method="post">
        <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-subtle hover:text-ink"><Icons.LogOut size={14} /> Sign out</button>
      </form>
    </Popover>
  );
}

function Notifications({ unread }: { unread: number }) {
  const [items, setItems] = useState<Note[] | null>(null);
  const [count, setCount] = useState(unread);
  const [, start] = useTransition();
  const router = useRouter();
  useEffect(() => setCount(unread), [unread]);
  const load = () => fetch("/api/notifications").then((r) => r.json()).then((d) => setItems(d.items ?? []));
  return (
    <Popover align="end" className="w-[380px] p-0" onOpenChange={(o) => o && load()}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="relative flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink-3 hover:border-line-strong hover:text-ink" title="Notifications">
          <Bell size={16} />
          {count > 0 && <span className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full bg-bad px-1 text-[9.5px] font-semibold text-white">{count > 9 ? "9+" : count}</span>}
        </button>
      )}>
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <span className="text-[13px] font-semibold">Notifications</span>
            {count > 0 && <button className="text-[12px] text-ink-3 hover:text-ink" onClick={() => start(async () => { await markNotificationsRead(); setCount(0); load(); router.refresh(); })}>Mark all read</button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto scroll-thin">
            {items === null && <div className="space-y-2 p-3.5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>}
            {items?.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-ink-3">You’re all caught up.</div>}
            {items?.map((n) => (
              <Link key={n.id} href={n.href ?? "#"} onClick={() => { close(); if (!n.read_at) start(() => { markNotificationsRead([n.id]); }); }}
                className={cn("flex gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-0 hover:bg-subtle", !n.read_at && "bg-info-soft/30")}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-info")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink">{n.title}</div>
                  {n.body && <div className="truncate text-[12px] text-ink-3">{n.body}</div>}
                  <div className="mt-0.5 text-[11px] text-ink-4">{n.actor_name ? `${n.actor_name} · ` : ""}{ago(n.created_at)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
