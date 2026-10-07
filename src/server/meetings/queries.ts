import "server-only";
import { one, q } from "../db";
import { listTasks, type TaskListItem } from "../tasks/queries";
import { addDays, today } from "@/lib/dates";
import type { MomStatus } from "@/lib/meta";
import type { SuggestionKind, SuggestionPayload } from "./extract";

/** IST midnight of a 'YYYY-MM-DD' date as a Date (for timestamptz comparisons). */
export const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

export interface AttendeeLite { name: string; color: string | null; user_id: string | null; email?: string | null; response?: string | null }
export interface MeetingRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  mom_status: MomStatus;
  source: "calendar" | "manual";
  is_recurring: boolean;
  series_key: string | null;
  review_id: string | null;
  review_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_code: string | null;
  program_id: string | null;
  program_name: string | null;
  mom_owner_id: string | null;
  mom_owner_name: string | null;
  mom_owner_color: string | null;
  organizer_id: string | null;
  location: string | null;
  meet_url: string | null;
  cancelled: boolean;
  prep_notes: string | null;
  agenda: string | null;
  attendees: AttendeeLite[];
  actions_count: number;
  pending_suggestions: number;
}

const ATTENDEES = `coalesce((select json_agg(json_build_object('name', coalesce(u.name, a.name, a.email), 'color', u.avatar_color, 'user_id', a.user_id, 'email', coalesce(u.email, a.email), 'response', a.response) order by (a.user_id = m.mom_owner_id) desc, coalesce(u.name, a.name, a.email))
   from meeting_attendees a left join users u on u.id = a.user_id where a.meeting_id = m.id), '[]'::json)`;

const SELECT = `select m.id, m.title, m.starts_at, m.ends_at, m.mom_status, m.source, m.is_recurring, m.series_key,
   m.review_id, r.name as review_name, m.project_id, p.name as project_name, p.code as project_code, m.program_id, pg.name as program_name,
   m.mom_owner_id, mu.name as mom_owner_name, mu.avatar_color as mom_owner_color, m.organizer_id, m.location, m.meet_url, m.cancelled, m.prep_notes, m.agenda,
   ${ATTENDEES} as attendees,
   (select count(*)::int from tasks t where t.meeting_id = m.id) as actions_count,
   (select count(*)::int from meeting_suggestions s where s.meeting_id = m.id and s.status = 'pending') as pending_suggestions
 from meetings m
 left join reviews r on r.id = m.review_id
 left join projects p on p.id = m.project_id
 left join programs pg on pg.id = m.program_id
 left join users mu on mu.id = m.mom_owner_id`;

export type MeetingTab = "needs" | "review" | "upcoming" | "past" | "skipped";
export interface MeetingFilter { reviewId?: string; programId?: string; projectId?: string }
interface Viewer { id: string; joined_at: string; isPM: boolean }

function baseWhere(v: Viewer, f: MeetingFilter, p: unknown[]) {
  const w: string[] = ["not m.cancelled"];
  p.push(istStart(v.joined_at)); w.push(`m.starts_at >= $${p.length}`);
  if (!v.isPM) {
    p.push(v.id);
    const i = p.length;
    w.push(`(m.mom_owner_id = $${i} or m.organizer_id = $${i} or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $${i}))`);
  }
  if (f.reviewId) { p.push(f.reviewId); w.push(`m.review_id = $${p.length}`); }
  if (f.programId) { p.push(f.programId); w.push(`(m.program_id = $${p.length} or p.program_id = $${p.length})`); }
  if (f.projectId) { p.push(f.projectId); w.push(`m.project_id = $${p.length}`); }
  return w;
}
const TAB_WHERE: Record<MeetingTab, string> = {
  needs: `coalesce(m.ends_at, m.starts_at) < now() and m.mom_status in ('pending','draft')`,
  review: `m.mom_status = 'submitted'`,
  upcoming: `coalesce(m.ends_at, m.starts_at) >= now()`,
  past: `coalesce(m.ends_at, m.starts_at) < now() and m.mom_status in ('submitted','distributed','pending','draft')`,
  skipped: `m.mom_status in ('skipped','not_relevant')`,
};

