"use server";
import { revalidatePath } from "next/cache";
import { one, q, tx } from "../db";
import { requireUser, canEdit, canManage, type User } from "../auth";
import { logActivity, link } from "../core/activity";
import { notify, resolveInbox, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { createTask, updateTask } from "../tasks/core";
import { addDays, dateOf, today } from "@/lib/dates";
import { extractMom, type SuggestionKind, type SuggestionPayload } from "./extract";
import { getMomNote } from "./queries";

const refresh = (id?: string) => { revalidatePath("/", "layout"); if (id) revalidatePath(`/meetings/${id}`); };

interface MeetingAuth { id: string; title: string; starts_at: string; ends_at: string | null; mom_status: string; mom_owner_id: string | null; organizer_id: string | null; project_id: string | null; program_id: string | null; review_id: string | null }
async function loadMeeting(id: string) {
  const m = await one<MeetingAuth>(`select id, title, starts_at, ends_at, mom_status, mom_owner_id, organizer_id, project_id, program_id, review_id from meetings where id = $1`, [id]);
  if (!m) throw new Error("Meeting not found");
  return m;
}
const canWriteMom = (u: User, m: MeetingAuth) => canEdit(u) && (canManage(u) || m.mom_owner_id === u.id || (!m.mom_owner_id && m.organizer_id === u.id));
const managers = () => q<{ id: string; name: string }>(`select id, name from users where active and role in ('admin','pm')`);

/* ---------- create ---------- */

export interface NewMeetingInput {
  title: string; date: string; start: string; end: string; attendeeIds: string[]; momOwnerId: string | null;
  reviewId: string | null; projectId: string | null; programId: string | null; agenda: string | null;
}
export async function createMeeting(input: NewMeetingInput): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    if (!input.title?.trim()) throw new Error("Give the meeting a title");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end)) throw new Error("Pick a date and time");
    if (input.date < u.joined_at) throw new Error("Meetings before your joining date can't be added");
    const starts = `${input.date}T${input.start}:00+05:30`;
    const ends = `${input.date}T${input.end}:00+05:30`;
    if (ends <= starts) throw new Error("End time must be after the start");
    const review = input.reviewId ? await one<{ mom_owner_id: string | null; program_id: string | null; project_id: string | null; name: string }>(`select mom_owner_id, program_id, project_id, name from reviews where id = $1`, [input.reviewId]) : null;
    const projectProgram = input.projectId ? (await one<{ program_id: string | null }>(`select program_id from projects where id = $1`, [input.projectId]))?.program_id ?? null : null;
    const momOwner = input.momOwnerId ?? review?.mom_owner_id ?? u.id;
    const id = await tx(async (x) => {
      const row = await x.one<{ id: string }>(
        `insert into meetings (title, starts_at, ends_at, review_id, program_id, project_id, organizer_id, mom_owner_id, agenda, source, is_recurring, series_key, mom_due_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, $3::timestamptz + interval '24 hours', $7) returning id`,
        [input.title.trim(), starts, ends, input.reviewId, input.programId ?? review?.program_id ?? projectProgram, input.projectId ?? review?.project_id ?? null, u.id, momOwner,
          input.agenda?.trim() || null, Boolean(review), review?.name ?? null]);
      const mid = row!.id;
      const ids = [...new Set([...input.attendeeIds, momOwner, u.id].filter(Boolean))];
      for (const a of ids) await x.q(`insert into meeting_attendees (meeting_id, user_id, name, response) select $1, id, name, 'accepted' from users where id = $2`, [mid, a]);
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: mid, action: "created", summary: input.title.trim() }, x);
      if (input.projectId) await link("meeting", mid, "project", input.projectId, "related", u.id, x);
      if (momOwner !== u.id) await notify({ userId: momOwner, kind: "mom_owner", title: `You're writing the MoM for ${input.title.trim()}`, body: `${input.date} · ${input.start}`, entityType: "meeting", entityId: mid, href: `/meetings/${mid}`, actorId: u.id }, x);
      return mid;
    });
    refresh();
    return ok({ id }, "Meeting created");
  } catch (e) { return fail(e); }
}

/* ---------- ownership / prep ---------- */

