import "server-only";
import { cache } from "react";
import { one, q } from "../db";
import { listTasks, type TaskListItem } from "../tasks/queries";
import { addMonths, today } from "@/lib/dates";
import {
  currentPeriod, dueDateFor, headlineMetric, isOpenSub, subState,
  type Accuracy, type Line, type Stream, type SubCell, type ValueRow,
} from "./model";

/* ---------------- streams, lines, values ---------------- */

export const getStreams = cache(() =>
  q<Stream>(
    `select s.id, s.code, s.name, s.area, s.poc_id, u.name as poc_name, u.avatar_color as poc_color, s.poc_label, s.description,
            s.granularity, s.unit, s.dimensions, s.due_day, s.actual_source, s.actual_query, s.headline_metric, s.sort
     from sop_streams s left join users u on u.id = s.poc_id
     where s.active order by s.sort, s.name`,
  ),
);

export async function getStream(idOrCode: string) {
  return (await getStreams()).find((s) => s.id === idOrCode || s.code === idOrCode) ?? null;
}

export const getLines = cache((streamId?: string) =>
  q<Line>(`select id, stream_id, name, metric, unit, sort from sop_lines where active ${streamId ? "and stream_id = $1" : ""} order by sort, name`, streamId ? [streamId] : []),
);

export async function getValues(streamId: string, from: string, to: string) {
  return q<ValueRow>(
    `select v.id, v.line_id, v.period, v.period_label, v.dimension, v.projection, v.revised_projection, v.actual, v.actual_source
     from sop_values v join sop_lines l on l.id = v.line_id
     where l.stream_id = $1 and l.active and v.period between $2::date and $3::date
     order by v.period, v.period_label, v.dimension`,
    [streamId, from, to],
  );
}

/** Per stream × metric × month aggregates (weeks and dimensions summed). */
export interface StreamMonth {
  stream_id: string; metric: string | null; period: string;
  proj: number | null;         // baseline projection
  eff: number | null;          // revised ?? baseline
  act: number | null;
  proj_matched: number | null; // baseline projection on rows that have an actual
  act_matched: number | null;  // actual on rows that have a projection
  abs_err: number | null;
  n_act: number;
  demo: boolean;
  revised: boolean;
}
export const getStreamMonthly = cache((from: string, to: string) =>
  q<StreamMonth>(
    `select l.stream_id, l.metric, v.period,
            sum(v.projection) as proj,
            sum(coalesce(v.revised_projection, v.projection)) as eff,
            sum(v.actual) as act,
            sum(v.projection) filter (where v.actual is not null and v.projection > 0) as proj_matched,
            sum(v.actual) filter (where v.actual is not null and v.projection > 0) as act_matched,
            sum(abs(v.actual - v.projection)) filter (where v.actual is not null and v.projection > 0) as abs_err,
            count(v.actual)::int as n_act,
            coalesce(bool_or(v.actual_source = 'demo'), false) as demo,
            coalesce(bool_or(v.revised_projection is not null), false) as revised
     from sop_values v join sop_lines l on l.id = v.line_id
     where l.active and v.period between $1::date and $2::date
     group by l.stream_id, l.metric, v.period`,
    [from, to],
  ),
);

/** Accuracy for a month across a stream's lines (or all streams): 1 − Σ|A−P| / ΣP vs the baseline projection; bias = (ΣA − ΣP) / ΣP. */
export function streamAccuracy(rows: StreamMonth[], streamId: string | null, period: string): Accuracy & { bias: number | null } {
  let p = 0, a = 0, err = 0, n = 0, demo = false;
  for (const r of rows) {
    if ((streamId && r.stream_id !== streamId) || r.period !== period || !r.n_act || !r.proj_matched) continue;
    p += r.proj_matched; a += r.act_matched ?? 0; err += r.abs_err ?? 0; n += r.n_act; demo ||= r.demo;
  }
  if (!n || p <= 0) return { accuracy: null, bias: null, proj: p, actual: a, rows: 0, demo };
  return { accuracy: Math.max(0, 1 - err / p), bias: (a - p) / p, proj: p, actual: a, rows: n, demo };
}

