"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Unplug, X } from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { useToast } from "@/components/ui/client";
import { adminDisconnectCalendar, dismissCalendarPrompt, setCalendarMaster } from "@/server/integrations/actions";
import { GoogleActions } from "@/app/(app)/integrations/IntegrationActions";
import { ago } from "@/lib/dates";

const CONNECT = (next: string) => `/api/integrations/google/start?next=${encodeURIComponent(next)}`;

/** Summary: ask (never assume) — connect your own Google Calendar so meetings come in by themselves. */
export function CalendarPrompt() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"><CalendarDays size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">Bring your meetings in automatically?</div>
        <div className="text-[12.5px] text-ink-3">Connect your own Google Calendar (read-only) and your meetings show up here, ready for MoM. Only yours — disconnect any time in Settings › Profile.</div>
      </div>
      <a href={CONNECT("/")} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink-2">Connect my calendar</a>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await dismissCalendarPrompt(); router.refresh(); })}><X size={13} />Not now</Button>
    </div>
  );
}

/** Settings › Profile: my own calendar connection. */
export function MyCalendar({ g, master }: { g: { configured: boolean; connected: boolean; account_email: string | null; last_sync_at: string | null; meetings: number }; master: boolean }) {
  return (
    <section className="grid gap-4 border-t border-line pt-6 md:grid-cols-[220px_1fr]">
      <div><div className="text-[13px] font-semibold">My calendar</div><p className="text-[12.5px] text-ink-3">Your own Google Calendar only. Nobody else’s calendar or email is connected for you.</p></div>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <CalendarDays size={16} className="text-ink-3" />
        {!master ? <span className="text-[13px] text-ink-3">Calendar connections are switched off by the admin.</span>
          : !g.configured ? <span className="text-[13px] text-ink-3">Google isn’t set up on this server yet.</span>
          : g.connected ? (<>
            <div className="min-w-0 flex-1 text-[13px]"><Badge tone="green" dot>Connected</Badge> <span className="ml-1 text-ink-2">{g.account_email}</span>
              <div className="text-[12px] text-ink-4">{g.meetings} meetings imported{g.last_sync_at ? ` · synced ${ago(g.last_sync_at)}` : ""}</div></div>
            <GoogleActions />
          </>) : (<>
            <span className="flex-1 text-[13px] text-ink-3">Not connected.</span>
            <a href={CONNECT("/settings?tab=profile")} className="inline-flex h-8 items-center rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink-2">Connect my Google Calendar</a>
          </>)}
      </div>
    </section>
  );
}

/** Settings › Integrations (admin): master switch + who has connected. */
export function CalendarMaster({ master, people }: { master: boolean; people: { id: string; name: string; color: string | null; email: string | null; status: string | null; last_sync_at: string | null }[] }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? "Failed", "error"); else { toast(r.message ?? "Done", "success"); router.refresh(); } });
  const connected = people.filter((p) => p.status && p.status !== "disconnected");
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarDays size={17} className="text-ink-3" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Calendar connections</div>
          <div className="text-[12.5px] text-ink-3">Each person connects only their own Google Calendar after being asked. The master switch turns it on or off for everyone.</div>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={master} disabled={pending} onChange={(e) => { if (!e.target.checked && !confirm("Switch off calendar connections? Every connected calendar is disconnected (imported meetings stay).")) return; run(() => setCalendarMaster(e.target.checked)); }} />
          {master ? "On" : "Off"}
        </label>
      </div>
      <div className="mt-3 divide-y divide-line/70 rounded-lg border border-line">
        {connected.length ? connected.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
            <Avatar name={p.name} color={p.color} size={22} />
            <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-ink-4">· {p.email ?? "—"}</span></span>
            <span className="text-[12px] text-ink-4">{p.last_sync_at ? `synced ${ago(p.last_sync_at)}` : "not synced yet"}</span>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => confirm(`Disconnect ${p.name}'s calendar?`) && run(() => adminDisconnectCalendar(p.id))}><Unplug size={12} />Disconnect</Button>
          </div>
        )) : <div className="px-3 py-3 text-[12.5px] text-ink-4">Nobody has connected a calendar yet.</div>}
      </div>
    </div>
  );
}
