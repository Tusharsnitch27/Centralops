import "server-only";
import { q } from "../db";
import { toInbox } from "../core/notify";
import { meetingSweep } from "../meetings/sweep";
import { today } from "@/lib/dates";
import type { User } from "../auth";

const g = globalThis as unknown as { __sweepAt?: Map<string, number> };
g.__sweepAt ??= new Map();

/**
 * Generates Inbox items from the current state (idempotent via dedupe keys) and closes the ones whose
 * underlying condition is gone. Throttled per user. Module-specific sweeps (meetings) are called from here.
 */
export async function runSweeps(u: User, opts: { force?: boolean } = {}) {
  const last = g.__sweepAt!.get(u.id) ?? 0;
  if (!opts.force && Date.now() - last < 90_000) return;
  g.__sweepAt!.set(u.id, Date.now());
  const t = today();
  const manager = u.role === "admin" || u.role === "pm";

  // 1 · my overdue tasks
  const overdue = await q<{ id: string; title: string; due_date: string; number: number }>(
    `select id, title, due_date, number from tasks where owner_id = $1 and status in ('not_started','in_progress','waiting','blocked') and due_date < $2`, [u.id, t]);
  for (const x of overdue)
    await toInbox({ userId: u.id, kind: "overdue", title: `Overdue: ${x.title}`, body: `CO-${x.number} was due ${x.due_date}. Update it, move the date or close it.`, entityType: "task", entityId: x.id, href: `/tasks/${x.id}`, priority: 70, dedupeKey: `task:${x.id}:overdue:${x.due_date}` });
  await q(`update inbox_items i set status = 'done', resolved_at = now() from tasks k
           where i.user_id = $1 and i.kind = 'overdue' and i.status = 'open' and k.id = i.entity_id
             and (k.status in ('completed','cancelled') or k.due_date >= $2 or k.owner_id is distinct from $1)`, [u.id, t]);

  // 2 · tasks newly assigned to me by someone else, not yet acknowledged
  const fresh = await q<{ id: string; title: string; by: string | null }>(
    `select t.id, t.title, r.name as by from tasks t left join users r on r.id = coalesce(t.requester_id, t.created_by)
     where t.owner_id = $1 and t.acknowledged_at is null and t.status = 'not_started' and coalesce(t.requester_id, t.created_by) <> $1 and t.created_at > now() - interval '14 days'`, [u.id]);
  for (const x of fresh)
    await toInbox({ userId: u.id, kind: "task_assigned", title: `New task from ${x.by ?? "someone"}: ${x.title}`, body: "Acknowledge it by starting it, or reply with an update.", entityType: "task", entityId: x.id, href: `/tasks/${x.id}`, priority: 55, dedupeKey: `task:${x.id}:assigned` });
  await q(`update inbox_items i set status = 'done', resolved_at = now() from tasks k
           where i.user_id = $1 and i.kind = 'task_assigned' and i.status = 'open' and k.id = i.entity_id and (k.acknowledged_at is not null or k.status <> 'not_started')`, [u.id]);

  // 3 · decisions I must take soon
  const decisions = await q<{ id: string; title: string; due_date: string | null }>(
    `select id, title, due_date from decisions where status in ('pending','proposed') and decision_maker_id = $1 and (due_date is null or due_date <= $2::date + 5)`, [u.id, t]);
  for (const d of decisions)
    await toInbox({ userId: u.id, kind: "decision", title: `Decision required: ${d.title}`, body: d.due_date ? `Needed by ${d.due_date}.` : null, entityType: "decision", entityId: d.id, href: `/decisions?focus=${d.id}`, priority: 65, dedupeKey: `decision:${d.id}:required` });
  await q(`update inbox_items i set status = 'done', resolved_at = now() from decisions d where i.user_id = $1 and i.kind = 'decision' and i.status = 'open' and d.id = i.entity_id and d.status not in ('pending','proposed')`, [u.id]);

  // 4 · escalated risks (for PMs) and risks I own past target
  const risks = await q<{ id: string; title: string; status: string; owner_id: string | null }>(
    `select id, title, status, owner_id from risks where (status = 'escalated' and $2) or (owner_id = $1 and status <> 'closed' and target_date < $3)`, [u.id, manager, t]);
  for (const r of risks)
    await toInbox({ userId: u.id, kind: "risk", title: r.status === "escalated" ? `Risk escalated: ${r.title}` : `Risk past target date: ${r.title}`, entityType: "risk", entityId: r.id, href: `/risks?focus=${r.id}`, priority: r.status === "escalated" ? 75 : 50, dedupeKey: `risk:${r.id}:${r.status}` });

  // 5 · AOP / S&OP inputs I owe
  const aop = await q<{ id: string; name: string; period: string; kind: string; due_date: string }>(
    `select s.id, sec.name, s.period, s.kind, s.due_date from aop_submissions s join aop_sections sec on sec.id = s.section_id join aop_cycles c on c.id = s.cycle_id
     where c.status = 'active' and s.status = 'pending' and s.owner_id = $1 and s.due_date <= $2::date + 5`, [u.id, t]);
  for (const a of aop)
    await toInbox({ userId: u.id, kind: "aop_submission", title: `AOP ${a.kind} due: ${a.name} · ${a.period.slice(0, 7)}`, body: `Due ${a.due_date}.`, entityType: "aop_section", entityId: a.id, href: `/aop/inputs`, priority: a.due_date < t ? 72 : 58, dedupeKey: `aop:${a.id}` });
  await q(`update inbox_items i set status = 'done', resolved_at = now() from aop_submissions s where i.user_id = $1 and i.kind = 'aop_submission' and i.status = 'open' and s.id = i.entity_id and s.status <> 'pending'`, [u.id]);
  const sop = await q<{ id: string; name: string; period: string; due_date: string }>(
    `select s.id, st.name, s.period, s.due_date from sop_submissions s join sop_streams st on st.id = s.stream_id
     where s.status in ('pending','late') and st.poc_id = $1 and s.due_date <= $2::date + 7`, [u.id, t]);
  for (const s of sop)
    await toInbox({ userId: u.id, kind: "sop_submission", title: `S&OP projection due: ${s.name} · ${s.period.slice(0, 7)}`, body: `Due ${s.due_date}.`, entityType: "sop_stream", entityId: s.id, href: `/sop/inputs`, priority: s.due_date < t ? 72 : 58, dedupeKey: `sop:${s.id}` });
  await q(`update inbox_items i set status = 'done', resolved_at = now() from sop_submissions s where i.user_id = $1 and i.kind = 'sop_submission' and i.status = 'open' and s.id = i.entity_id and s.status not in ('pending','late')`, [u.id]);

  // 6 · first-run capture
  if (!u.onboarded_at)
    await toInbox({ userId: u.id, kind: "onboarding", title: "Capture everything you're working on", body: "Open tasks, recurring meetings and people you're waiting on — so Central Ops can start tracking from today.", href: "/welcome", priority: 90, dedupeKey: "onboarding" });
  else await q(`update inbox_items set status = 'done', resolved_at = now() where user_id = $1 and dedupe_key = 'onboarding' and status = 'open'`, [u.id]);

  // 7 · module sweeps
  await moduleSweeps(u);
}

/** Module-owned sweeps (MoM prompts for meeting owners, review prompts for PMs). */
async function moduleSweeps(u: User) {
  try {
    await meetingSweep(u.id);
  } catch (e) {
    console.warn("[sweep] meetings", e instanceof Error ? e.message : e);
  }
}
