import "server-only";
import { addMonths, diffDays, fmtDate, fmtMonth, fmtTime, today, dateOf } from "@/lib/dates";
import { num, pct } from "@/lib/format";
import { currentPeriod, isOpenSub, metricLabel, SUB_META, type Stream, type SubCell } from "./model";
import {
  getCapacityBreaches, getMeetingDecisions, getMeetingTasks, getNextReview, getPendingSopDecisions, getPreviousReview, getRules,
  getStreamMonthly, getSubmissionGrid, headlineSeries, streamAccuracy, WH_LABEL, type Breach, type DecisionLite, type ReviewMeeting,
} from "./queries";
import type { TaskListItem } from "../tasks/queries";

export interface Change { stream: Stream; metric: string | null; kind: "mom" | "revision"; from: number; to: number; delta: number; fromLabel: string; toLabel: string }
export interface AccuracyRow { stream: Stream; accuracy: number | null; bias: number | null; demo: boolean }
export interface DecisionItem { title: string; detail?: string | null; suggested: boolean; href?: string }

export interface ReviewBrief {
  meeting: ReviewMeeting | null;
  previous: ReviewMeeting | null;
  prevTasks: TaskListItem[];
  prevDecisions: DecisionLite[];
  closure: { closed: number; total: number; overdue: number };
  periods: { cur: string; next: string; lastClosed: string };
  inputs: { period: string; due: string | null; received: SubCell[]; pending: SubCell[] }[];
  streams: Map<string, Stream>;
  changes: Change[];
  accuracy: { overall: number | null; bias: number | null; demo: boolean; rows: AccuracyRow[]; threshold: number };
  breaches: Breach[];
  decisions: DecisionItem[];
  text: string;
}

export async function buildReviewBrief(): Promise<ReviewBrief> {
  const td = today();
  const cur = currentPeriod(td), next = addMonths(cur, 1), lastClosed = addMonths(cur, -1);
  const meeting = await getNextReview();
  const previous = await getPreviousReview(meeting?.starts_at ?? null);
  const [prevTasks, prevDecisions, grid, monthly, breaches, pendingDecisions, rules] = await Promise.all([
    previous ? getMeetingTasks(previous.id) : Promise.resolve([] as TaskListItem[]),
    previous ? getMeetingDecisions(previous.id) : Promise.resolve([] as DecisionLite[]),
    getSubmissionGrid([cur, next, addMonths(cur, 2)]),
    getStreamMonthly(addMonths(cur, -2), addMonths(cur, 2)),
    getCapacityBreaches(cur, addMonths(cur, 2)),
    getPendingSopDecisions(),
    getRules(),
  ]);
  const streams = new Map(grid.streams.map((s) => [s.id, s]));

  const closed = prevTasks.filter((t) => t.status === "completed" || t.status === "cancelled").length;
  const overdue = prevTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled" && t.due_date && t.due_date < td).length;

  const inputs = [cur, next, addMonths(cur, 2)].map((p) => {
    const cells = grid.cells.filter((c) => c.period === p && c.state !== "na");
    return { period: p, due: cells[0]?.due_date ?? null, received: cells.filter((c) => !isOpenSub(c.state)), pending: cells.filter((c) => isOpenSub(c.state)) };
  });

  const changes: Change[] = [];
  for (const s of grid.streams) {
    const { metric, byPeriod } = headlineSeries(s, monthly);
    const a = byPeriod.get(cur), b = byPeriod.get(next);
    if (a?.eff && b?.eff && Math.abs(b.eff - a.eff) / a.eff >= 0.1)
      changes.push({ stream: s, metric, kind: "mom", from: a.eff, to: b.eff, delta: (b.eff - a.eff) / a.eff, fromLabel: fmtMonth(cur), toLabel: fmtMonth(next) });
    if (a?.revised && a.proj && a.eff != null && a.eff !== a.proj)
      changes.push({ stream: s, metric, kind: "revision", from: a.proj, to: a.eff, delta: (a.eff - a.proj) / a.proj, fromLabel: "baseline", toLabel: "revised" });
  }
  changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const overall = streamAccuracy(monthly, null, lastClosed);
  const accRows: AccuracyRow[] = grid.streams
    .map((s) => { const a = streamAccuracy(monthly, s.id, lastClosed); return { stream: s, accuracy: a.accuracy, bias: a.bias, demo: a.demo }; })
    .filter((r) => r.accuracy != null)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1));

  const decisions: DecisionItem[] = pendingDecisions.map((d) => ({ title: d.title, detail: d.due_date ? `Due ${fmtDate(d.due_date)}${d.maker_name ? ` · ${d.maker_name}` : ""}` : d.maker_name, suggested: false, href: `/decisions/${d.id}` }));
  const nextIn = inputs[1]!;
  if (nextIn.pending.length && nextIn.due && diffDays(nextIn.due, td) <= 14)
    decisions.push({ suggested: true, title: `Escalate ${nextIn.pending.length} pending ${fmtMonth(next)} input${nextIn.pending.length === 1 ? "" : "s"} before ${fmtDate(nextIn.due)}?`, detail: nextIn.pending.map((c) => streams.get(c.stream_id)?.name).join(", "), href: "/sop/inputs" });
  const worstNext = breaches.filter((b) => b.period === next).slice(0, 2);
  for (const b of worstNext)
    decisions.push({ suggested: true, title: `Mitigation for ${b.department} · ${WH_LABEL[b.warehouse]} in ${fmtMonth(b.period)} — ${num(b.gap)}/day short`, detail: "Temp manpower, OT / second shift, or shift volume to the other warehouse.", href: `/sop/capacity?month=${b.period}` });
  const lowAcc = accRows.filter((r) => r.accuracy != null && r.accuracy < 1 - rules.accuracyThreshold);
  if (lowAcc.length)
    decisions.push({ suggested: true, title: `Agree corrective actions for low projection accuracy: ${lowAcc.map((r) => r.stream.name).join(", ")}`, detail: `Below ${pct(1 - rules.accuracyThreshold)} accuracy in ${fmtMonth(lastClosed)}.`, href: "/sop/projections" });

  const brief: Omit<ReviewBrief, "text"> = {
    meeting, previous, prevTasks, prevDecisions, closure: { closed, total: prevTasks.length, overdue },
    periods: { cur, next, lastClosed }, inputs, streams, changes,
    accuracy: { overall: overall.accuracy, bias: overall.bias, demo: overall.demo, rows: accRows, threshold: rules.accuracyThreshold },
    breaches, decisions,
  };
  return { ...brief, text: briefText(brief) };
}