/** Headline series for a stream (one metric), month by month. */
export function headlineSeries(stream: Stream, rows: StreamMonth[]) {
  const mine = rows.filter((r) => r.stream_id === stream.id);
  const metric = headlineMetric(stream, mine.map((r) => r.metric));
  return { metric, byPeriod: new Map(mine.filter((r) => r.metric === metric).map((r) => [r.period, r])) };
}

/* ---------------- submissions ---------------- */

export async function getSubmissionGrid(periods: string[]) {
  const [streams, subs, reminders] = await Promise.all([
    getStreams(),
    q<{ stream_id: string; period: string; status: string; due_date: string | null; submitted_at: Date | null; note: string | null }>(
      `select stream_id, period, status, due_date, submitted_at, note from sop_submissions where period = any($1::date[])`, [periods]),
    q<{ entity_id: string; last_at: Date; n: number }>(
      `select entity_id, max(created_at) as last_at, count(*)::int as n from followups where entity_type = 'sop_stream' group by entity_id`),
  ]);
  const td = today();
  const cells: SubCell[] = [];
  for (const s of streams)
    for (const p of periods) {
      const row = subs.find((r) => r.stream_id === s.id && r.period === p);
      const due = row?.due_date ?? dueDateFor(p, s.due_day);
      cells.push({
        stream_id: s.id, period: p, due_date: due, exists: !!row, note: row?.note ?? null,
        submitted_at: row?.submitted_at ? new Date(row.submitted_at).toISOString() : null,
        state: subState(row?.status ?? "pending", due, row?.submitted_at ?? null, td),
      });
    }
  const lastReminder = new Map(reminders.map((r) => [r.entity_id, { at: new Date(r.last_at).toISOString(), n: r.n }]));
  return { streams, cells, lastReminder };
}

/** The month whose projections are being collected now (next month), plus the following ones. */
export const inputPeriods = (n = 4, d = today()) => Array.from({ length: n }, (_, i) => addMonths(currentPeriod(d), i));

/* ---------------- rules (configurable thresholds) ---------------- */

export const getRules = cache(async () => {
  const rows = await q<{ key: string; rule: { threshold?: number }; enabled: boolean }>(`select key, rule, enabled from insight_rules where module = 'sop'`);
  const r = (k: string) => rows.find((x) => x.key === k);
  return {
    accuracyThreshold: r("sop.forecast_accuracy")?.rule?.threshold ?? 0.2,
    capacityThreshold: r("sop.capacity_breach")?.rule?.threshold ?? 0,
    capacityEnabled: r("sop.capacity_breach")?.enabled ?? true,
  };
});

/* ---------------- capacity ---------------- */

export interface CapRow { period: string; department: string; warehouse: "North" | "South"; required: number | null; available: number | null; remarks: string | null; updated_at: Date }
export const getCapacity = cache((from: string, to: string) =>
  q<CapRow>(`select period, department, warehouse, required, available, remarks, updated_at from sop_capacity where period between $1::date and $2::date order by period`, [from, to]),
);
export const deptRank = (d: string) => (/inventory|audit/i.test(d) ? 0 : /inward/i.test(d) ? 1 : /forward/i.test(d) ? 2 : /return/i.test(d) ? 3 : 4);
export const sortDepts = (ds: string[]) => [...new Set(ds)].sort((a, b) => deptRank(a) - deptRank(b) || a.localeCompare(b));

