import { BarChart3, CalendarDays, Check, CircleAlert, FolderOpen, Mail, MessageSquare, Phone, Sheet, Snowflake, type LucideIcon } from "lucide-react";
import { Badge, ButtonLink, Card, Kbd, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { INTEGRATIONS, googleStatus, type IntegrationDef } from "@/server/integrations/registry";
import { ago, fmtDate } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { GoogleActions } from "./IntegrationActions";

export const metadata = { title: "Integrations" };

const ICONS: Record<string, LucideIcon> = { CalendarDays, Mail, MessageSquare, Phone, FolderOpen, Sheet, Snowflake, BarChart3 };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const g = await googleStatus(u.id);
  const live = INTEGRATIONS.filter((i) => i.status === "live");
  const soon = INTEGRATIONS.filter((i) => i.status === "soon");
  const categories = [...new Set(soon.map((i) => i.category))];

  return (
    <div>
      <PageHeader eyebrow="Organisation" title="Integrations" subtitle="Optional connections that bring work in automatically. Sign-in stays email + password — these never log you in." />

      {sp.connected === "google" && <Banner tone="ok">Google Calendar connected{g.last_result ? ` — ${g.last_result.imported} meetings imported` : ""}.</Banner>}
      {sp.error === "google" && <Banner tone="bad">Google didn't complete the connection. Try again — if it keeps failing, check the redirect URI below.</Banner>}
      {sp.error === "google_not_configured" && <Banner tone="bad">Google isn't set up on this server yet. Follow the setup steps on the card below.</Banner>}

      <div className="space-y-4">
        {live.map((i) => <GoogleCard key={i.key} def={i} g={g} joinedAt={u.joined_at} />)}
      </div>

      <h2 className="mb-1 mt-10 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Coming soon</h2>
      <p className="mb-4 text-[13px] text-ink-3">Each plugs into the same registry — follow-ups, digests and actuals will flow through these without changing how you work.</p>
      <div className="space-y-6">
        {categories.map((c) => (
          <div key={c}>
            <div className="eyebrow mb-2">{c}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {soon.filter((i) => i.category === c).map((i) => <SoonCard key={i.key} def={i} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "bad"; children: React.ReactNode }) {
  return (
    <div className={cn("mb-5 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px]", tone === "ok" ? "border-ok/20 bg-ok-soft text-ok" : "border-bad/20 bg-bad-soft text-bad")}>
      {tone === "ok" ? <Check size={14} /> : <CircleAlert size={14} />}{children}
    </div>
  );
}

function Logo({ icon, muted }: { icon: string; muted?: boolean }) {
  const I = ICONS[icon] ?? CalendarDays;
  return <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border border-line", muted ? "bg-subtle text-ink-4" : "bg-surface text-ink-2 shadow-[var(--shadow-card)]")}><I size={18} /></span>;
}

function GoogleCard({ def, g, joinedAt }: { def: IntegrationDef; g: Awaited<ReturnType<typeof googleStatus>>; joinedAt: string }) {
  const status = !g.configured ? <Badge tone="muted">Not set up</Badge> : g.status === "error" ? <Badge tone="red" dot>Needs attention</Badge> : g.connected ? <Badge tone="green" dot>Connected</Badge> : <Badge tone="neutral">Not connected</Badge>;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 px-5 py-5">
        <Logo icon={def.icon} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{def.name}</h3>{status}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-3">{def.tagline}</p>
          <ul className="mt-3 grid gap-1.5 text-[12.5px] text-ink-2 md:grid-cols-3">
            {def.capabilities.map((c) => <li key={c} className="flex gap-1.5"><Check size={13} className="mt-0.5 shrink-0 text-ink-4" />{c}</li>)}
          </ul>
        </div>
        <div className="shrink-0">
          {g.configured && g.connected ? <GoogleActions /> : g.configured ? <ButtonLink href="/api/integrations/google/start?next=/integrations" variant="primary" size="sm" prefetch={false}>Connect Google Calendar</ButtonLink> : null}
        </div>
      </div>

      {g.configured && g.connected && (
        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            ["Account", g.account_email ?? "—"],
            ["Last sync", g.last_sync_at ? ago(g.last_sync_at) : "Never"],
            ["Meetings imported", String(g.meetings)],
            ["Importing from", fmtDate(joinedAt)],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-5 py-3">
              <div className="eyebrow mb-0.5">{k}</div>
              <div className="truncate text-[13px] text-ink">{v}</div>
            </div>
          ))}
        </div>
      )}
      {g.last_error && <div className="flex items-center gap-2 border-t border-line bg-bad-soft/60 px-5 py-2.5 text-[12.5px] text-bad"><CircleAlert size={13} />{g.last_error}</div>}
      {g.configured && !g.connected && (
        <div className="border-t border-line bg-subtle/50 px-5 py-3 text-[12.5px] text-ink-3">Read-only access. Only meetings from your joining date ({fmtDate(joinedAt)}) onward are imported — nothing earlier.</div>
      )}

      {!g.configured && (
        <div className="border-t border-line bg-subtle/50 px-5 py-4">
          <div className="mb-2 text-[13px] font-medium text-ink">Set up Google Calendar (admin, one-time)</div>
          <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px] text-ink-2">
            <li>In Google Cloud Console, create an OAuth client (type: Web application) and enable the Google Calendar API.</li>
            <li>Add this authorised redirect URI: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink ring-1 ring-line">{g.redirectUri}</code></li>
            <li>Set <Kbd>GOOGLE_CLIENT_ID</Kbd> and <Kbd>GOOGLE_CLIENT_SECRET</Kbd> in the server environment (and <Kbd>NEXTAUTH_URL</Kbd> to this app&apos;s public URL), then redeploy.</li>
            <li>Come back here and press <span className="font-medium text-ink">Connect Google Calendar</span>. Scope: <span className="font-mono text-[11.5px]">calendar.readonly</span>.</li>
          </ol>
        </div>
      )}
    </Card>
  );
}

function SoonCard({ def }: { def: IntegrationDef }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-4 py-4">
      <div className="flex items-start gap-3">
        <Logo icon={def.icon} muted />
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h3 className="text-[13.5px] font-semibold text-ink">{def.name}</h3><Badge tone="muted">Soon</Badge></div>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{def.tagline}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1 pl-[52px] text-[12px] text-ink-3">
        {def.capabilities.map((c) => <li key={c} className="flex gap-1.5"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" />{c}</li>)}
      </ul>
    </div>
  );
}