export async function changeMomOwner(meetingId: string, userId: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only a PM can change the MoM owner");
    const m = await loadMeeting(meetingId);
    const who = await one<{ name: string }>(`select name from users where id = $1 and active`, [userId]);
    if (!who) throw new Error("Pick a person");
    await tx(async (x) => {
      await x.q(`update meetings set mom_owner_id = $2, updated_at = now() where id = $1`, [meetingId, userId]);
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "mom_owner_changed", from: m.mom_owner_id, to: userId, summary: `MoM owner → ${who.name}` }, x);
      await notify({ userId, kind: "mom_owner", title: `You're writing the MoM for ${m.title}`, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, actorId: u.id }, x);
      const ended = new Date(m.ends_at ?? m.starts_at).getTime() < Date.now();
      if (ended && (m.mom_status === "pending" || m.mom_status === "draft")) {
        await resolveInbox(`meeting:${meetingId}:mom`, undefined, x);
        await toInbox({ userId, kind: "mom_pending", title: `${m.title} — add MoM`, body: `${u.name} asked you to write the minutes.`, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, priority: 70, dedupeKey: `meeting:${meetingId}:mom` }, x);
      }
    });
    refresh(meetingId);
    return ok(undefined, `MoM owner changed to ${who.name}`);
  } catch (e) { return fail(e); }
}

export async function updatePrep(meetingId: string, agenda: string | null, prepNotes: string | null): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const m = await loadMeeting(meetingId);
    if (!canWriteMom(u, m) && m.organizer_id !== u.id) throw new Error("Only the organizer, MoM owner or a PM can edit the prep notes");
    await q(`update meetings set agenda = $2, prep_notes = $3, updated_at = now() where id = $1`, [meetingId, agenda?.trim() || null, prepNotes?.trim() || null]);
    await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "prep_updated", summary: m.title });
    refresh(meetingId);
    return ok(undefined, "Prep notes saved");
  } catch (e) { return fail(e); }
}

export async function nudgeMomOwner(meetingId: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const m = await loadMeeting(meetingId);
    if (!m.mom_owner_id) throw new Error("This meeting has no MoM owner");
    if (m.mom_owner_id === u.id) throw new Error("You're the MoM owner");
    await notify({ userId: m.mom_owner_id, kind: "mom_pending", title: `Reminder: add the MoM for ${m.title}`, body: `${u.name} is waiting on the minutes to distribute actions.`, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, actorId: u.id });
    await q(`insert into followups (entity_type, entity_id, person_id, requested_by, message) values ('meeting',$1,$2,$3,$4)`, [meetingId, m.mom_owner_id, u.id, `MoM for ${m.title}`]);
    await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "followed_up", to: m.mom_owner_id, summary: "MoM reminder" });
    refresh(meetingId);
    return ok(undefined, "Reminder sent");
  } catch (e) { return fail(e); }
}

/* ---------- MoM: draft / submit / skip ---------- */

export interface MomInput { kind: "mom" | "quick"; body: string; discussion?: string | null; blockers?: string | null; followUpDate?: string | null }

async function upsertNote(u: User, m: MeetingAuth, input: MomInput, submit: boolean) {
  if (input.followUpDate && input.followUpDate < today()) throw new Error("Follow-up date can't be in the past");
  const existing = await one<{ id: string }>(`select id from meeting_notes where meeting_id = $1 order by updated_at desc limit 1`, [m.id]);
  return tx(async (x) => {
    let noteId = existing?.id;
    if (noteId) {
      await x.q(`update meeting_notes set kind = $2, body = $3, discussion = $4, blockers = $5, author_id = coalesce(author_id, $6), updated_at = now(), submitted_at = case when $7 then now() else submitted_at end where id = $1`,
        [noteId, input.kind, input.body, input.discussion ?? null, input.blockers ?? null, u.id, submit]);
    } else {
      noteId = (await x.one<{ id: string }>(`insert into meeting_notes (meeting_id, author_id, kind, body, discussion, blockers, submitted_at) values ($1,$2,$3,$4,$5,$6, case when $7 then now() end) returning id`,
        [m.id, u.id, input.kind, input.body, input.discussion ?? null, input.blockers ?? null, submit]))!.id;
    }
    const status = submit ? "submitted" : m.mom_status === "submitted" ? "submitted" : "draft";
    await x.q(`update meetings set mom_status = $2, follow_up_date = coalesce($3, follow_up_date), updated_at = now() where id = $1`, [m.id, status, input.followUpDate || null]);
    return noteId!;
  });
}

