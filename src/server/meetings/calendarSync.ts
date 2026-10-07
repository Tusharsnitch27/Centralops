import "server-only";
import { one, q, tx } from "../db";
import { logActivity } from "../core/activity";
import { googleAccessToken } from "../integrations/google";
import { today } from "@/lib/dates";
import { istStart } from "./queries";

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; optional?: boolean; resource?: boolean }[];
  eventType?: string;
}

export interface SyncResult { fetched: number; imported: number; updated: number; skipped: number; cancelled: number }

/**
 * Pull the user's primary Google Calendar into meetings. Window: max(joined_at, now − 2d) → now + 14d (never before joining).
 * Recurring instances share series_key; titles matching a review's calendar_match attach to that review and inherit its MoM owner.
 * Cancelled, declined and all-day events are skipped.
 */
export async function syncCalendar(userId: string): Promise<SyncResult> {
  const user = await one<{ id: string; email: string | null; joined_at: string }>(`select id, email, joined_at from users where id = $1`, [userId]);
  if (!user) throw new Error("User not found");
  const integ = await one<{ id: string; account_email: string | null }>(`select id, account_email from integrations where user_id = $1 and provider = 'google_calendar' and status <> 'disconnected'`, [userId]);
  if (!integ) throw new Error("Google Calendar isn't connected");
  const token = await googleAccessToken(userId);
  if (!token) throw new Error("Google access expired — reconnect Google Calendar");

  const joined = istStart(user.joined_at).getTime();
  const timeMin = new Date(Math.max(joined, Date.now() - 2 * 86400_000)).toISOString();
  const timeMax = new Date(Date.now() + 14 * 86400_000).toISOString();

  const events: GEvent[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 6; i++) {
    const p = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin, timeMax, maxResults: "250", showDeleted: "true" });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!r.ok) {
      const msg = `Calendar fetch failed (${r.status})`;
      await q(`update integrations set status = 'error', last_error = $2 where id = $1`, [integ.id, msg]);
      throw new Error(msg);
    }
    const j = (await r.json()) as { items?: GEvent[]; nextPageToken?: string };
    events.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }

  const [people, reviews] = await Promise.all([
    q<{ id: string; email: string | null; name: string }>(`select id, lower(email) as email, name from users where active`),
    q<{ id: string; calendar_match: string; mom_owner_id: string | null; program_id: string | null; project_id: string | null }>(
      `select id, lower(calendar_match) as calendar_match, mom_owner_id, program_id, project_id from reviews where active and calendar_match is not null and calendar_match <> ''`),
  ]);
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!, p.id]));
  const myEmails = new Set([user.email?.toLowerCase(), integ.account_email?.toLowerCase()].filter(Boolean) as string[]);

  const res: SyncResult = { fetched: events.length, imported: 0, updated: 0, skipped: 0, cancelled: 0 };
  for (const ev of events) {
    const start = ev.start?.dateTime, end = ev.end?.dateTime;
    const existing = await one<{ id: string }>(`select id from meetings where calendar_event_id = $1`, [ev.id]);
    if (ev.status === "cancelled") {
      if (existing) { await q(`update meetings set cancelled = true, updated_at = now() where id = $1`, [existing.id]); res.cancelled++; }
      continue;
    }
    const me = ev.attendees?.find((a) => a.self || (a.email && myEmails.has(a.email.toLowerCase())));
    if (!start || !end || me?.responseStatus === "declined" || ev.eventType === "workingLocation" || ev.eventType === "outOfOffice" || ev.eventType === "focusTime") { res.skipped++; continue; }
    if (new Date(start).getTime() < joined) { res.skipped++; continue; }

    const title = (ev.summary ?? "Untitled meeting").trim();
    const review = reviews.find((r) => title.toLowerCase().includes(r.calendar_match));
    const organizerId = ev.organizer?.self ? userId : (ev.organizer?.email ? byEmail.get(ev.organizer.email.toLowerCase()) : undefined) ?? userId;
    const momOwner = review?.mom_owner_id ?? organizerId ?? userId;
    const attendees = (ev.attendees ?? []).filter((a) => !a.resource && a.email);

    await tx(async (x) => {
      const ce = await x.one<{ id: string }>(
        `insert into calendar_events (integration_id, external_id, calendar_id, title, starts_at, ends_at, attendees, raw, status, synced_at)
         values ($1,$2,'primary',$3,$4,$5,$6,$7,$8, now())
         on conflict (integration_id, external_id) do update set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           attendees = excluded.attendees, raw = excluded.raw, status = excluded.status, synced_at = now()
         returning id`,
        [integ.id, ev.id, title, start, end, JSON.stringify(attendees), JSON.stringify(ev), ev.status ?? "confirmed"]);
      let meetingId: string;
      if (existing) {
        // keep the MoM workflow untouched; refresh schedule + linkage only
        await x.q(`update meetings set title = $2, starts_at = $3, ends_at = $4, location = $5, meet_url = $6, cancelled = false,
                     review_id = coalesce(review_id, $7), program_id = coalesce(program_id, $8), project_id = coalesce(project_id, $9), updated_at = now() where id = $1`,
          [existing.id, title, start, end, ev.location ?? null, ev.hangoutLink ?? null, review?.id ?? null, review?.program_id ?? null, review?.project_id ?? null]);
        meetingId = existing.id;
        res.updated++;
      } else {
        const row = await x.one<{ id: string }>(
          `insert into meetings (title, starts_at, ends_at, location, meet_url, is_recurring, series_key, review_id, program_id, project_id, organizer_id, mom_owner_id, agenda,
             source, calendar_event_id, mom_due_at, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'calendar',$14, $3::timestamptz + interval '24 hours', $15)
           on conflict (calendar_event_id) where calendar_event_id is not null do update set title = excluded.title
           returning id`,
          [title, start, end, ev.location ?? null, ev.hangoutLink ?? null, Boolean(ev.recurringEventId), ev.recurringEventId ?? (review ? `review:${review.id}` : null),
            review?.id ?? null, review?.program_id ?? null, review?.project_id ?? null, organizerId, momOwner, ev.description?.slice(0, 4000) ?? null, ev.id, userId]);
        meetingId = row!.id;
        res.imported++;
      }
      await x.q(`update calendar_events set meeting_id = $2 where id = $1`, [ce!.id, meetingId]);
      await x.q(`delete from meeting_attendees where meeting_id = $1`, [meetingId]);
      for (const a of attendees)
        await x.q(`insert into meeting_attendees (meeting_id, user_id, email, name, response, is_optional) values ($1,$2,$3,$4,$5,$6)`,
          [meetingId, byEmail.get(a.email!.toLowerCase()) ?? null, a.email, a.displayName ?? a.email!.split("@")[0], a.responseStatus ?? null, Boolean(a.optional)]);
      if (!attendees.length) await x.q(`insert into meeting_attendees (meeting_id, user_id, name, response) select $1, id, name, 'accepted' from users where id = $2`, [meetingId, userId]);
    });
  }
  await q(`update integrations set last_sync_at = now(), status = 'connected', last_error = null, config = config || $2::jsonb where id = $1`,
    [integ.id, JSON.stringify({ last_result: res, last_window: { from: timeMin, to: timeMax }, synced_on: today() })]);
  await logActivity({ actorId: userId, entityType: "integration", entityId: integ.id, action: "synced", summary: `Google Calendar: ${res.imported} new, ${res.updated} updated, ${res.skipped} skipped` });
  return res;
}
