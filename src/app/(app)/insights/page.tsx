import { Suspense } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card, CardHeader, PageHeader, Skeleton } from "@/components/ui";
import { requireUser, canEdit } from "@/server/auth";
import { generateSuggestions, listSuggestions, recentlyHandled, type Suggestion } from "@/server/insights/engine";
import { situationRead } from "@/server/insights/read";
import { SuggestionList } from "@/components/insights/SuggestionList";
import { ago } from "@/lib/dates";
import { cn } from "@/lib/cn";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const user = await requireUser();
  await generateSuggestions(user.id);
  const [items, handled] = await Promise.all([listSuggestions(user.id, 40), recentlyHandled(user.id)]);
  const crit = items.filter((s) => s.severity === "critical").length;
  return (
    <div>
      <PageHeader eyebrow="Intelligence" title="AI Action Centre"
        subtitle={items.length ? `${items.length} suggestion${items.length === 1 ? "" : "s"} across AOP, S&OP, projects, meetings and tasks${crit ? ` · ${crit} critical` : ""}.` : "Proactive suggestions across every module."} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Suspense fallback={<ReadSkeleton />}><AiRead items={items} /></Suspense>
          <Card className="overflow-hidden">
            <CardHeader title="Suggested actions" subtitle="Act, schedule a review, or dismiss — dismissed suggestions stay dismissed for that situation." />
            <SuggestionList items={items} readOnly={!canEdit(user)} />
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="By area" />
            <ul className="px-4 py-3 text-[13px]">
              {AREAS.map((a) => {
                const n = items.filter((s) => a.kinds.includes(s.kind)).length;
                return (
                  <li key={a.label} className="flex items-center justify-between py-1.5">
                    <Link href={a.href} className="text-ink-2 hover:text-ink">{a.label}</Link>
                    <span className={cn("tabular", n ? "font-medium text-ink" : "text-ink-4")}>{n || "—"}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Recently handled" />
            {handled.length ? (
              <ul className="divide-y divide-line/70">
                {handled.map((h) => (
                  <li key={h.id} className="px-4 py-2.5 text-[12.5px]">
                    <div className="text-ink-2">{h.title}</div>
                    <div className="text-[11.5px] text-ink-4">{h.status === "accepted" ? "Acted on" : "Dismissed"} · {ago(h.resolved_at)}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-5 text-[12.5px] text-ink-3">Actions you take here show up as a trail.</p>}
          </Card>
          <p className="px-1 text-[12px] leading-relaxed text-ink-4">Suggestions come from the rules in <Link href="/settings?tab=rules" className="underline decoration-ink-4/50 underline-offset-2 hover:text-ink-2">Settings → Insight rules</Link>. Thresholds and on/off switches apply to Exceptions too.</p>
        </div>
      </div>
    </div>
  );
}

const AREAS = [
  { label: "AOP & cost", kinds: ["aop_overspend", "aop_missing"], href: "/aop" },
  { label: "S&OP & capacity", kinds: ["sop_late", "capacity"], href: "/sop" },
  { label: "Projects & milestones", kinds: ["milestone_slip", "project_update"], href: "/tasks/goals" },
  { label: "Meetings & MoMs", kinds: ["mom_missing"], href: "/meetings" },
  { label: "Delegated tasks", kinds: ["stale_tasks"], href: "/exceptions#stale" },
  { label: "Decisions", kinds: ["decision_due"], href: "/meetings" },
];

async function AiRead({ items }: { items: Suggestion[] }) {
  const r = await situationRead(items.slice(0, 12));
  return (
    <div className="rounded-xl border border-violet/15 bg-violet-soft/40 px-4 py-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-violet"><Sparkles size={12} />{r.engine === "claude" ? "AI read" : "The read"}</div>
      <p className="text-[13px] leading-relaxed text-ink-2">{r.text}</p>
    </div>
  );
}
function ReadSkeleton() {
  return <div className="rounded-xl border border-line bg-surface px-4 py-4"><Skeleton className="mb-2 w-24" /><Skeleton className="mb-1.5 w-full" /><Skeleton className="w-3/4" /></div>;
}