export async function saveMomDraft(meetingId: string, input: MomInput): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const m = await loadMeeting(meetingId);
    if (!canWriteMom(u, m)) throw new Error("Only the MoM owner or a PM can write this MoM");
    if (m.mom_status === "distributed") throw new Error("Actions from this MoM were already distributed");
    await upsertNote(u, m, input, false);
    await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "mom_draft_saved", summary: m.title });
    refresh(meetingId);
    return ok(undefined, "Draft saved");
  } catch (e) { return fail(e); }
}

async function runExtraction(meetingId: string, noteId: string, body: string, actor: User) {
  const m = await loadMeeting(meetingId);
  const att = await q<{ name: string }>(`select coalesce(u.name, a.name, a.email) as name from meeting_attendees a left join users u on u.id = a.user_id where a.meeting_id = $1`, [meetingId]);
  const pm = canManage(actor) ? actor : (await managers())[0];
  const r = await extractMom(body, {
    meetingDate: dateOf(m.starts_at), meetingTitle: m.title, attendees: att.map((a) => a.name), projectId: m.project_id, programId: m.program_id,
    defaultOwnerId: pm?.id ?? null, defaultOwnerName: pm?.name ?? null,
  });
  await tx(async (x) => {
    await x.q(`update meeting_notes set ai_output = $2, ai_engine = $3, processed_at = now() where id = $1`, [noteId, JSON.stringify({ summary: r.summary, discussion: r.discussion }), r.engine]);
    await x.q(`delete from meeting_suggestions where meeting_id = $1 and created_entity_id is null`, [meetingId]);
    let i = 0;
    for (const s of r.suggestions) await x.q(`insert into meeting_suggestions (meeting_id, note_id, kind, payload, sort) values ($1,$2,$3,$4,$5)`, [meetingId, noteId, s.kind, JSON.stringify(s.payload), i++]);
    if (r.summary) await x.q(`update meetings set summary = $2 where id = $1`, [meetingId, r.summary]);
  });
  return r;
}

export async function submitMom(meetingId: string, input: MomInput): Promise<ActionResult<{ suggestions: number; engine: string }>> {
  try {
    const u = await requireUser();
    const m = await loadMeeting(meetingId);
    if (!canWriteMom(u, m)) throw new Error("Only the MoM owner or a PM can submit this MoM");
    if (m.mom_status === "distributed") throw new Error("Actions from this MoM were already distributed");
    if (!input.body.trim()) throw new Error("Write the MoM before submitting");
    const noteId = await upsertNote(u, m, input, true);
    const r = await runExtraction(meetingId, noteId, input.body, u);
    const pms = await managers(); // read outside the transaction (PGlite serialises sessions)
    await tx(async (x) => {
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "mom_submitted", summary: `${m.title} — ${r.suggestions.length} suggestions (${r.engine})` }, x);
      await resolveInbox(`meeting:${meetingId}:mom`, undefined, x);
      await x.q(`update followups set status = 'responded', responded_at = now() where entity_type = 'meeting' and entity_id = $1 and status = 'open'`, [meetingId]);
      const counts = (k: SuggestionKind) => r.suggestions.filter((s) => s.kind === k).length;
      const body = `${counts("action") + counts("followup")} actions, ${counts("decision")} decisions and ${counts("risk")} risks are waiting for your review.`;
      for (const pm of pms) {
        if (pm.id === u.id) continue;
        await notify({ userId: pm.id, kind: "mom_submitted", title: `${u.name} submitted the MoM for ${m.title}`, body, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, actorId: u.id }, x);
        await toInbox({ userId: pm.id, kind: "mom_review", title: `Review MoM: ${m.title}`, body, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, priority: 75, dedupeKey: `meeting:${meetingId}:review` }, x);
      }
    });
    refresh(meetingId);
    return ok({ suggestions: r.suggestions.length, engine: r.engine }, canManage(u) ? "MoM submitted — review the suggested actions" : "MoM submitted for PM review");
  } catch (e) { return fail(e); }
}

/** Skip / Not relevant — recorded once, never asked again. */
export async function closeMomPrompt(meetingId: string, outcome: "skipped" | "not_relevant", reason?: string | null): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const m = await loadMeeting(meetingId);
    if (!canWriteMom(u, m)) throw new Error("Only the MoM owner or a PM can do this");
    if (m.mom_status !== "pending" && m.mom_status !== "draft") throw new Error("This MoM is already in progress");
    await tx(async (x) => {
      await x.q(`update meetings set mom_status = $2, pm_feedback = coalesce($3, pm_feedback), updated_at = now() where id = $1`, [meetingId, outcome, reason?.trim() || null]);
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: `mom_${outcome}`, to: reason ?? null, summary: m.title }, x);
      await resolveInbox(`meeting:${meetingId}:mom`, undefined, x);
      await x.q(`update followups set status = 'closed' where entity_type = 'meeting' and entity_id = $1 and status = 'open'`, [meetingId]);
    });
    refresh(meetingId);
    return ok(undefined, outcome === "skipped" ? "Skipped — you won't be asked again" : "Marked not relevant");
  } catch (e) { return fail(e); }
}