export async function listMeetings(v: Viewer, tab: MeetingTab, f: MeetingFilter = {}): Promise<MeetingRow[]> {
  const p: unknown[] = [];
  const w = baseWhere(v, f, p);
  w.push(TAB_WHERE[tab]);
  let order: string;
  if (tab === "needs") { p.push(v.id); order = `(m.mom_owner_id = $${p.length}) desc, m.starts_at desc`; }
  else order = tab === "upcoming" ? `m.starts_at asc` : `m.starts_at desc`;
  return q<MeetingRow>(`${SELECT} where ${w.join(" and ")} order by ${order} limit 200`, p);
}

export async function meetingTabCounts(v: Viewer, f: MeetingFilter = {}): Promise<Record<MeetingTab, number>> {
  const p: unknown[] = [];
  const w = baseWhere(v, f, p);
  const r = await one<Record<MeetingTab, number>>(
    `select ${Object.entries(TAB_WHERE).map(([k, c]) => `count(*) filter (where ${c})::int as ${k}`).join(", ")}
     from meetings m left join projects p on p.id = m.project_id where ${w.join(" and ")}`, p);
  return r ?? { needs: 0, review: 0, upcoming: 0, past: 0, skipped: 0 };
}

export async function meetingFilterOptions() {
  const [reviews, programs, projects] = await Promise.all([
    q<{ id: string; name: string; cadence: string; mom_owner_id: string | null; program_id: string | null; project_id: string | null }>(`select id, name, cadence, mom_owner_id, program_id, project_id from reviews where active order by name`),
    q<{ id: string; name: string; code: string | null }>(`select id, name, code from programs where status <> 'cancelled' order by name`),
    q<{ id: string; name: string; code: string | null; program_id: string | null }>(`select id, name, code, program_id from projects where status not in ('cancelled') order by name`),
  ]);
  return { reviews, programs, projects };
}

/* ---------- detail ---------- */

export interface MeetingDetail extends MeetingRow {
  organizer_name: string | null;
  summary: string | null;
  pm_feedback: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  follow_up_date: string | null;
  review_cadence: string | null;
  review_owner_id: string | null;
  calendar_event_id: string | null;
  created_at: string;
}
export interface MomNote {
  id: string; kind: "mom" | "quick"; body: string; discussion: string | null; blockers: string | null;
  ai_output: { summary?: string; discussion?: string[] } | null; ai_engine: string | null; processed_at: string | null; submitted_at: string | null;
  author_id: string | null; author_name: string | null; updated_at: string;
}
export interface Suggestion {
  id: string; kind: SuggestionKind; payload: SuggestionPayload; status: "pending" | "accepted" | "ignored"; feedback: string | null;
  created_entity_type: string | null; created_entity_id: string | null; decided_by_name: string | null; decided_at: string | null; sort: number;
}

export async function getMeeting(id: string): Promise<MeetingDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return one<MeetingDetail>(
    `select x.*, mm.summary, mm.pm_feedback, mm.reviewed_at, mm.follow_up_date, mm.calendar_event_id, mm.created_at,
            ou.name as organizer_name, ru.name as reviewed_by_name, rv.cadence as review_cadence, rv.owner_id as review_owner_id
     from (${SELECT} where m.id = $1) x
     join meetings mm on mm.id = x.id
     left join users ou on ou.id = mm.organizer_id
     left join users ru on ru.id = mm.reviewed_by
     left join reviews rv on rv.id = mm.review_id`,
    [id],
  );
}

export async function getMomNote(meetingId: string) {
  return one<MomNote>(
    `select n.id, n.kind, n.body, n.discussion, n.blockers, n.ai_output, n.ai_engine, n.processed_at, n.submitted_at, n.author_id, u.name as author_name, n.updated_at
     from meeting_notes n left join users u on u.id = n.author_id where n.meeting_id = $1 order by n.updated_at desc limit 1`, [meetingId]);
}

export async function getSuggestions(meetingId: string) {
  return q<Suggestion>(
    `select s.id, s.kind, s.payload, s.status, s.feedback, s.created_entity_type, s.created_entity_id, u.name as decided_by_name, s.decided_at, s.sort
     from meeting_suggestions s left join users u on u.id = s.decided_by where s.meeting_id = $1
     order by array_position(array['action','followup','decision','risk'], s.kind), s.sort, s.created_at`, [meetingId]);
}