export interface Breach { period: string; warehouse: "North" | "South"; department: string; required: number; available: number; gap: number; remarks: string | null }
export async function getCapacityBreaches(from: string, to: string): Promise<Breach[]> {
  const [rows, rules] = await Promise.all([getCapacity(from, to), getRules()]);
  if (!rules.capacityEnabled) return [];
  return rows
    .filter((r) => r.required != null && r.available != null && r.required - r.available > rules.capacityThreshold * (r.available || 1))
    .map((r) => ({ period: r.period, warehouse: r.warehouse, department: r.department, required: r.required!, available: r.available!, gap: r.required! - r.available!, remarks: r.remarks }))
    .sort((a, b) => a.period.localeCompare(b.period) || b.gap - a.gap);
}
export const WH_LABEL: Record<string, string> = { North: "North · GGN", South: "South · BLR" };

/* ---------------- reviews, meetings, actions ---------------- */

export const getSopReview = cache(() =>
  one<{ id: string; name: string; program_id: string | null; mom_owner_id: string | null; cadence: string }>(
    `select id, name, program_id, mom_owner_id, cadence from reviews where module = 'sop' and active order by created_at limit 1`),
);

export interface ReviewMeeting { id: string; title: string; starts_at: Date; ends_at: Date | null; mom_status: string; mom_owner_name: string | null; agenda: string | null; prep_notes: string | null; summary: string | null; attendees: number }
const MEETING_COLS = `m.id, m.title, m.starts_at, m.ends_at, m.mom_status, u.name as mom_owner_name, m.agenda, m.prep_notes, m.summary,
  (select count(*)::int from meeting_attendees a where a.meeting_id = m.id) as attendees`;

/** The next Weekly S&OP Review (today's counts until the day is over). */
export const getNextReview = cache(() =>
  one<ReviewMeeting>(
    `select ${MEETING_COLS} from meetings m join reviews r on r.id = m.review_id left join users u on u.id = m.mom_owner_id
     where r.module = 'sop' and not m.cancelled and m.starts_at >= ($1::date)::timestamp at time zone 'Asia/Kolkata'
     order by m.starts_at limit 1`, [today()]),
);
export async function getPreviousReview(before: Date | string | null) {
  return one<ReviewMeeting>(
    `select ${MEETING_COLS} from meetings m join reviews r on r.id = m.review_id left join users u on u.id = m.mom_owner_id
     where r.module = 'sop' and not m.cancelled and m.starts_at < coalesce($1::timestamptz, now()) and m.starts_at < now()
     order by m.starts_at desc limit 1`, [before ? new Date(before).toISOString() : null]);
}

const SOP_TASK_WHERE = `(t.source = 'sop'
   or t.meeting_id in (select m.id from meetings m join reviews r on r.id = m.review_id where r.module = 'sop')
   or exists (select 1 from task_tags g where g.task_id = t.id and g.tag = 'sop'))`;

/** Open S&OP actions: tasks raised from S&OP, from Weekly S&OP Review meetings, or tagged sop. */
export async function getOpenSopActions(limit = 50): Promise<TaskListItem[]> {
  const ids = await q<{ id: string }>(`select t.id from tasks t where t.status not in ('completed','cancelled') and ${SOP_TASK_WHERE}`);
  if (!ids.length) return [];
  return listTasks({ ids: ids.map((r) => r.id), open: true, limit });
}
export async function getMeetingTasks(meetingId: string) {
  return listTasks({ meetingId, order: "due" });
}

export interface DecisionLite { id: string; title: string; status: string; due_date: string | null; decided_on: string | null; context: string | null; maker_name: string | null }
export async function getMeetingDecisions(meetingId: string) {
  return q<DecisionLite>(`select d.id, d.title, d.status, d.due_date, d.decided_on, d.context, u.name as maker_name from decisions d left join users u on u.id = d.decision_maker_id where d.meeting_id = $1 order by d.created_at`, [meetingId]);
}
/** Decisions still to be taken in the S&OP program (or raised in S&OP meetings). */
export async function getPendingSopDecisions() {
  const r = await getSopReview();
  return q<DecisionLite>(
    `select d.id, d.title, d.status, d.due_date, d.decided_on, d.context, u.name as maker_name
     from decisions d left join users u on u.id = d.decision_maker_id
     where d.status in ('pending','proposed')
       and (d.program_id = $1 or d.project_id in (select id from projects where program_id = $1)
            or d.meeting_id in (select m.id from meetings m join reviews r on r.id = m.review_id where r.module = 'sop'))
     order by d.due_date nulls last`, [r?.program_id ?? null]);
}