/* ---------- PM review ---------- */

async function requirePM() {
  const u = await requireUser();
  if (!canManage(u)) throw new Error("Only a PM can review and distribute");
  return u;
}

export async function saveSuggestion(id: string, patch: { payload?: SuggestionPayload; feedback?: string | null; status?: "pending" | "accepted" | "ignored" }): Promise<ActionResult> {
  try {
    const u = await requirePM();
    const s = await one<{ meeting_id: string; created_entity_id: string | null }>(`select meeting_id, created_entity_id from meeting_suggestions where id = $1`, [id]);
    if (!s) throw new Error("Suggestion not found");
    if (s.created_entity_id) throw new Error("Already distributed");
    if (patch.payload?.due_date && patch.payload.due_date < today()) throw new Error("Due date can't be in the past");
    await q(
      `update meeting_suggestions set payload = coalesce($2::jsonb, payload), feedback = case when $3::boolean then $4 else feedback end,
         status = coalesce($5, status), decided_by = case when $5::text is not null then $6::uuid else decided_by end, decided_at = case when $5::text is not null then now() else decided_at end
       where id = $1`,
      [id, patch.payload ? JSON.stringify(patch.payload) : null, patch.feedback !== undefined, patch.feedback?.trim() || null, patch.status ?? null, u.id]);
    revalidatePath(`/meetings/${s.meeting_id}`);
    return ok();
  } catch (e) { return fail(e); }
}

export async function addSuggestion(meetingId: string, kind: SuggestionKind): Promise<ActionResult<{ id: string }>> {
  try {
    await requirePM();
    const m = await loadMeeting(meetingId);
    const payload: SuggestionPayload = kind === "risk" ? { title: "", probability: 3, impact: 3, project_id: m.project_id } : kind === "decision" ? { title: "", project_id: m.project_id } : { title: "", priority: "medium", project_id: m.project_id };
    const note = await getMomNote(meetingId);
    const r = await one<{ id: string }>(`insert into meeting_suggestions (meeting_id, note_id, kind, payload, sort) values ($1,$2,$3,$4, 1000) returning id`, [meetingId, note?.id ?? null, kind, JSON.stringify(payload)]);
    revalidatePath(`/meetings/${meetingId}`);
    return ok({ id: r!.id });
  } catch (e) { return fail(e); }
}

export async function reExtract(meetingId: string): Promise<ActionResult> {
  try {
    const u = await requirePM();
    const note = await getMomNote(meetingId);
    if (!note?.body.trim()) throw new Error("There's no MoM to read yet");
    const r = await runExtraction(meetingId, note.id, note.body, u);
    refresh(meetingId);
    return ok(undefined, `Re-read the MoM — ${r.suggestions.length} suggestions`);
  } catch (e) { return fail(e); }
}

/**
 * Turn accepted suggestions into real objects: actions → tasks (person or team), follow-ups → waiting tasks, decisions → decisions,
 * risks → risks. Undecided items are ignored. The meeting moves to `distributed` and every owner is told, with the PM's feedback.
 */