export interface DecisionLite { id: string; title: string; context: string | null; status: string; decided_on: string | null; decision_maker_name: string | null }
export interface RiskLite { id: string; title: string; probability: number; impact: number; score: number; status: string; owner_name: string | null; owner_color: string | null; mitigation: string | null; project_name: string | null }

export async function meetingOutcomes(meetingId: string) {
  const [tasks, decisions, risks] = await Promise.all([
    listTasks({ meetingId }),
    q<DecisionLite>(`select d.id, d.title, d.context, d.status, d.decided_on, u.name as decision_maker_name from decisions d left join users u on u.id = d.decision_maker_id where d.meeting_id = $1 order by d.created_at`, [meetingId]),
    q<RiskLite>(`select r.id, r.title, r.probability, r.impact, r.score, r.status, u.name as owner_name, u.avatar_color as owner_color, r.mitigation, p.name as project_name
                 from risks r left join users u on u.id = r.owner_id left join projects p on p.id = r.project_id where r.meeting_id = $1 order by r.score desc`, [meetingId]),
  ]);
  return { tasks, decisions, risks };
}

/* ---------- brief (pre-read for recurring reviews) ---------- */

export interface MeetingBrief {
  previous: { id: string; title: string; starts_at: string; summary: string | null; mom_status: MomStatus; pm_feedback: string | null } | null;
  decisions: DecisionLite[];
  actions: TaskListItem[];
  closure: { total: number; completed: number; in_progress: number; overdue: number; not_started: number };
  carried: TaskListItem[];     // open actions from any earlier meeting in the series
  risks: RiskLite[];
}

export async function getMeetingBrief(m: Pick<MeetingRow, "id" | "starts_at" | "review_id" | "series_key" | "project_id" | "program_id">): Promise<MeetingBrief | null> {
  if (!m.review_id && !m.series_key) return null;
  const prev = await one<MeetingBrief["previous"] & object>(
    `select id, title, starts_at, summary, mom_status, pm_feedback from meetings
     where id <> $1 and not cancelled and starts_at < $2 and ((review_id is not null and review_id = $3) or (series_key is not null and series_key = $4))
     order by starts_at desc limit 1`, [m.id, m.starts_at, m.review_id, m.series_key]);
  const seriesIds = (await q<{ id: string }>(
    `select id from meetings where id <> $1 and starts_at < $2 and ((review_id is not null and review_id = $3) or (series_key is not null and series_key = $4))`,
    [m.id, m.starts_at, m.review_id, m.series_key])).map((r) => r.id);
  const td = today();
  const [actions, decisions, carriedAll, risks] = await Promise.all([
    prev ? listTasks({ meetingId: prev.id }) : Promise.resolve([] as TaskListItem[]),
    prev ? q<DecisionLite>(`select d.id, d.title, d.context, d.status, d.decided_on, u.name as decision_maker_name from decisions d left join users u on u.id = d.decision_maker_id where d.meeting_id = $1 order by d.created_at`, [prev.id]) : Promise.resolve([] as DecisionLite[]),
    seriesIds.length
      ? q<{ id: string }>(`select id from tasks where meeting_id = any($1::uuid[]) and meeting_id <> $2 and status not in ('completed','cancelled')`, [seriesIds, prev?.id ?? m.id])
          .then((r) => (r.length ? listTasks({ ids: r.map((x) => x.id), open: true }) : []))
      : Promise.resolve([] as TaskListItem[]),
    q<RiskLite>(
      `select r.id, r.title, r.probability, r.impact, r.score, r.status, u.name as owner_name, u.avatar_color as owner_color, r.mitigation, p.name as project_name
       from risks r left join users u on u.id = r.owner_id left join projects p on p.id = r.project_id
       where r.status <> 'closed' and (r.meeting_id = any($1::uuid[]) or ($2::uuid is not null and r.project_id = $2) or ($2::uuid is null and $3::uuid is not null and r.program_id = $3))
       order by r.score desc limit 5`, [seriesIds, m.project_id, m.program_id]),
  ]);
  const open = (t: TaskListItem) => t.status !== "completed" && t.status !== "cancelled";
  const closure = {
    total: actions.length,
    completed: actions.filter((t) => t.status === "completed").length,
    overdue: actions.filter((t) => open(t) && t.due_date != null && t.due_date < td).length,
    in_progress: actions.filter((t) => open(t) && !(t.due_date != null && t.due_date < td) && t.status !== "not_started").length,
    not_started: actions.filter((t) => t.status === "not_started" && !(t.due_date != null && t.due_date < td)).length,
  };
  if (!prev && !carriedAll.length && !risks.length) return null;
  return { previous: prev, decisions, actions, closure, carried: carriedAll, risks };
}

