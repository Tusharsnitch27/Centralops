import { Suspense } from "react";
import { CalendarClock, CalendarPlus, CheckCheck, Inbox, Plug } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireUser, canManage } from "@/server/auth";
import { listMeetings, meetingFilterOptions, meetingTabCounts, type MeetingTab } from "@/server/meetings/queries";
import { listPeople } from "@/server/core/people";
import { MeetingGroups, groupByDay } from "@/components/meetings/MeetingList";
import { MeetingFilters } from "@/components/meetings/MeetingFilters";
import { NewMeetingButton } from "@/components/meetings/NewMeeting";
import { plural } from "@/lib/format";

export const metadata = { title: "Meetings" };

const TABS: { key: MeetingTab; label: string }[] = [
  { key: "needs", label: "Needs MoM" },
  { key: "review", label: "Awaiting my review" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "skipped", label: "Skipped" },
];

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const isPM = canManage(u);
  const viewer = { id: u.id, joined_at: u.joined_at, isPM };
  const filter = { reviewId: sp.review, programId: sp.program, projectId: sp.project };
  const counts = await meetingTabCounts(viewer, filter);
  const tab: MeetingTab = (TABS.some((t) => t.key === sp.tab) ? sp.tab : counts.needs ? "needs" : isPM && counts.review ? "review" : "upcoming") as MeetingTab;
  const [rows, opts, people] = await Promise.all([listMeetings(viewer, tab, filter), meetingFilterOptions(), listPeople()]);

  const qs = (k: string) => { const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); p.set("tab", k); return `/meetings?${p}`; };
  const tabs = TABS.map((t) => ({ key: t.key, href: qs(t.key), label: t.key === "review" && !isPM ? "Awaiting review" : t.label, count: t.key === "past" || t.key === "upcoming" ? undefined : counts[t.key] }));
  const options = { people: people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color, title: p.title })), reviews: opts.reviews, projects: opts.projects, programs: opts.programs };

  const mine = rows.filter((r) => r.mom_owner_id === u.id);
  const others = rows.filter((r) => r.mom_owner_id !== u.id);
  const groups = tab === "needs"
    ? [{ label: "Your MoMs", hint: mine.length ? `${plural(mine.length, "meeting")} waiting on you` : undefined, rows: mine }, { label: "Waiting on others", hint: others.length ? "Nudge the owner if it's been a while" : undefined, rows: others }]
    : groupByDay(rows);

  const subtitle = [
    counts.needs ? `${plural(counts.needs, "meeting")} need${counts.needs === 1 ? "s" : ""} minutes` : null,
    isPM && counts.review ? `${counts.review} MoM${counts.review === 1 ? "" : "s"} awaiting your review` : null,
  ].filter(Boolean).join(" · ") || "Every meeting has an owner for its minutes. You review, then actions go out.";

  return (
    <div>
      <PageHeader eyebrow="Work" title="Meetings" subtitle={subtitle}
        actions={<>
          <ButtonLink href="/calendar" variant="ghost" size="sm"><CalendarClock size={14} />Week view</ButtonLink>
          <NewMeetingButton options={options} me={u.id} joinedAt={u.joined_at} />
        </>} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <Tabs items={tabs} active={tab} className="flex-1" />
        <Suspense><MeetingFilters reviews={opts.reviews} programs={opts.programs} projects={opts.projects} /></Suspense>
      </div>
      {rows.length ? <MeetingGroups groups={groups} me={u.id} /> : <Empty tab={tab} isPM={isPM} />}
    </div>
  );
}

function Empty({ tab, isPM }: { tab: MeetingTab; isPM: boolean }) {
  const card = (n: React.ReactNode) => <div className="card">{n}</div>;
  if (tab === "needs") return card(<EmptyState icon={<CheckCheck size={18} />} title="All minutes are in" body="Every meeting that has ended has its MoM submitted, skipped or marked not relevant." action={<ButtonLink href="/meetings?tab=upcoming" size="sm">See upcoming</ButtonLink>} />);
  if (tab === "review") return card(<EmptyState icon={<Inbox size={18} />} title={isPM ? "Nothing to review" : "Nothing awaiting review"} body={isPM ? "When an owner submits a MoM, the suggested actions land here for your feedback and distribution." : "Submitted MoMs wait here until the PM distributes the actions."} />);
  if (tab === "upcoming") return card(<EmptyState icon={<CalendarPlus size={18} />} title="No upcoming meetings" body="Connect Google Calendar to pull meetings in automatically, or add one manually." action={<ButtonLink href="/integrations" size="sm"><Plug size={14} />Connect calendar</ButtonLink>} />);
  if (tab === "skipped") return card(<EmptyState icon={<CheckCheck size={18} />} title="Nothing skipped" body="Meetings marked “Skip” or “Not relevant” are recorded here and never asked about again." />);
  return card(<EmptyState icon={<CalendarClock size={18} />} title="No past meetings yet" body="Meetings from your joining date onward appear here once they've ended." />);
}
