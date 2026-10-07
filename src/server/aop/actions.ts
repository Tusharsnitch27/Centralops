"use server";
import { revalidatePath } from "next/cache";
import { q, one, tx, type Tx } from "../db";
import { canEdit, canManage, requireUser, type User } from "../auth";
import { logActivity } from "../core/activity";
import { notify, resolveInbox, toInbox } from "../core/notify";
import { fail, ok, type ActionResult } from "../core/result";
import { createTask } from "../tasks/core";
import { inr } from "@/lib/format";
import { today } from "@/lib/dates";
import { cycleMonths, LABEL_PRESETS, monLabel, type Labels, type Measure } from "./calc";
import { allItemsOf, canEditField, loadModel, sectionOwner, type Model } from "./model";
import { dueFor, type InputKind } from "./inputs";

const done = () => revalidatePath("/aop", "layout");
const uuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const fmtVal = (v: number | null) => (v == null ? "—" : inr(v));

async function modelForItem(itemId: string) {
  const r = await one<{ cycle_id: string }>(`select cycle_id from aop_items where id = $1`, [itemId]);
  if (!r) throw new Error("Line not found");
  const m = await loadModel(r.cycle_id);
  const it = m?.itemById.get(itemId);
  if (!m || !it) throw new Error("Line not found");
  return { m, it };
}

/** Upsert one measure for one month, with history + audit. */
async function writeValue(x: Tx, u: User, m: Model, itemId: string, itemName: string, period: string, field: Measure, value: number | null) {
  const cur = await x.one<{ v: number | null }>(`select ${field} as v from aop_period_values where item_id = $1 and period = $2`, [itemId, period]);
  const old = cur?.v ?? null;
  if (old === value || (old != null && value != null && Math.abs(old - value) < 0.005)) return false;
  await x.q(
    `insert into aop_period_values (item_id, period, ${field}, updated_by, updated_at) values ($1,$2,$3,$4, now())
     on conflict (item_id, period) do update set ${field} = excluded.${field}, updated_by = excluded.updated_by, updated_at = now()`,
    [itemId, period, value, u.id]);
  await x.q(`insert into aop_updates (item_id, period, field, old_value, new_value, author_id) values ($1,$2,$3,$4,$5,$6)`,
    [itemId, period, field, old == null ? null : String(old), value == null ? null : String(value), u.id]);
  await logActivity({
    actorId: u.id, entityType: "aop_item", entityId: itemId, action: "value_changed", field: `${field}:${period}`, from: old, to: value,
    summary: `${u.name} changed ${monLabel(period)} ${m.cycle.labels[field].toLowerCase()} ${fmtVal(old)} → ${fmtVal(value)} · ${itemName}`,
  }, x);
  return true;
}

export async function updateValue(i: { itemId: string; period: string; field: Measure; value: number | null }): Promise<ActionResult<{ value: number | null }>> {
  try {
    const u = await requireUser();
    if (!["plan", "forecast", "actual"].includes(i.field)) throw new Error("Unknown field");
    if (i.value != null && !Number.isFinite(i.value)) throw new Error("Enter a number");
    const { m, it } = await modelForItem(i.itemId);
    if (!m.months.includes(i.period)) throw new Error("That month isn't in this plan year");
    if (!canEditField(m, u, it, i.field)) throw new Error(i.field === "plan" ? `Only the PM can change the ${m.cycle.labels.plan.toLowerCase()}` : "You can only update lines you own");
    if (i.field === "actual" && i.period > m.currentMonth) throw new Error(`${m.cycle.labels.actual} can't be entered for a future month`);
    await tx((x) => writeValue(x, u, m, it.id, it.name, i.period, i.field, i.value));
    done();
    return ok({ value: i.value });
  } catch (e) { return fail(e); }
}

