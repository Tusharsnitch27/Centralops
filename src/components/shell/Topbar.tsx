"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bell, Plus, Search } from "lucide-react";
import { Kbd } from "@/components/ui";
import { Popover } from "@/components/ui/client";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { markNotificationsRead } from "@/server/shell/actions";
import { openPalette } from "./CommandPalette";
import { openQuickAdd } from "./QuickAdd";

interface Note { id: string; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string; actor_name: string | null }

export function Topbar({ unread }: { unread: number }) {
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-md md:px-6">
      <button onClick={() => openPalette()} className="flex h-8 w-full max-w-[420px] items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink-4 transition-colors hover:border-line-strong hover:text-ink-3">
        <Search size={14} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘</Kbd><Kbd>K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <Notifications unread={unread} />
        <button onClick={() => openQuickAdd()} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[13px] font-medium text-white hover:bg-ink-2" title="Quick add (C)">
          <Plus size={15} /> <span className="hidden sm:inline">New</span>
        </button>
      </div>
    </div>
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
        <button onClick={toggle} className="relative flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink" title="Notifications">
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
