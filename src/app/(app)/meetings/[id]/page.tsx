import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, ChevronLeft, CircleCheck, Clock, Gavel, Hourglass, MapPin, MessageSquareQuote, NotebookPen, Sparkles, TriangleAlert, Video } from "lucide-react";
import { Avatar, Badge, ButtonLink, Card, CardHeader, EmptyState, Prop } from "@/components/ui";
import { TaskList } from "@/components/tasks/TaskRow";
import { requireUser, canManage, canEdit } from "@/server/auth";
import { getMeeting, getMeetingBrief, getMomNote, getSuggestions, meetingOutcomes } from "@/server/meetings/queries";
import { listPeople, listProjectsLite, listTeams } from "@/server/core/people";
import { MomStepper } from "@/components/meetings/MomStepper";
import { MomWorkspace } from "@/components/meetings/MomWorkspace";
import { ReviewPanel } from "@/components/meetings/ReviewPanel";
import { MomOwnerControl, NudgeButton, PrepEditor } from "@/components/meetings/MeetingControls";
import { BriefCard, DecisionList, MomView, RiskList } from "@/components/meetings/Brief";
import { LinkChips, MomBadge, SourceTag, dayLabel, durationMins, fmtDuration, phaseOf, timeRange } from "@/components/meetings/bits";
import { ago, fmtDate } from "@/lib/dates";
import { plural } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const m = await getMeeting((await params).id);
  return { title: m?.title ?? "Meeting" };
}

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ write?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const u = await requireUser();
  const m = await getMeeting(id);
  if (!m) notFound();
  const isPM = canManage(u);
  const isOwner = m.mom_owner_id === u.id || (!m.mom_owner_id && m.organizer_id === u.id);
  const canWrite = canEdit(u) && (isPM || isOwner);
  const phase = phaseOf(m);
  const s = m.mom_status;

  const [note, suggestions, outcomes, brief, people, teams, projects] = await Promise.all([
    getMomNote(id), s === "submitted" || s === "distributed" ? getSuggestions(id) : Promise.resolve([]),
    s === "distributed" ? meetingOutcomes(id) : Promise.resolve(null), getMeetingBrief(m), listPeople(), listTeams(), listProjectsLite(),
  ]);
  const peopleLite = people.map((p) => ({ id: p.id, name: p.name, color: p.avatar_color, team_name: p.team_name }));
  const owner = m.mom_owner_id ? peopleLite.find((p) => p.id === m.mom_owner_id) ?? { id: m.mom_owner_id, name: m.mom_owner_name ?? "Owner", color: m.mom_owner_color } : null;
  const ownerFirst = m.mom_owner_name?.split(" ")[0] ?? "the owner";
  const mins = durationMins(m.starts_at, m.ends_at);
  const isAttendee = m.attendees.some((a) => a.user_id === u.id);

  /* ---- main column by stage ---- */
  let main: React.ReactNode;
  if (s === "distributed" && outcomes) {
    const ignored = suggestions.filter((x) => x.status === "ignored").length;
    main = (
      <div className="space-y-5">
        <Card>
          <CardHeader icon={<CircleCheck size={15} className="text-ok" />} title="Distributed"
            subtitle={`${m.reviewed_by_name ?? "PM"} reviewed ${m.reviewed_at ? ago(m.reviewed_at) : ""} · ${plural(outcomes.tasks.length, "task")}, ${plural(outcomes.decisions.length, "decision")}, ${plural(outcomes.risks.length, "risk")}${ignored ? ` · ${ignored} ignored` : ""}`} />
          <div className="space-y-4 px-4 py-4">
            {m.summary && <p className="text-[13px] leading-[1.65] text-ink-2">{m.summary}</p>}
            {m.pm_feedback && (
              <div className="flex gap-3 rounded-lg border border-line bg-subtle/60 px-3.5 py-3">
                <MessageSquareQuote size={15} className="mt-0.5 shrink-0 text-ink-3" />
                <div><div className="text-[12px] font-medium text-ink-3">{m.reviewed_by_name ?? "PM"}’s feedback</div><p className="text-[13px] text-ink">{m.pm_feedback}</p></div>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<CircleCheck size={15} />} title="Tasks created" subtitle={`${outcomes.tasks.filter((t) => t.status === "completed").length} of ${outcomes.tasks.length} completed`} />
          <TaskList tasks={outcomes.tasks} empty={<EmptyState compact title="No tasks from this meeting" />} />
        </Card>
        {(outcomes.decisions.length > 0 || outcomes.risks.length > 0) && (
          <div className="grid gap-5 md:grid-cols-2">
            <Card><CardHeader icon={<Gavel size={15} />} title="Decisions" /><div className="px-4 py-3.5">{outcomes.decisions.length ? <DecisionList decisions={outcomes.decisions} /> : <p className="text-[13px] text-ink-4">None recorded.</p>}</div></Card>
            <Card><CardHeader icon={<TriangleAlert size={15} />} title="Risks raised" /><div className="px-4 py-3.5">{outcomes.risks.length ? <RiskList risks={outcomes.risks} /> : <p className="text-[13px] text-ink-4">None raised.</p>}</div></Card>
          </div>
        )}
        {note && <MomView note={note} collapsed />}
      </div>
    );
  } else if (s === "submitted" && note && sp.write && canWrite) {
    main = <MomWorkspace meetingId={id} title={m.title} status={s} isPM={isPM} isOwner={isOwner} ownerName={m.mom_owner_name}
      note={{ kind: note.kind, body: note.body, updated_at: String(note.updated_at) }} agenda={m.agenda} followUpDate={m.follow_up_date} startEditing />;
  } else if (s === "submitted" && note) {
    const items = suggestions.map((x) => ({ id: x.id, kind: x.kind, payload: x.payload, status: x.status, feedback: x.feedback }));
    main = (
      <div className="space-y-5">
        <Card>
          <CardHeader icon={<NotebookPen size={15} />} title={`Minutes by ${note.author_name ?? m.mom_owner_name ?? "owner"}`} subtitle={note.submitted_at ? `Submitted ${ago(note.submitted_at)}` : undefined}
            action={isOwner && !isPM ? <ButtonLink href={`/meetings/${id}?write=1`} size="xs" variant="ghost">Edit & resubmit</ButtonLink> : undefined} />
          <div className="px-4 py-4">
            {note.ai_output?.summary && (
              <div className="mb-4 flex gap-2.5 rounded-lg bg-subtle/70 px-3.5 py-3">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-ink-3" />
                <p className="text-[13px] leading-[1.6] text-ink-2">{note.ai_output.summary}</p>
              </div>
            )}
            <MomView note={note} />
          </div>
        </Card>
        {isPM ? (
          <ReviewPanel meetingId={id} items={items} engine={note.ai_engine} ownerName={note.author_name ?? m.mom_owner_name}
            opts={{ people: peopleLite, teams: teams.map((t) => ({ id: t.id, name: t.name })), projects }} />
        ) : (
          <Card className="px-5 py-4">
            <div className="flex items-start gap-3">
              <Hourglass size={16} className="mt-0.5 text-info" />
              <div>
                <div className="text-[13px] font-medium text-ink">With the PM for review</div>
                <p className="text-[12.5px] text-ink-3">{plural(items.length, "suggested item")} extracted. The PM will accept, edit and assign them — owners are notified with feedback once distributed.</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  } else if (s === "skipped" || s === "not_relevant") {
    main = (
      <Card>
        <EmptyState icon={<Ban size={18} />} title={s === "skipped" ? "MoM skipped" : "Marked not relevant for minutes"}
          body={<>{m.pm_feedback ? <>“{m.pm_feedback}” · </> : null}Recorded — nobody will be asked about this meeting again.</>}
          action={canWrite && !sp.write ? <ButtonLink href={`/meetings/${id}?write=1`} size="sm" variant="ghost">Write a MoM anyway</ButtonLink> : undefined} />
        {canWrite && sp.write && <div className="border-t border-line p-4"><MomWorkspace meetingId={id} title={m.title} status={s} isPM={isPM} isOwner={isOwner} ownerName={m.mom_owner_name} note={null} agenda={m.agenda} followUpDate={m.follow_up_date} startEditing /></div>}
      </Card>
    );
  } else if (phase !== "ended" && !note) {
    main = (
      <Card>
        <CardHeader icon={<Clock size={15} />} title={phase === "live" ? "Happening now" : `Starts ${dayLabel(m.starts_at).split(" · ")[0].toLowerCase()} at ${timeRange(m.starts_at, null)}`}
          subtitle={`${m.mom_owner_name ? `${isOwner ? "You'll" : `${m.mom_owner_name} will`} write the MoM afterwards` : "No MoM owner yet"}`} />
        <div className="px-4 py-4"><PrepEditor meetingId={id} agenda={m.agenda} prep={m.prep_notes} canEdit={canWrite || m.organizer_id === u.id} /></div>
      </Card>
    );
  } else if (canWrite) {
    main = <MomWorkspace meetingId={id} title={m.title} status={s} isPM={isPM} isOwner={isOwner} ownerName={m.mom_owner_name}
      note={note ? { kind: note.kind, body: note.body, updated_at: String(note.updated_at) } : null} agenda={m.agenda} followUpDate={m.follow_up_date} startEditing={Boolean(sp.write)} />;
  } else {
    main = (
      <Card>
        <EmptyState icon={<Hourglass size={18} />} title={`Waiting on ${ownerFirst} for the MoM`}
          body={s === "draft" ? `${ownerFirst} has started a draft.` : `The meeting ended ${ago(m.ends_at ?? m.starts_at)}. Actions go out once the MoM is in and reviewed.`} />
      </Card>
    );
  }

  // the PM sees the "Write MoM" prompt but also wants to chase the owner
  const showNudge = isPM && !isOwner && phase === "ended" && (s === "pending" || s === "draft") && m.mom_owner_name;

  return (
    <div>
      <Link href="/meetings" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"><ChevronLeft size={14} />Meetings</Link>
      <header className="mb-5">
        <div className="eyebrow mb-1.5 flex flex-wrap items-center gap-2">
          {m.review_name ? <span>{m.review_name}{m.review_cadence ? ` · ${m.review_cadence}` : ""}</span> : <span>Meeting</span>}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="font-serif text-[24px] leading-[1.1] tracking-[-0.01em] text-ink">{m.title}</h1>
          <div className="flex items-center gap-2">
            {showNudge && <NudgeButton meetingId={id} ownerName={ownerFirst} />}
            <MomBadge m={m} />
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
          <span className="tabular">{dayLabel(m.starts_at)} · {timeRange(m.starts_at, m.ends_at)}{mins ? <span className="text-ink-3"> · {fmtDuration(mins)}</span> : null}</span>
          <LinkChips m={m} />
          {m.meet_url && <a href={m.meet_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-info hover:underline"><Video size={13} />Join</a>}
          {m.location && <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-3"><MapPin size={12} />{m.location}</span>}
        </div>
      </header>

      <div className="mb-6"><MomStepper m={m} ownerName={isOwner ? "you" : m.mom_owner_name?.split(" ")[0] ?? null} isPM={isPM} reviewerName={m.reviewed_by_name} /></div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {main}
          {brief && (phase !== "ended" || s === "pending" || s === "draft") && <BriefCard brief={brief} />}
        </div>
        <aside className="space-y-5">
          <Card className="px-4 py-3">
            <Prop label="MoM owner"><MomOwnerControl meetingId={id} owner={owner} people={peopleLite} canChange={isPM && s !== "distributed"} /></Prop>
            <Prop label="Status"><MomBadge m={m} /></Prop>
            <Prop label="Organizer">{m.organizer_name ?? "—"}</Prop>
            <Prop label="Source"><SourceTag source={m.source} /></Prop>
            {m.follow_up_date && <Prop label="Follow-up">{fmtDate(m.follow_up_date, { dow: true })}</Prop>}
            {m.reviewed_by_name && <Prop label="Reviewed by">{m.reviewed_by_name}</Prop>}
          </Card>
          <Card>
            <CardHeader title="Attendees" subtitle={plural(m.attendees.length, "person", "people")} />
            <ul className="max-h-[320px] overflow-y-auto px-2 py-2 scroll-thin">
              {m.attendees.map((a, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Avatar name={a.name} color={a.color} size={22} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.name}{a.user_id === u.id && <span className="text-ink-4"> (you)</span>}</span>
                  {a.user_id === m.mom_owner_id && <Badge tone="neutral">MoM</Badge>}
                  {a.response === "declined" && <span className="text-[11.5px] text-ink-4">Declined</span>}
                  {a.response === "tentative" && <span className="text-[11.5px] text-ink-4">Maybe</span>}
                </li>
              ))}
              {!m.attendees.length && <li className="px-2 py-2 text-[12.5px] text-ink-4">No attendees recorded.</li>}
            </ul>
          </Card>
          {phase === "ended" && (m.agenda || m.prep_notes) && (
            <Card className="px-4 py-3.5"><PrepEditor meetingId={id} agenda={m.agenda} prep={m.prep_notes} canEdit={false} /></Card>
          )}
          {brief && phase === "ended" && s !== "pending" && s !== "draft" && <BriefCard brief={brief} compact />}
          {!isAttendee && !isPM && <p className="px-1 text-[12px] text-ink-4">You're not on the invite for this meeting.</p>}
        </aside>
      </div>
    </div>
  );
}