const poc = (s: Stream | undefined) => s?.poc_name ?? s?.poc_label ?? "—";

function briefText(b: Omit<ReviewBrief, "text">) {
  const L: string[] = [];
  const m = b.meeting;
  L.push(`S&OP REVIEW — PRE-READ`);
  L.push(m ? `${m.title} · ${fmtDate(dateOf(m.starts_at), { dow: true })}, ${fmtTime(m.starts_at)}${m.mom_owner_name ? ` · MoM: ${m.mom_owner_name}` : ""}` : "Next Weekly S&OP Review not yet on the calendar");
  L.push("");
  L.push(`1. PREVIOUS REVIEW${b.previous ? ` (${fmtDate(dateOf(b.previous.starts_at))})` : ""}`);
  if (!b.previous) L.push("   No previous review on record.");
  else {
    if (b.prevDecisions.length) { L.push("   Decisions:"); for (const d of b.prevDecisions) L.push(`   - ${d.title}`); }
    L.push(`   Actions: ${b.closure.closed} of ${b.closure.total} closed${b.closure.overdue ? `, ${b.closure.overdue} overdue` : ""}`);
    for (const t of b.prevTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled"))
      L.push(`   - [open] ${t.title} — ${t.owner_name ?? t.owner_team_name ?? "unassigned"}${t.due_date ? `, due ${fmtDate(t.due_date)}` : ""}`);
  }
  L.push("");
  L.push("2. INPUTS");
  for (const i of b.inputs) {
    L.push(`   ${fmtMonth(i.period)}: ${i.received.length} of ${i.received.length + i.pending.length} received${i.due ? ` (due ${fmtDate(i.due)})` : ""}`);
    for (const c of i.pending) L.push(`   - ${SUB_META[c.state].label}: ${b.streams.get(c.stream_id)?.name} (${poc(b.streams.get(c.stream_id))})`);
  }
  L.push("");
  L.push("3. MAJOR CHANGES");
  if (!b.changes.length) L.push("   No projection moves of 10% or more.");
  for (const c of b.changes.slice(0, 8))
    L.push(`   - ${c.stream.name} ${metricLabel(c.metric).toLowerCase()}: ${num(c.from)} (${c.fromLabel}) → ${num(c.to)} (${c.toLabel}), ${pct(c.delta, 0, true)}`);
  L.push("");
  L.push(`4. PROJECTION ACCURACY — ${fmtMonth(b.periods.lastClosed)}${b.accuracy.demo ? " [DEMO ACTUALS — will come from Snowflake]" : ""}`);
  L.push(`   Overall ${pct(b.accuracy.overall)}${b.accuracy.bias != null ? `, bias ${pct(b.accuracy.bias, 0, true)} (${b.accuracy.bias > 0 ? "under-projected" : "over-projected"})` : ""}`);
  for (const r of b.accuracy.rows) L.push(`   - ${r.stream.name}: ${pct(r.accuracy)}${r.bias != null ? ` (bias ${pct(r.bias, 0, true)})` : ""}`);
  L.push("");
  L.push("5. CAPACITY RISKS");
  if (!b.breaches.length) L.push("   No breaches: required ≤ available for every department.");
  for (const x of b.breaches.slice(0, 10))
    L.push(`   - ${fmtMonth(x.period)} · ${WH_LABEL[x.warehouse]} · ${x.department}: needs ${num(x.required)}/day vs ${num(x.available)} available — ${num(x.gap)} short`);
  if (b.breaches.length > 10) L.push(`   + ${b.breaches.length - 10} more`);
  L.push("");
  L.push("6. DECISIONS REQUIRED");
  if (!b.decisions.length) L.push("   None.");
  for (const d of b.decisions) L.push(`   - ${d.title}${d.suggested ? " (suggested)" : ""}${d.detail ? ` — ${d.detail}` : ""}`);
  return L.join("\n");
}
