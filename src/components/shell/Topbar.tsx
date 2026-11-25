"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bell, Plus, Search } from "lucide-react";
import * as Icons from "lucide-react";
import { Kbd } from "@/components/ui";
import { Popover } from "@/components/ui/client";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { markNotificationsRead } from "@/server/shell/actions";
import { openPalette } from "./CommandPalette";
import { ThemePicker } from "./ThemePicker";
import { LogoMark } from "./Logo";

interface Note { id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string; actor_name: string | null }


/** Top bar: page breadcrumb · search · actions. Navigation lives in the sidebar (desktop) / bottom bar (mobile). */
export function Topbar({ unread, user }: { unread: number; counts?: Record<string, number>; user: { name: string; title: string | null } }) {
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md print:hidden">
      <div className="flex h-14 items-center gap-2 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden">
          <LogoMark size={26} />
        </Link>
        <PageTitle />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button onClick={() => openPalette()} title="Search (⌘K)" className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-ink-4 transition-colors hover:bg-subtle hover:text-ink md:w-[280px] md:border md:border-line md:bg-surface md:px-3">
            <Search size={15} /><span className="hidden flex-1 text-left md:inline">Search…</span><span className="hidden items-center gap-0.5 md:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
          <ThemePicker />
          <Notifications unread={unread} />
          <span className="ml-1 lg:hidden"><UserMenu user={user} /></span>
        </div>
      </div>
    </div>
  );
}

const TITLES: [RegExp, string, string][] = [
  [/^\/$/, "Home", "Summary"], [/^\/tasks/, "Work", "Tasks"], [/^\/followups/, "Work", "Follow-ups"], [/^\/meetings/, "Others", "Meetings & MoM"], [/^\/weekly/, "Work", "Weekly updates"],
  [/^\/aop/, "Programs", "AOP"], [/^\/functions/, "Programs", "Cost Control"], [/^\/sop/, "Programs", "S&OP"], [/^\/library/, "Others", "Ops Handbook"], [/^\/settings/, "Account", "Settings"], [/^\/welcome/, "Home", "Get started"],
];
function PageTitle() {
  const path = usePathname();
  const hit = TITLES.find(([re]) => re.test(path));
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="hidden text-[12.5px] text-ink-4 sm:inline">{hit?.[1]}</span>
      <span className="hidden text-ink-4/60 sm:inline">/</span>
      <span className="truncate text-[13px] font-semibold text-ink">{hit?.[2]}</span>
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; title: string | null } }) {
  return (
    <Popover align="end" className="w-[220px]" trigger={({ toggle }) => (
      <button onClick={toggle} className="flex size-7 items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-white" title={user.name}>
        {user.name.slice(0, 1)}
      </button>
    )}>
      <div className="px-2 pb-2 pt-1.5">
        <div className="text-[13px] font-semibold text-ink">{user.name}</div>
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
    <Popover align="end" className="w-[min(380px,calc(100vw-24px))] p-0" onOpenChange={(o) => o && load()}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="relative flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-subtle hover:text-ink" title="Notifications">
          <Bell size={15} />
          {count > 0 && <span className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{count > 9 ? "9+" : count}</span>}
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