export async function addComment(i: { itemId: string; period?: string | null; kind: "commentary" | "variance_reason" | "corrective_action"; body: string; confidence?: "high" | "medium" | "low" | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    const { m, it } = await modelForItem(i.itemId);
    if (!canEditField(m, u, it, "comment")) throw new Error("You can only comment on lines you own");
    if (!i.body?.trim()) throw new Error("Write something first");
    await tx(async (x) => {
      await x.q(`insert into aop_comments (item_id, period, kind, body, confidence, author_id) values ($1,$2,$3,$4,$5,$6)`,
        [it.id, i.period || null, i.kind, i.body.trim(), i.confidence ?? null, u.id]);
      if (i.confidence) await x.q(`update aop_items set confidence = $2 where id = $1`, [it.id, i.confidence]);
      await logActivity({ actorId: u.id, entityType: "aop_item", entityId: it.id, action: i.kind, to: i.body.trim().slice(0, 200), summary: it.name }, x);
      await x.q(`update followups set status = 'responded', responded_at = now(), response = $2 where entity_type = 'aop_item' and entity_id = $1 and status = 'open'`, [it.id, i.body.trim()]);
    });
    done();
    return ok(undefined, "Saved");
  } catch (e) { return fail(e); }
}

export async function createCorrectiveTask(i: { itemId?: string | null; sectionId?: string | null; title: string; ownerId?: string | null; dueDate?: string | null; priority?: "urgent" | "high" | "medium" | "low"; description?: string | null }): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    let m: Model, itemId: string | null = null, name: string, owner: string | null = null;
    if (i.itemId) {
      const r = await modelForItem(i.itemId);
      m = r.m; itemId = r.it.id; name = r.it.name; owner = r.it.owner_id;
    } else {
      const s = i.sectionId ? await one<{ cycle_id: string }>(`select cycle_id from aop_sections where id = $1`, [i.sectionId]) : null;
      const mm = s ? await loadModel(s.cycle_id) : null;
      const sec = mm?.sectionById.get(i.sectionId!);
      if (!mm || !sec) throw new Error("Pick a line or function");
      m = mm; name = sec.fn && sec.fn.id !== sec.id ? `${sec.fn.name} › ${sec.name}` : sec.name; owner = sectionOwner(sec.fn ?? sec)?.id ?? null;
    }
    const prog = await one<{ id: string }>(`select id from programs where code = 'COST'`);
    const t = await createTask(u.id, {
      title: i.title, description: i.description ?? `Corrective action for AOP ${itemId ? "line" : "function"} “${name}” (${m.cycle.name}).`,
      ownerId: i.ownerId ?? owner, dueDate: i.dueDate || null, priority: i.priority ?? "high", source: "aop", aopItemId: itemId,
      programId: m.cycle.kind === "cost" ? prog?.id ?? null : null, tags: ["aop"],
    });
    if (!itemId && i.sectionId) await q(`insert into entity_links (from_type, from_id, to_type, to_id, relation, created_by) values ('aop_section',$1,'task',$2,'action',$3) on conflict do nothing`, [i.sectionId, t.id, u.id]);
    done();
    revalidatePath("/tasks");
    return ok(t, `Task CO-${t.number} created`);
  } catch (e) { return fail(e); }
}

/* ---------- input collection ---------- */