/* ---------- day / week ---------- */

export async function meetingsBetween(userId: string, isPM: boolean, from: string, toExclusive: string, joinedAt: string) {
  const p: unknown[] = [istStart(from), istStart(toExclusive), istStart(joinedAt)];
  let who = "";
  if (!isPM) { p.push(userId); who = `and (m.mom_owner_id = $4 or m.organizer_id = $4 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $4))`; }
  return q<MeetingRow>(`${SELECT} where not m.cancelled and m.starts_at >= $1 and m.starts_at < $2 and m.starts_at >= $3 ${who} order by m.starts_at`, p);
}

export interface TodayMeeting {
  id: string; title: string; starts_at: string; ends_at: string | null;
  attendees: { name: string; color: string | null }[];
  review_name: string | null; project_name: string | null; program_name: string | null;
  mom_status: MomStatus; mom_owner_name: string | null; is_mine_mom: boolean; prep_notes: string | null; previous_open_actions: number;
}

/** Today's meetings for the user (attendee, organizer or MoM owner). Used by /today and the Command Centre. */
export async function getTodayMeetings(userId: string): Promise<TodayMeeting[]> {
  const td = today();
  const rows = await q<MeetingRow & { previous_open_actions: number }>(
    `select x.*, (select count(*)::int from tasks t join meetings pm on pm.id = t.meeting_id
                  where t.status not in ('completed','cancelled') and pm.id <> x.id and pm.starts_at < x.starts_at
                    and ((x.review_id is not null and pm.review_id = x.review_id) or (x.series_key is not null and pm.series_key = x.series_key))) as previous_open_actions
     from (${SELECT} where not m.cancelled and m.starts_at >= $1 and m.starts_at < $2
       and (m.mom_owner_id = $3 or m.organizer_id = $3 or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = $3))) x
     order by x.starts_at`,
    [istStart(td), istStart(addDays(td, 1)), userId]);
  return rows.map((r) => ({
    id: r.id, title: r.title, starts_at: r.starts_at, ends_at: r.ends_at,
    attendees: r.attendees.map((a) => ({ name: a.name, color: a.color })),
    review_name: r.review_name, project_name: r.project_name, program_name: r.program_name,
    mom_status: r.mom_status, mom_owner_name: r.mom_owner_name, is_mine_mom: r.mom_owner_id === userId,
    prep_notes: r.prep_notes, previous_open_actions: r.previous_open_actions,
  }));
}

/** Open follow-ups the user is waiting on (they asked someone for an update). */
export async function myOpenFollowups(userId: string) {
  return q<{ id: string; message: string | null; created_at: string; due_at: string | null; entity_type: string; entity_id: string; person_name: string | null; person_color: string | null; task_title: string | null; task_number: number | null }>(
    `select f.id, f.message, f.created_at, f.due_at, f.entity_type, f.entity_id, u.name as person_name, u.avatar_color as person_color, t.title as task_title, t.number as task_number
     from followups f left join users u on u.id = f.person_id left join tasks t on f.entity_type = 'task' and t.id = f.entity_id
     where f.requested_by = $1 and f.status = 'open' order by f.created_at limit 30`, [userId]);
}

/** Tasks due per day within a range (for the calendar strip). */
export async function tasksDueBetween(userId: string, from: string, to: string) {
  return q<{ id: string; number: number; title: string; due_date: string; status: string; priority: string }>(
    `select id, number, title, due_date, status, priority from tasks
     where due_date between $2::date and $3::date and status <> 'cancelled' and (owner_id = $1 or requester_id = $1 or created_by = $1)
     order by due_date, array_position(array['urgent','high','medium','low'], priority)`, [userId, from, to]);
}