/* ---------------- notes & guidelines ---------------- */

export interface Note { id: string; stream_id: string; period: string; kind: string; body: string; author_name: string | null; created_at: Date }
export async function getNotes(periods: string[], streamId?: string) {
  return q<Note>(
    `select n.id, n.stream_id, n.period, n.kind, n.body, u.name as author_name, n.created_at
     from sop_notes n left join users u on u.id = n.author_id
     where n.period = any($1::date[]) ${streamId ? "and n.stream_id = $2" : ""} order by n.created_at desc`,
    streamId ? [periods, streamId] : [periods]);
}

export interface Guideline { text: string; sheet?: string; owners?: string }
export const getGuidelines = cache(async () => {
  const r = await one<{ value: Guideline[] }>(`select value from app_settings where key = 'sop.guidelines'`);
  return Array.isArray(r?.value) ? r!.value : [];
});

/* ---------------- composite: overview ---------------- */

export interface StreamCard {
  stream: Stream;
  metric: string | null;
  closed: { proj: number | null; act: number | null; demo: boolean; variance: number | null; accuracy: number | null };
  current: { proj: number | null; revised: boolean };
  next: SubCell | null;
  note: Note | null;
}

export async function getOverview() {
  const td = today();
  const cur = currentPeriod(td);
  const lastClosed = addMonths(cur, -1);
  const next = addMonths(cur, 1);
  const [monthly, grid, rules, breaches, nextReview, actions, notes] = await Promise.all([
    getStreamMonthly(addMonths(cur, -6), addMonths(cur, 3)),
    getSubmissionGrid([cur, next, addMonths(cur, 2)]),
    getRules(),
    getCapacityBreaches(cur, addMonths(cur, 2)),
    getNextReview(),
    getOpenSopActions(),
    getNotes([lastClosed, cur, next]),
  ]);
  const cards: StreamCard[] = grid.streams.map((s) => {
    const { metric, byPeriod } = headlineSeries(s, monthly);
    const c = byPeriod.get(lastClosed), n = byPeriod.get(cur);
    const acc = streamAccuracy(monthly, s.id, lastClosed);
    return {
      stream: s, metric,
      closed: { proj: c?.proj ?? null, act: c?.n_act ? c.act : null, demo: !!c?.demo, variance: c?.n_act && c.proj_matched ? ((c.act_matched ?? 0) - c.proj_matched) / c.proj_matched : null, accuracy: acc.accuracy },
      current: { proj: n?.eff ?? null, revised: !!n?.revised },
      next: grid.cells.find((x) => x.stream_id === s.id && x.period === next) ?? null,
      note: notes.find((x) => x.stream_id === s.id) ?? null,
    };
  });
  const overall = streamAccuracy(monthly, null, lastClosed);
  const nextPending = grid.cells.filter((c) => c.period === next && isOpenSub(c.state));
  const curLate = grid.cells.filter((c) => c.period === cur && c.state === "late");
  return { td, cur, lastClosed, next, cards, grid, rules, breaches, nextReview, actions, overall, nextPending, curLate };
}

/** Default owner for capacity actions: lead of the warehousing team (falls back to the S&OP review owner). */
export async function getCapacityOwnerId() {
  const r = await one<{ id: string | null }>(
    `select coalesce((select lead_id from teams where name ilike 'warehous%' and lead_id is not null limit 1),
                     (select owner_id from reviews where module = 'sop' and active order by created_at limit 1)) as id`);
  return r?.id ?? null;
}
export async function getCapacityPeriods() {
  return (await q<{ period: string }>(`select distinct period from sop_capacity order by period`)).map((r) => r.period);
}