async function remind(x: Tx, u: User, m: Model, sectionId: string, period: string, kind: InputKind, personId?: string | null) {
  const f = m.sectionById.get(sectionId);
  if (!f) throw new Error("Function not found");
  const owner = personId ? { id: personId } : sectionOwner(f);
  if (!owner) throw new Error(`${f.name} has no owner — set one in Setup`);
  const L = m.cycle.labels;
  const what = kind === "actuals" ? `${monLabel(period)} ${L.actual.toLowerCase()}` : `${monLabel(period)} ${L.forecast.toLowerCase()}s`;
  const due = dueFor(m, period, kind);
  const missing = allItemsOf(f).filter((i) => (kind === "actuals" ? i.vals[period]?.actual == null && (i.vals[period]?.plan || i.vals[period]?.forecast) : i.vals[period]?.forecast == null)).length;
  const msg = `Please update ${what} for ${f.name}${missing ? ` — ${missing} line${missing === 1 ? "" : "s"} pending` : ""}. Due ${due}.`;
  const href = `/aop/inputs/submit?cycle=${m.cycle.id}&period=${period}&kind=${kind}&owner=${owner.id}`;
  await x.q(`insert into followups (entity_type, entity_id, person_id, requested_by, channel, message, due_at) values ('aop_section',$1,$2,$3,'in_app',$4,$5)`,
    [f.id, owner.id, u.id, msg, `${due}T23:59:00+05:30`]);
  await notify({ userId: owner.id, kind: "aop_input", title: `Update ${what}: ${f.name}`, body: msg, entityType: "aop_section", entityId: f.id, href, actorId: u.id }, x);
  await toInbox({ userId: owner.id, kind: "aop_submission", title: `Submit ${what} · ${f.name}`, body: msg, entityType: "aop_section", entityId: f.id, href,
    priority: due < today() ? 85 : 70, dedupeKey: `aop_submission:${f.id}:${period}:${kind}` }, x);
  await logActivity({ actorId: u.id, entityType: "aop_section", entityId: f.id, action: "followed_up", to: owner.id, summary: msg }, x);
}

export async function sendReminder(i: { cycleId: string; sectionId: string; period: string; kind: InputKind; personId?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can send reminders");
    const m = await loadModel(i.cycleId);
    if (!m) throw new Error("Cycle not found");
    await tx((x) => remind(x, u, m, i.sectionId, i.period, i.kind, i.personId));
    done();
    return ok(undefined, "Reminder sent");
  } catch (e) { return fail(e); }
}

export async function remindAll(i: { cycleId: string; period: string; kind: InputKind; sectionIds: string[] }): Promise<ActionResult<{ count: number }>> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can send reminders");
    const m = await loadModel(i.cycleId);
    if (!m) throw new Error("Cycle not found");
    let count = 0;
    await tx(async (x) => { for (const s of i.sectionIds) { await remind(x, u, m, s, i.period, i.kind); count++; } });
    done();
    return ok({ count }, `${count} reminder${count === 1 ? "" : "s"} sent`);
  } catch (e) { return fail(e); }
}

export async function requestItemUpdate(i: { itemId: string; message?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can request updates");
    const { m, it } = await modelForItem(i.itemId);
    if (!it.owner_id) throw new Error("This line has no owner");
    const msg = i.message?.trim() || `Please update ${it.name}: latest ${m.cycle.labels.actual.toLowerCase()}, ${m.cycle.labels.forecast.toLowerCase()} and the reason for variance.`;
    const href = `/aop/plan?cycle=${m.cycle.id}&item=${it.id}`;
    await tx(async (x) => {
      await x.q(`insert into followups (entity_type, entity_id, person_id, requested_by, channel, message) values ('aop_item',$1,$2,$3,'in_app',$4)`, [it.id, it.owner_id, u.id, msg]);
      await notify({ userId: it.owner_id, kind: "aop_input", title: `Update requested: ${it.name}`, body: msg, entityType: "aop_item", entityId: it.id, href, actorId: u.id }, x);
      await toInbox({ userId: it.owner_id!, kind: "aop_submission", title: `Update ${it.name}`, body: msg, entityType: "aop_item", entityId: it.id, href, priority: 65, dedupeKey: `aop_item_update:${it.id}:${today().slice(0, 7)}` }, x);
      await logActivity({ actorId: u.id, entityType: "aop_item", entityId: it.id, action: "followed_up", to: it.owner_id, summary: msg }, x);
    });
    done();
    return ok(undefined, `Asked ${it.owner_name ?? "the owner"} for an update`);
  } catch (e) { return fail(e); }
}

