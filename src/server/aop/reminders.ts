import "server-only";
import { one, q } from "../db";
import { notify, toInbox } from "../core/notify";
import { sendWhatsApp, waProvider, type WaResult } from "../integrations/whatsapp";
import { addMonths, diffDays, fmtDate, today } from "@/lib/dates";
import { allItemsOf, loadModel, resolveCycle, sectionOwner, type Model } from "./model";
import { dueDate, KIND_MEASURE, type InputKind } from "./deadlines";
import { monLabel } from "./calc";

export interface LateInput {
  sectionId: string; fn: string; ownerId: string | null; ownerName: string | null; kind: InputKind; period: string; due: string;
  daysLate: number; missing: number; total: number; missingNames: string[];
}

const KIND_WORD: Record<InputKind, string> = { budget: "budget", projections: "provision", actuals: "actuals" };

/** Inputs that are due today or late, per function × month × kind (budget / provision / actuals). Looks back two months. */
export function lateInputs(m: Model, ref = today()): LateInput[] {
  const cur = `${ref.slice(0, 7)}-01`;
  const want: [InputKind, string][] = [];
  for (const p of [cur, addMonths(cur, 1)]) want.push(["budget", p]);
  for (const p of [addMonths(cur, -1), cur]) want.push(["projections", p]);
  for (const p of [addMonths(cur, -2), addMonths(cur, -1)]) want.push(["actuals", p]);
  const out: LateInput[] = [];
  for (const [kind, period] of want) {
    if (!m.months.includes(period)) continue;
    const measure = KIND_MEASURE[kind];
    for (const f of m.functions) {
      const due = dueDate(m.cycle.deadlines, measure, period, f.name);
      const daysLate = diffDays(ref, due);
      if (daysLate < 0) continue;
      const items = allItemsOf(f).filter((it) => {
        const v = it.vals[period];
        if (kind === "budget") return m.closed.slice(-3).some((p) => (it.vals[p]?.plan ?? 0) !== 0 || it.vals[p]?.actual != null) || v?.plan != null;
        if (kind === "projections") return (v?.plan ?? 0) !== 0 && v?.actual == null; // a provision only matters until the actual lands
        return (v?.plan ?? 0) !== 0 || (v?.forecast ?? 0) !== 0;
      });
      const missing = items.filter((it) => { const v = it.vals[period]; return kind === "budget" ? v?.plan == null : kind === "projections" ? v?.forecast == null : v?.actual == null; });
      if (!missing.length) continue;
      const owner = sectionOwner(f);
      out.push({ sectionId: f.id, fn: f.name, ownerId: owner?.id ?? null, ownerName: owner?.name ?? null, kind, period, due, daysLate, missing: missing.length, total: items.length, missingNames: missing.slice(0, 5).map((i) => i.name) });
    }
  }
  return out.sort((a, b) => b.daysLate - a.daysLate);
}

export interface ReminderRun { at: string; provider: string; checked: number; sent: { to: string; fn: string; what: string; status: WaResult["status"]; reason?: string }[] }

/**
 * Daily job: nudges owners on the due date and every N days while late (up to a cap); escalates to the PM after M days.
 * Each message is logged once per item per day. `force` ignores the cadence (manual "remind now").
 */
