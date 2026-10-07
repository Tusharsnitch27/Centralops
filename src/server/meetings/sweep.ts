import "server-only";
import { one, q } from "../db";
import { notify, toInbox } from "../core/notify";
import { istStart } from "./queries";

const g = globalThis as unknown as { __meetingSweep?: Map<string, number> };
const THROTTLE_MS = 2 * 60_000;

function endedAgo(ts: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/**
 * Keeps the MoM workflow moving. Ended meetings without minutes → Inbox for the MoM owner (+ one notification);
 * submitted MoMs → Inbox for PMs; anything handled is resolved. Idempotent and throttled per user.
 * Only meetings from the user's joining date onward are considered (no back-filling).
 */
export async function meetingSweep(userId: string): Promise<void> {
  g.__meetingSweep ??= new Map();
  const last = g.__meetingSweep.get(userId) ?? 0;
  if (Date.now() - last < THROTTLE_MS) return;
  g.__meetingSweep.set(userId, Date.now());

  const u = await one<{ joined_at: string }>(`select joined_at from users where id = $1`, [userId]);
  if (!u) return;
  const since = istStart(u.joined_at);

  const pending = await q<{ id: string; title: string; ends_at: string; owner: string; mom_status: string; notified: boolean }>(
    `select m.id, m.title, coalesce(m.ends_at, m.starts_at) as ends_at, coalesce(m.mom_owner_id, m.organizer_id) as owner, m.mom_status,
            exists (select 1 from notifications n where n.user_id = coalesce(m.mom_owner_id, m.organizer_id) and n.kind = 'mom_pending' and n.entity_id = m.id) as notified
     from meetings m
     where not m.cancelled and coalesce(m.ends_at, m.starts_at) < now() and m.starts_at >= $1 and m.mom_status in ('pending','draft')
       and coalesce(m.mom_owner_id, m.organizer_id) is not null
     order by m.starts_at desc limit 200`, [since]);
  for (const m of pending) {
    const title = m.mom_status === "draft" ? `${m.title} — finish and submit the MoM` : `${m.title} ended ${endedAgo(m.ends_at)} — add MoM`;
    await toInbox({ userId: m.owner, kind: "mom_pending", title, body: "Write the minutes, add quick notes, or mark it skipped / not relevant.", entityType: "meeting", entityId: m.id, href: `/meetings/${m.id}`, priority: 70, dedupeKey: `meeting:${m.id}:mom` });
    if (!m.notified) await notify({ userId: m.owner, kind: "mom_pending", title: `Add the MoM for ${m.title}`, body: `The meeting ended ${endedAgo(m.ends_at)}.`, entityType: "meeting", entityId: m.id, href: `/meetings/${m.id}` });
  }

  const submitted = await q<{ id: string; title: string; owner_name: string | null; n: number }>(
    `select m.id, m.title, u.name as owner_name, (select count(*)::int from meeting_suggestions s where s.meeting_id = m.id and s.status = 'pending') as n
     from meetings m left join users u on u.id = m.mom_owner_id
     where not m.cancelled and m.mom_status = 'submitted' and m.starts_at >= $1 limit 100`, [since]);
  if (submitted.length) {
    const pms = await q<{ id: string }>(`select id from users where active and role in ('admin','pm')`);
    for (const m of submitted)
      for (const pm of pms)
        await toInbox({ userId: pm.id, kind: "mom_review", title: `Review MoM: ${m.title}`, body: `${m.owner_name ?? "The owner"} submitted the minutes — ${m.n} suggested item${m.n === 1 ? "" : "s"} to accept, edit or ignore.`, entityType: "meeting", entityId: m.id, href: `/meetings/${m.id}`, priority: 75, dedupeKey: `meeting:${m.id}:review` });
  }

  // resolve anything already handled
  await q(
    `update inbox_items i set status = 'done', resolved_at = now()
     from meetings m
     where i.status <> 'done' and i.entity_type = 'meeting' and i.entity_id = m.id and (
       (i.dedupe_key = 'meeting:' || m.id || ':mom' and m.mom_status in ('submitted','skipped','not_relevant','distributed'))
       or (i.dedupe_key = 'meeting:' || m.id || ':review' and m.mom_status in ('skipped','not_relevant','distributed')))`);
}