export interface InputLine {
  itemId: string; actual?: number | null; forecast?: number | null;
  commentary?: string | null; reason?: string | null; corrective?: string | null; confidence?: "high" | "medium" | "low" | null;
}
export async function submitInputs(i: { cycleId: string; period: string; kind: InputKind; ownerId: string; lines: InputLine[]; final: boolean }): Promise<ActionResult<{ changed: number }>> {
  try {
    const u = await requireUser();
    const m = await loadModel(i.cycleId);
    if (!m) throw new Error("Cycle not found");
    if (!canManage(u) && i.ownerId !== u.id) throw new Error("You can only submit your own inputs");
    let changed = 0;
    const touched = new Set<string>();
    await tx(async (x) => {
      for (const l of i.lines) {
        const it = m.itemById.get(l.itemId);
        if (!it) continue;
        if (!canEditField(m, u, it, "actual")) throw new Error(`You can't update ${it.name}`);
        touched.add(it.function_id);
        if (l.actual !== undefined && i.period <= m.currentMonth) changed += Number(await writeValue(x, u, m, it.id, it.name, i.period, "actual", l.actual));
        if (l.forecast !== undefined) changed += Number(await writeValue(x, u, m, it.id, it.name, i.period, "forecast", l.forecast));
        const notes: [string, string | null | undefined][] = [["commentary", l.commentary], ["variance_reason", l.reason], ["corrective_action", l.corrective]];
        for (const [kind, body] of notes) if (body?.trim()) {
          await x.q(`insert into aop_comments (item_id, period, kind, body, confidence, author_id) values ($1,$2,$3,$4,$5,$6)`, [it.id, i.period, kind, body.trim(), l.confidence ?? null, u.id]);
          changed++;
        }
        if (l.confidence) await x.q(`update aop_items set confidence = $2 where id = $1`, [it.id, l.confidence]);
      }
      if (i.final) for (const fid of touched) {
        await x.q(
          `insert into aop_submissions (cycle_id, section_id, period, kind, owner_id, due_date, status, submitted_at, submitted_by)
           values ($1,$2,$3,$4,$5,$6,'submitted', now(), $7)
           on conflict (section_id, period, kind) do update set status = 'submitted', submitted_at = now(), submitted_by = excluded.submitted_by`,
          [m.cycle.id, fid, i.period, i.kind, i.ownerId, dueFor(m, i.period, i.kind), u.id]);
        await x.q(`update followups set status = 'responded', responded_at = now(), response = 'Inputs submitted' where entity_type = 'aop_section' and entity_id = $1 and status = 'open'`, [fid]);
        await resolveInbox(`aop_submission:${fid}:${i.period}:${i.kind}`, undefined, x);
        await logActivity({ actorId: u.id, entityType: "aop_section", entityId: fid, action: "inputs_submitted", to: `${i.kind}:${i.period}`, summary: `${m.sectionById.get(fid)?.name} · ${monLabel(i.period)} ${i.kind}` }, x);
        if (m.cycle.owner_id) await notify({ userId: m.cycle.owner_id, kind: "aop_input", title: `${m.sectionById.get(fid)?.name}: ${monLabel(i.period)} ${i.kind} submitted`, href: `/aop/inputs?cycle=${m.cycle.id}`, entityType: "aop_section", entityId: fid, actorId: u.id }, x);
      }
    });
    done();
    return ok({ changed }, i.final ? "Inputs submitted" : "Draft saved");
  } catch (e) { return fail(e); }
}

/* ---------- insight rules ---------- */