export async function distributeMom(meetingId: string, input: { pmFeedback: string | null; items?: { id: string; payload: SuggestionPayload; feedback: string | null; status: "accepted" | "ignored" | "pending" }[] }): Promise<ActionResult<{ tasks: number; decisions: number; risks: number }>> {
  try {
    const u = await requirePM();
    const m = await loadMeeting(meetingId);
    if (m.mom_status === "distributed") throw new Error("Already distributed");
    if (m.mom_status !== "submitted") throw new Error("The MoM hasn't been submitted yet");
    const td = today();
    const meetingDate = dateOf(m.starts_at);

    const res = await tx(async (x) => {
      // persist the latest edits from the review panel
      for (const it of input.items ?? []) {
        await x.q(`update meeting_suggestions set payload = $2, feedback = $3, status = $4, decided_by = $5, decided_at = now() where id = $1 and meeting_id = $6 and created_entity_id is null`,
          [it.id, JSON.stringify(it.payload), it.feedback?.trim() || null, it.status, u.id, meetingId]);
      }
      await x.q(`update meeting_suggestions set status = 'ignored', decided_by = $2, decided_at = now() where meeting_id = $1 and status = 'pending'`, [meetingId, u.id]);
      const accepted = await x.q<{ id: string; kind: SuggestionKind; payload: SuggestionPayload; feedback: string | null }>(
        `select id, kind, payload, feedback from meeting_suggestions where meeting_id = $1 and status = 'accepted' and created_entity_id is null order by sort, created_at`, [meetingId]);

      const perOwner = new Map<string, { items: string[]; notes: string[] }>();
      const bump = (uid: string | null | undefined, title: string, fb: string | null) => {
        if (!uid) return;
        const e = perOwner.get(uid) ?? { items: [], notes: [] };
        e.items.push(title); if (fb) e.notes.push(`${title}: ${fb}`);
        perOwner.set(uid, e);
      };
      const fixDue = (d: string | null | undefined) => (d ? (d < td ? td : d) : null);
      const descr = (s: { payload: SuggestionPayload; feedback: string | null }) =>
        [s.feedback ? `PM note: ${s.feedback}` : null, s.payload.dependency ? `Depends on: ${s.payload.dependency}` : null, `From the MoM of ${m.title} (${meetingDate}).`].filter(Boolean).join("\n");

      let tasks = 0, decisions = 0, risks = 0;
      const created = new Map<string, string>(); // suggestion id → task id
      const pendingTasks = accepted.filter((s) => s.kind === "action" || s.kind === "followup");
      // create in dependency order (a task whose dependency is another accepted suggestion waits for it)
      for (let guard = 0; pendingTasks.length && guard < 50; guard++) {
        const idx = pendingTasks.findIndex((s) => !s.payload.depends_on || created.has(s.payload.depends_on) || !pendingTasks.some((o) => o.id === s.payload.depends_on));
        const s = pendingTasks.splice(idx < 0 ? 0 : idx, 1)[0];
        const p = s.payload;
        if (!p.title?.trim()) throw new Error("Every accepted item needs a title");
        const isFollow = s.kind === "followup";
        const dep = p.depends_on ? created.get(p.depends_on) : undefined;
        const t = await createTask(u.id, {
          title: p.title, description: descr(s), ownerId: p.owner_id ?? (isFollow ? u.id : null), ownerTeamId: p.owner_id ? null : p.team_id ?? null, requesterId: u.id,
          priority: p.priority ?? "medium", status: isFollow ? "waiting" : "not_started", dueDate: fixDue(p.due_date), projectId: p.project_id ?? m.project_id ?? null,
          programId: p.project_id || m.project_id ? null : m.program_id, meetingId, source: isFollow ? "followup" : "meeting", waitingOnId: isFollow ? p.waiting_on_id ?? null : null,
          dependsOn: dep ? [dep] : [],
        }, { tx: x });
        created.set(s.id, t.id);
        await x.q(`update meeting_suggestions set created_entity_type = 'task', created_entity_id = $2 where id = $1`, [s.id, t.id]);
        let owner = p.owner_id ?? null;
        if (!owner && p.team_id) owner = (await x.one<{ lead_id: string | null }>(`select lead_id from teams where id = $1`, [p.team_id]))?.lead_id ?? null;
        bump(owner, `CO-${t.number} ${p.title}`, s.feedback);
        if (isFollow && p.waiting_on_id && p.waiting_on_id !== owner)
          await notify({ userId: p.waiting_on_id, kind: "followup", title: `${u.name} is waiting on you: ${p.title}`, body: s.feedback ?? `From ${m.title}`, entityType: "task", entityId: t.id, href: `/tasks/${t.id}`, actorId: u.id }, x);
        tasks++;
      }
      for (const s of accepted.filter((a) => a.kind === "decision")) {
        const p = s.payload;
        if (!p.title?.trim()) throw new Error("Every accepted decision needs a title");
        const maker = p.decision_maker_id ?? (p.decision_maker ? (await x.one<{ id: string }>(`select id from users where lower(name) = lower($1) or lower(split_part(name,' ',1)) = lower($1) limit 1`, [p.decision_maker]))?.id : null) ?? u.id;
        const d = await x.one<{ id: string }>(
          `insert into decisions (title, context, reason, status, decided_on, meeting_id, decision_maker_id, project_id, program_id, created_by) values ($1,$2,$3,'made',$4,$5,$6,$7,$8,$9) returning id`,
          [p.title.trim(), p.context ?? null, s.feedback ?? null, meetingDate, meetingId, maker, p.project_id ?? m.project_id, m.program_id, u.id]);
        await x.q(`update meeting_suggestions set created_entity_type = 'decision', created_entity_id = $2 where id = $1`, [s.id, d!.id]);
        await link("meeting", meetingId, "decision", d!.id, "decision", u.id, x);
        await logActivity({ actorId: u.id, entityType: "decision", entityId: d!.id, action: "created", summary: p.title }, x);
        decisions++;
      }
      for (const s of accepted.filter((a) => a.kind === "risk")) {
        const p = s.payload;
        if (!p.title?.trim()) throw new Error("Every accepted risk needs a title");
        const r = await x.one<{ id: string }>(
          `insert into risks (title, description, project_id, program_id, meeting_id, owner_id, probability, impact, mitigation, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [p.title.trim(), s.feedback ? `PM note: ${s.feedback}` : null, p.project_id ?? m.project_id, m.program_id, meetingId, p.owner_id ?? null,
            Math.max(1, Math.min(5, p.probability ?? 3)), Math.max(1, Math.min(5, p.impact ?? 3)), p.mitigation ?? null, u.id]);
        await x.q(`update meeting_suggestions set created_entity_type = 'risk', created_entity_id = $2 where id = $1`, [s.id, r!.id]);
        await link("meeting", meetingId, "risk", r!.id, "risk", u.id, x);
        await logActivity({ actorId: u.id, entityType: "risk", entityId: r!.id, action: "created", summary: p.title }, x);
        if (p.owner_id) await notify({ userId: p.owner_id, kind: "risk_assigned", title: `Risk assigned: ${p.title}`, body: s.feedback, entityType: "risk", entityId: r!.id, href: `/risks/${r!.id}`, actorId: u.id }, x);
        bump(p.owner_id, `Risk: ${p.title}`, s.feedback);
        risks++;
      }

      await x.q(`update meetings set mom_status = 'distributed', pm_feedback = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() where id = $1`, [meetingId, input.pmFeedback?.trim() || null, u.id]);
      await logActivity({ actorId: u.id, entityType: "meeting", entityId: meetingId, action: "mom_distributed", summary: `${m.title}: ${tasks} tasks, ${decisions} decisions, ${risks} risks` }, x);
      await resolveInbox(`meeting:${meetingId}:review`, undefined, x);
      await resolveInbox(`meeting:${meetingId}:mom`, undefined, x);

      const fb = input.pmFeedback?.trim();
      for (const [uid, e] of perOwner) {
        const body = [fb ? `${u.name}: “${fb}”` : null, ...e.notes.map((n) => `• ${n}`), e.notes.length ? null : e.items.slice(0, 4).map((i) => `• ${i}`).join("\n")].filter(Boolean).join("\n");
        await notify({ userId: uid, kind: "mom_distributed", title: `${e.items.length} item${e.items.length === 1 ? "" : "s"} for you from ${m.title}`, body, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, actorId: u.id }, x);
      }
      if (m.mom_owner_id && !perOwner.has(m.mom_owner_id))
        await notify({ userId: m.mom_owner_id, kind: "mom_distributed", title: `Your MoM for ${m.title} was reviewed and distributed`, body: fb ? `${u.name}: “${fb}”` : `${tasks} tasks, ${decisions} decisions, ${risks} risks created.`, entityType: "meeting", entityId: meetingId, href: `/meetings/${meetingId}`, actorId: u.id }, x);
      return { tasks, decisions, risks };
    });
    refresh(meetingId);
    return ok(res, `Distributed — ${res.tasks} tasks, ${res.decisions} decisions, ${res.risks} risks`);
  } catch (e) { return fail(e); }
}

/* ---------- end-of-day ---------- */

export async function moveTasksToTomorrow(ids: string[]): Promise<ActionResult<{ moved: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    const tomorrow = addDays(today(), 1);
    let moved = 0;
    for (const id of ids.slice(0, 50)) {
      await updateTask(u.id, id, { dueDate: tomorrow, note: "Moved to tomorrow in end-of-day review" });
      moved++;
    }
    refresh();
    return ok({ moved }, `${moved} task${moved === 1 ? "" : "s"} moved to tomorrow`);
  } catch (e) { return fail(e); }
}