export async function runAopReminders(opts: { cycleId?: string; actorId?: string | null; force?: boolean; onlySectionIds?: string[] } = {}): Promise<ReminderRun> {
  const cycle = await resolveCycle(opts.cycleId);
  const run: ReminderRun = { at: new Date().toISOString(), provider: await waProvider(), checked: 0, sent: [] };
  if (!cycle || cycle.status !== "active") return run;
  const m = (await loadModel(cycle.id))!;
  const pol = cycle.deadlines.reminders;
  if (!pol.enabled && !opts.force) return run;
  const t = today();
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const pm = cycle.owner_id ?? (await one<{ id: string }>(`select id from users where role = 'admin' and active order by created_at limit 1`))?.id ?? null;
  const items = lateInputs(m).filter((x) => !opts.onlySectionIds || opts.onlySectionIds.includes(x.sectionId));
  run.checked = items.length;
  for (const x of items) {
    const prior = (await one<{ n: number }>(`select count(*)::int as n from message_log where entity_type = 'aop_section' and entity_id = $1 and dedupe_key like $2`, [x.sectionId, `aop:${x.sectionId}:${x.kind}:${x.period}:%`]))?.n ?? 0;
    const onCadence = x.daysLate === 0 ? pol.dueDayNudge : (x.daysLate - 1) % Math.max(1, pol.everyDays) === 0;
    if (!opts.force && (!onCadence || prior >= pol.maxPerItem)) continue;
    const what = `${monLabel(x.period)} ${KIND_WORD[x.kind]}`;
    const link = `${base}/aop/inputs?period=${x.period}`;
    const lateText = x.daysLate === 0 ? "due today" : `${x.daysLate} day${x.daysLate === 1 ? "" : "s"} overdue`;
    if (x.ownerId) {
      const first = (x.ownerName ?? "there").split(" ")[0];
      const text = `Hi ${first}, ${x.fn} ${what} ${x.daysLate === 0 ? `are due today (${fmtDate(x.due)})` : `were due on ${fmtDate(x.due)} — ${lateText}`}. ${x.missing} of ${x.total} lines pending (${x.missingNames.slice(0, 3).join(", ")}${x.missing > 3 ? "…" : ""}). Update here: ${link}`;
      const r = await sendWhatsApp({ userId: x.ownerId, params: [first, `${x.fn} ${what}`, fmtDate(x.due), lateText, `${x.missing} of ${x.total}`, link], text,
        entityType: "aop_section", entityId: x.sectionId, dedupeKey: `aop:${x.sectionId}:${x.kind}:${x.period}:${t}${opts.force ? `:m${Date.now()}` : ""}`, actorId: opts.actorId ?? null });
      run.sent.push({ to: x.ownerName ?? "owner", fn: x.fn, what, status: r.status, reason: r.reason });
      await notify({ userId: x.ownerId, kind: "aop_input", title: `${x.fn}: ${what} ${lateText}`, body: `${x.missing} of ${x.total} lines pending`, href: `/aop/inputs?period=${x.period}`, entityType: "aop_section", entityId: x.sectionId, actorId: opts.actorId ?? null });
      await toInbox({ userId: x.ownerId, kind: "aop_submission", title: `${x.fn}: ${what} ${lateText}`, body: `${x.missing} of ${x.total} lines pending.`, href: `/aop/inputs?period=${x.period}`, entityType: "aop_section", entityId: x.sectionId, priority: x.daysLate ? 75 : 60, dedupeKey: `aop_submission:${x.sectionId}:${x.period}:${x.kind}` });
    }
    if (pm && x.daysLate >= pol.escalateAfterDays && pm !== x.ownerId) {
      const text = `Escalation: ${x.fn} ${what} are ${lateText} (owner ${x.ownerName ?? "unassigned"}; ${x.missing}/${x.total} lines pending). ${link}`;
      const r = await sendWhatsApp({ userId: pm, params: ["", `${x.fn} ${what}`, fmtDate(x.due), lateText, `${x.missing} of ${x.total}`, link], text,
        entityType: "aop_section", entityId: x.sectionId, dedupeKey: `aop:${x.sectionId}:${x.kind}:${x.period}:${t}:pm${opts.force ? `:m${Date.now()}` : ""}`, actorId: opts.actorId ?? null });
      run.sent.push({ to: "PM (escalation)", fn: x.fn, what, status: r.status, reason: r.reason });
    }
  }
  await q(`insert into app_settings (key, value) values ('reminders.last_run', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ at: run.at, sent: run.sent.length, checked: run.checked })]);
  return run;
}