export async function saveRule(i: { id?: string | null; name: string; description?: string | null; metric: string; threshold?: number | null; periods?: number | null; min_amount?: number | null; severity: "info" | "warning" | "critical"; enabled: boolean }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change rules");
    if (!i.name?.trim()) throw new Error("Name the rule");
    const rule: Record<string, unknown> = { metric: i.metric };
    if (i.threshold != null) rule.threshold = i.threshold;
    if (i.periods != null) rule.periods = i.periods;
    if (i.min_amount != null) rule.min_amount = i.min_amount;
    if (i.id) {
      await q(`update insight_rules set name = $2, description = $3, rule = $4, severity = $5, enabled = $6 where id = $1 and module = 'aop'`,
        [i.id, i.name.trim(), i.description ?? null, JSON.stringify(rule), i.severity, i.enabled]);
    } else {
      await q(`insert into insight_rules (module, key, name, description, rule, severity, enabled) values ('aop',$1,$2,$3,$4,$5,$6)`,
        [`aop.custom.${Date.now().toString(36)}`, i.name.trim(), i.description ?? null, JSON.stringify(rule), i.severity, i.enabled]);
    }
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: null, action: "rule_saved", to: rule, summary: i.name });
    done();
    return ok(undefined, "Rule saved");
  } catch (e) { return fail(e); }
}
export async function toggleRule(id: string, enabled: boolean): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change rules");
    await q(`update insight_rules set enabled = $2 where id = $1 and module = 'aop'`, [id, enabled]);
    done();
    return ok(undefined, enabled ? "Rule enabled" : "Rule disabled");
  } catch (e) { return fail(e); }
}
export async function deleteRule(id: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change rules");
    await q(`delete from insight_rules where id = $1 and module = 'aop' and not builtin`, [id]);
    done();
    return ok(undefined, "Rule removed");
  } catch (e) { return fail(e); }
}

/* ---------- cost savings ---------- */

const num = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export async function saveCreditNote(i: { id?: string | null; cycleId: string; function_name?: string | null; partner: string; cn_type?: string | null; month_label?: string | null; amount?: number | null; received?: number | null; owner_id?: string | null; status?: string | null; remarks?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    if (!i.partner?.trim()) throw new Error("Partner is required");
    const amount = num(i.amount), received = num(i.received);
    const status = i.status && i.status !== "auto" ? i.status : received && amount && received >= amount ? "received" : received ? "partial" : "open";
    const vals = [i.function_name || null, i.partner.trim(), i.cn_type || null, i.month_label || null, amount, received, i.owner_id || null, status, i.remarks || null];
    if (i.id) await q(`update credit_notes set function_name=$2, partner=$3, cn_type=$4, month_label=$5, amount=$6, received=$7, owner_id=$8, status=$9, remarks=$10 where id=$1`, [i.id, ...vals]);
    else await q(`insert into credit_notes (cycle_id, function_name, partner, cn_type, month_label, amount, received, owner_id, status, remarks) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [i.cycleId, ...vals]);
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: i.cycleId, action: i.id ? "credit_note_updated" : "credit_note_added", summary: `${i.partner} · ${inr(amount)}` });
    done();
    return ok(undefined, "Credit note saved");
  } catch (e) { return fail(e); }
}
export async function deleteCreditNote(id: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can remove entries");
    await q(`delete from credit_notes where id = $1`, [id]);
    done();
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}
export async function saveIncident(i: { id?: string | null; cycleId: string; function_name?: string | null; month_label?: string | null; channel?: string | null; expense_type?: string | null; reason?: string | null; amount?: number | null; owner_id?: string | null; remarks?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canEdit(u)) throw new Error("Read-only access");
    const vals = [i.function_name || null, i.month_label || null, i.channel || null, i.expense_type || null, i.reason || null, num(i.amount), i.owner_id || null, i.remarks || null];
    if (i.id) await q(`update incident_expenses set function_name=$2, month_label=$3, channel=$4, expense_type=$5, reason=$6, amount=$7, owner_id=$8, remarks=$9 where id=$1`, [i.id, ...vals]);
    else await q(`insert into incident_expenses (cycle_id, function_name, month_label, channel, expense_type, reason, amount, owner_id, remarks) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [i.cycleId, ...vals]);
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: i.cycleId, action: i.id ? "incident_updated" : "incident_added", summary: `${i.expense_type ?? "Incident"} · ${inr(num(i.amount))}` });
    done();
    return ok(undefined, "Incident saved");
  } catch (e) { return fail(e); }
}
export async function deleteIncident(id: string): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can remove entries");
    await q(`delete from incident_expenses where id = $1`, [id]);
    done();
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}

/* ---------- setup ---------- */

export async function updateCycle(i: { id: string; name: string; kind: "cost" | "revenue" | "mixed"; status: "draft" | "active" | "closed"; labels: Labels; actuals_cutoff_day: number; projection_cutoff_day: number; guidelines: string[]; fy_start?: string; months?: number }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change the cycle");
    if (!i.name?.trim()) throw new Error("Name is required");
    const day = (n: number) => Math.min(28, Math.max(1, Math.round(Number(n) || 1)));
    await q(`update aop_cycles set name=$2, kind=$3, status=$4, labels=$5, actuals_cutoff_day=$6, projection_cutoff_day=$7, guidelines=$8,
               fy_start = coalesce($9::date, fy_start), months = coalesce($10::int, months) where id=$1`,
      [i.id, i.name.trim(), i.kind, i.status, JSON.stringify({ plan: i.labels.plan || "Plan", forecast: i.labels.forecast || "Forecast", actual: i.labels.actual || "Actual" }),
        day(i.actuals_cutoff_day), day(i.projection_cutoff_day), JSON.stringify(i.guidelines.map((g) => g.trim()).filter(Boolean)),
        i.fy_start ? `${i.fy_start.slice(0, 7)}-01` : null, i.months ? Math.min(24, Math.max(1, i.months)) : null]);
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: i.id, action: "updated", summary: i.name });
    done();
    return ok(undefined, "Cycle saved");
  } catch (e) { return fail(e); }
}

export async function setSectionOwner(i: { sectionId: string; ownerId: string | null; ownerLabel?: string | null; cascade?: boolean }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can assign owners");
    await tx(async (x) => {
      await x.q(`update aop_sections set owner_id = $2, owner_label = coalesce($3, owner_label) where id = $1`, [i.sectionId, i.ownerId, i.ownerLabel ?? null]);
      if (i.cascade) await x.q(
        `with recursive t as (select id from aop_sections where parent_id = $1 union all select s.id from aop_sections s join t on s.parent_id = t.id)
         update aop_sections set owner_id = $2 where id in (select id from t)`, [i.sectionId, i.ownerId]);
      await logActivity({ actorId: u.id, entityType: "aop_section", entityId: i.sectionId, action: "owner_changed", to: i.ownerId }, x);
    });
    done();
    return ok(undefined, "Owner updated");
  } catch (e) { return fail(e); }
}
export async function addContributor(i: { sectionId?: string | null; itemId?: string | null; userId: string; role?: "owner" | "contributor" | "approver" }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can assign owners");
    if (!i.sectionId && !i.itemId) throw new Error("Pick a function or line");
    const exists = await one(`select 1 from aop_owners where user_id = $1 and section_id is not distinct from $2 and item_id is not distinct from $3`, [i.userId, i.sectionId ?? null, i.itemId ?? null]);
    if (!exists) await q(`insert into aop_owners (section_id, item_id, user_id, role) values ($1,$2,$3,$4)`, [i.sectionId ?? null, i.itemId ?? null, i.userId, i.role ?? "contributor"]);
    done();
    return ok(undefined, "Added");
  } catch (e) { return fail(e); }
}
export async function removeContributor(i: { sectionId: string; userId: string }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can assign owners");
    await q(`delete from aop_owners where section_id = $1 and user_id = $2`, [i.sectionId, i.userId]);
    done();
    return ok(undefined, "Removed");
  } catch (e) { return fail(e); }
}
export async function setItemOwner(i: { itemId: string; ownerId: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can assign owners");
    const cur = await one<{ owner_id: string | null }>(`select owner_id from aop_items where id = $1`, [i.itemId]);
    await q(`update aop_items set owner_id = $2 where id = $1`, [i.itemId, i.ownerId]);
    await q(`insert into aop_updates (item_id, field, old_value, new_value, author_id) values ($1,'owner',$2,$3,$4)`, [i.itemId, cur?.owner_id ?? null, i.ownerId, u.id]);
    done();
    return ok(undefined, "Owner updated");
  } catch (e) { return fail(e); }
}
export async function addSection(i: { cycleId: string; parentId?: string | null; name: string; ownerId?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change structure");
    if (!i.name?.trim()) throw new Error("Name is required");
    const sort = (await one<{ n: number }>(`select coalesce(max(sort),0)+1 as n from aop_sections where cycle_id = $1 and parent_id is not distinct from $2`, [i.cycleId, i.parentId ?? null]))?.n ?? 0;
    await q(`insert into aop_sections (cycle_id, parent_id, name, kind, owner_id, sort) values ($1,$2,$3,$4,$5,$6)`,
      [i.cycleId, i.parentId ?? null, i.name.trim(), i.parentId ? "group" : "function", i.ownerId ?? null, sort]);
    done();
    return ok(undefined, "Added");
  } catch (e) { return fail(e); }
}
export async function addItem(i: { sectionId: string; name: string; direction?: "lower_better" | "higher_better"; unit?: "inr" | "num" | "pct"; ownerId?: string | null }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can change structure");
    if (!i.name?.trim()) throw new Error("Name is required");
    const s = await one<{ cycle_id: string; kind: string }>(`select s.cycle_id, c.kind from aop_sections s join aop_cycles c on c.id = s.cycle_id where s.id = $1`, [i.sectionId]);
    if (!s) throw new Error("Section not found");
    await q(`insert into aop_items (cycle_id, section_id, name, unit, direction, owner_id, metric, sort)
             values ($1,$2,$3,$4,$5,$6,$7,(select coalesce(max(sort),0)+1 from aop_items where section_id = $2))`,
      [s.cycle_id, i.sectionId, i.name.trim(), i.unit ?? "inr", i.direction ?? (s.kind === "revenue" ? "higher_better" : "lower_better"), i.ownerId ?? null, s.kind === "revenue" ? "Revenue" : "Cost"]);
    done();
    return ok(undefined, "Line added");
  } catch (e) { return fail(e); }
}

export async function createCycle(i: { name: string; kind: "cost" | "revenue" | "mixed"; fy_start: string; months?: number; labels?: Labels; copyFrom?: string | null; copyPlan?: boolean; activate?: boolean }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can create cycles");
    if (!i.name?.trim()) throw new Error("Name is required");
    if (!/^\d{4}-\d{2}/.test(i.fy_start ?? "")) throw new Error("Pick the first month of the plan year");
    const labels = i.labels ?? LABEL_PRESETS[i.kind] ?? LABEL_PRESETS.cost;
    const fyStart = `${i.fy_start.slice(0, 7)}-01`;
    const id = await tx(async (x) => {
      const src = i.copyFrom && uuid(i.copyFrom) ? await x.one<{ guidelines: unknown; actuals_cutoff_day: number; projection_cutoff_day: number; fy_start: string }>(`select guidelines, actuals_cutoff_day, projection_cutoff_day, fy_start from aop_cycles where id = $1`, [i.copyFrom]) : null;
      const c = (await x.one<{ id: string }>(
        `insert into aop_cycles (name, kind, fy_start, months, status, labels, actuals_cutoff_day, projection_cutoff_day, guidelines, owner_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [i.name.trim(), i.kind, fyStart, i.months ?? 12, i.activate ? "active" : "draft", JSON.stringify(labels), src?.actuals_cutoff_day ?? 7, src?.projection_cutoff_day ?? 20, JSON.stringify(src?.guidelines ?? []), u.id]))!.id;
      if (src) {
        const secs = await x.q<{ id: string; parent_id: string | null; name: string; kind: string; owner_id: string | null; owner_label: string | null; team_id: string | null; sort: number }>(
          `select id, parent_id, name, kind, owner_id, owner_label, team_id, sort from aop_sections where cycle_id = $1 order by parent_id nulls first, sort`, [i.copyFrom]);
        const map = new Map<string, string>();
        const pending = [...secs];
        while (pending.length) {
          const s = pending.shift()!;
          if (s.parent_id && !map.has(s.parent_id)) { pending.push(s); continue; }
          const nid = (await x.one<{ id: string }>(`insert into aop_sections (cycle_id, parent_id, name, kind, owner_id, owner_label, team_id, sort) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
            [c, s.parent_id ? map.get(s.parent_id) : null, s.name, s.kind, s.owner_id, s.owner_label, s.team_id, s.sort]))!.id;
          map.set(s.id, nid);
        }
        await x.q(`insert into aop_owners (section_id, user_id, role) select m.new_id, o.user_id, o.role from aop_owners o join (select unnest($1::uuid[]) as old_id, unnest($2::uuid[]) as new_id) m on m.old_id = o.section_id`,
          [[...map.keys()], [...map.values()]]);
        const items = await x.q<{ id: string; section_id: string; name: string; metric: string | null; unit: string; direction: string; owner_id: string | null; reference: string | null; attributes: unknown; sort: number }>(
          `select id, section_id, name, metric, unit, direction, owner_id, reference, attributes, sort from aop_items where cycle_id = $1 and active`, [i.copyFrom]);
        const shift = (Number(fyStart.slice(0, 4)) - Number(src.fy_start.slice(0, 4))) * 12 + (Number(fyStart.slice(5, 7)) - Number(src.fy_start.slice(5, 7)));
        for (const it of items) {
          const nid = (await x.one<{ id: string }>(`insert into aop_items (cycle_id, section_id, name, metric, unit, direction, owner_id, reference, attributes, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
            [c, map.get(it.section_id), it.name, it.metric, it.unit, it.direction, it.owner_id, it.reference, JSON.stringify(it.attributes ?? {}), it.sort]))!.id;
          if (i.copyPlan) await x.q(`insert into aop_period_values (item_id, period, plan, updated_by) select $1, (period + make_interval(months => $3))::date, plan, $4 from aop_period_values where item_id = $2 and plan is not null`, [nid, it.id, shift, u.id]);
        }
      }
      await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: c, action: "created", summary: i.name }, x);
      return c;
    });
    done();
    return ok({ id }, "Cycle created");
  } catch (e) { return fail(e); }
}

/** Generate pending submission rows for a period (so input tracking & the nav badge see it). */
export async function openInputPeriod(i: { cycleId: string; period: string; kind: InputKind }): Promise<ActionResult> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only the PM can open input periods");
    const m = await loadModel(i.cycleId);
    if (!m) throw new Error("Cycle not found");
    if (!cycleMonths(m.cycle.fy_start, m.cycle.months).includes(i.period)) throw new Error("Month outside the plan year");
    for (const f of m.functions)
      await q(`insert into aop_submissions (cycle_id, section_id, period, kind, owner_id, due_date) values ($1,$2,$3,$4,$5,$6) on conflict (section_id, period, kind) do nothing`,
        [m.cycle.id, f.id, i.period, i.kind, sectionOwner(f)?.id ?? null, dueFor(m, i.period, i.kind)]);
    done();
    return ok(undefined, `${monLabel(i.period)} ${i.kind} opened`);
  } catch (e) { return fail(e); }
}

/* ---------- import templates ---------- */

export async function saveImportTemplate(i: { id?: string | null; name: string; headerRows: number; mapping: unknown }): Promise<ActionResult<{ id: string }>> {
  try {
    const u = await requireUser();
    if (!canManage(u)) throw new Error("Only admins and PMs can save templates");
    if (!i.name?.trim()) throw new Error("Name the template");
    const id = i.id
      ? (await one<{ id: string }>(`update aop_import_templates set name = $2, header_rows = $3, mapping = $4 where id = $1 returning id`, [i.id, i.name.trim(), i.headerRows, JSON.stringify(i.mapping)]))?.id
      : (await one<{ id: string }>(`insert into aop_import_templates (name, header_rows, mapping, created_by) values ($1,$2,$3,$4) returning id`, [i.name.trim(), i.headerRows, JSON.stringify(i.mapping), u.id]))?.id;
    if (!id) throw new Error("Template not found");
    revalidatePath("/aop/import");
    return ok({ id }, "Template saved");
  } catch (e) { return fail(e); }
}
