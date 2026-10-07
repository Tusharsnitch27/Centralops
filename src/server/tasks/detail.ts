import "server-only";
import { one, q } from "../db";
import { fmtDate } from "@/lib/dates";
import { listTasks, type TaskListItem } from "./queries";
import { taskFollowups, type FollowupRow } from "./followups";
import type { Health, Priority, TaskStatus } from "@/lib/meta";

export interface TaskDetail {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  health: Health;
  priority: Priority;
  due_date: string | null;
  original_due_date: string | null;
  start_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_color: string | null;
  owner_team_id: string | null;
  owner_team_name: string | null;
  requester_id: string | null;
  requester_name: string | null;
  created_by_name: string | null;
  waiting_on_id: string | null;
  waiting_on_name: string | null;
  project_id: string | null;
  project_name: string | null;
  program_id: string | null;
  program_name: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  meeting_starts_at: string | null;
  source: string;
  blocker: string | null;
  next_step: string | null;
  last_update_at: string | null;
  last_update_note: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  days_since_update: number;
}

export interface JourneyEvent {
  id: string;
  event: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_color: string | null;
  from_value: string | null;
  to_value: string | null;
  from_label: string | null;
  to_label: string | null;
  note: string | null;
  created_at: string;
}

export interface CommentRow { id: string; body: string; author_id: string | null; author_name: string | null; author_color: string | null; created_at: string; kind: "comment" | "update"; status: string | null }
export interface AttachmentRow { id: string; name: string; url: string | null; uploaded_by_name: string | null; created_at: string }
export interface RelatedRow { type: string; id: string; title: string; relation: string; href: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function getTask(id: string): Promise<TaskDetail | null> {
  if (!UUID.test(id)) return null;
  return one<TaskDetail>(
    `select t.id, t.number, t.title, t.description, t.status, t.health, t.priority, t.due_date, t.original_due_date, t.start_date,
            t.owner_id, ou.name as owner_name, ou.avatar_color as owner_color, t.owner_team_id, tm.name as owner_team_name,
            t.requester_id, ru.name as requester_name, cu.name as created_by_name, t.waiting_on_id, wu.name as waiting_on_name,
            t.project_id, pr.name as project_name, t.program_id, pg.name as program_name,
            t.meeting_id, m.title as meeting_title, m.starts_at as meeting_starts_at,
            t.source, t.blocker, t.next_step, t.last_update_at, t.last_update_note, t.acknowledged_at, t.completed_at, t.created_at, t.updated_at,
            extract(day from now() - coalesce(t.last_update_at, t.created_at))::int as days_since_update
     from tasks t
     left join users ou on ou.id = t.owner_id
     left join teams tm on tm.id = t.owner_team_id
     left join users ru on ru.id = t.requester_id
     left join users cu on cu.id = t.created_by
     left join users wu on wu.id = t.waiting_on_id
     left join projects pr on pr.id = t.project_id
     left join programs pg on pg.id = t.program_id
     left join meetings m on m.id = t.meeting_id
     where t.id = $1`, [id]);
}

/** task_history with actor + human labels for ids (people, teams, projects) and dates. */
export async function taskJourney(id: string): Promise<JourneyEvent[]> {
  const rows = await q<Omit<JourneyEvent, "from_label" | "to_label">>(
    `select h.id, h.event, h.actor_id, u.name as actor_name, u.avatar_color as actor_color, h.from_value, h.to_value, h.note, h.created_at
     from task_history h left join users u on u.id = h.actor_id where h.task_id = $1 order by h.created_at asc, h.id`, [id]);
  const ids = [...new Set(rows.flatMap((r) => [r.from_value, r.to_value]).filter((v): v is string => !!v && UUID.test(v)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const found = await q<{ id: string; name: string }>(
      `select id, name from users where id = any($1::uuid[])
       union all select id, name || ' (team)' from teams where id = any($1::uuid[])
       union all select id, name from projects where id = any($1::uuid[])
       union all select id, name from programs where id = any($1::uuid[])`, [ids]);
    for (const f of found) names.set(f.id, f.name);
  }
  const people = await q<{ name: string }>(`select name from users where active`);
  const label = (v: string | null, event: string) => {
    if (v == null) return null;
    if (UUID.test(v)) return names.get(v) ?? "Unknown";
    if (event === "due_changed" && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v, { dow: true });
    if (event === "created") return null;
    if (event === "followed_up") return { in_app: "In-app", email: "Email", slack: "Slack", whatsapp: "WhatsApp" }[v] ?? v;
    if (event === "priority_changed") return titleCase(v);
    if (event === "assigned") {
      // seed data stores short names ("iqbal", "Logistics")
      const p = people.find((x) => x.name.toLowerCase().split(/\s+/)[0] === v.toLowerCase());
      return p?.name ?? titleCase(v);
    }
    return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  };
  return rows.map((r) => ({ ...r, from_label: label(r.from_value, r.event), to_label: label(r.to_value, r.event) }));
}

/** Comments + posted updates, newest last (a conversation thread). */
export async function taskThread(id: string): Promise<CommentRow[]> {
  return q<CommentRow>(
    `select c.id, c.body, c.author_id, u.name as author_name, u.avatar_color as author_color, c.created_at, 'comment' as kind, null as status
       from comments c left join users u on u.id = c.author_id where c.entity_type = 'task' and c.entity_id = $1
     union all
     select tu.id, tu.body, tu.author_id, u.name, u.avatar_color, tu.created_at, 'update', tu.status
       from task_updates tu left join users u on u.id = tu.author_id where tu.task_id = $1
     order by created_at asc`, [id]);
}

export const taskAttachments = (id: string) =>
  q<AttachmentRow>(
    `select a.id, a.name, a.url, u.name as uploaded_by_name, a.created_at from attachments a left join users u on u.id = a.uploaded_by
     where a.entity_type = 'task' and a.entity_id = $1 order by a.created_at`, [id]);

export async function taskDependencies(id: string): Promise<{ blockedBy: TaskListItem[]; blocking: TaskListItem[] }> {
  const deps = await q<{ task_id: string; depends_on_id: string }>(
    `select task_id, depends_on_id from task_dependencies where task_id = $1 or depends_on_id = $1`, [id]);
  const blockedByIds = deps.filter((d) => d.task_id === id).map((d) => d.depends_on_id);
  const blockingIds = deps.filter((d) => d.depends_on_id === id).map((d) => d.task_id);
  const all = blockedByIds.length || blockingIds.length ? await listTasks({ ids: [...blockedByIds, ...blockingIds] }) : [];
  return { blockedBy: all.filter((t) => blockedByIds.includes(t.id)), blocking: all.filter((t) => blockingIds.includes(t.id)) };
}

const HREF: Record<string, (id: string) => string> = {
  task: (id) => `/tasks/${id}`, project: (id) => `/projects/${id}`, program: (id) => `/programs/${id}`, meeting: (id) => `/meetings/${id}`,
  decision: (id) => `/decisions/${id}`, risk: (id) => `/risks/${id}`, aop_item: () => `/aop`, sop_stream: () => `/sop`,
};
const TITLE_SQL: Record<string, string> = {
  task: `select id, title from tasks where id = any($1::uuid[])`,
  project: `select id, name as title from projects where id = any($1::uuid[])`,
  program: `select id, name as title from programs where id = any($1::uuid[])`,
  meeting: `select id, title from meetings where id = any($1::uuid[])`,
  decision: `select id, title from decisions where id = any($1::uuid[])`,
  risk: `select id, title from risks where id = any($1::uuid[])`,
  aop_item: `select id, name as title from aop_items where id = any($1::uuid[])`,
};

/** Related objects from the universal relation graph (both directions). */
export async function taskRelated(id: string): Promise<RelatedRow[]> {
  const links = await q<{ type: string; id: string; relation: string }>(
    `select to_type as type, to_id as id, relation from entity_links where from_type = 'task' and from_id = $1
     union select from_type, from_id, relation from entity_links where to_type = 'task' and to_id = $1`, [id]);
  const byType = new Map<string, string[]>();
  for (const l of links) byType.set(l.type, [...(byType.get(l.type) ?? []), l.id]);
  const titles = new Map<string, string>();
  await Promise.all([...byType].map(async ([type, ids]) => {
    const sql = TITLE_SQL[type];
    if (!sql) return;
    try {
      for (const r of await q<{ id: string; title: string }>(sql, [ids])) titles.set(r.id, r.title);
    } catch { /* table owned by another module may not exist yet */ }
  }));
  return links.map((l) => ({ type: l.type, id: l.id, relation: l.relation, title: titles.get(l.id) ?? titleCase(l.type.replace(/_/g, " ")), href: HREF[l.type]?.(l.id) ?? null }));
}

export const taskTags = (id: string) => q<{ tag: string }>(`select tag from task_tags where task_id = $1 order by tag`, [id]).then((r) => r.map((x) => x.tag));

export async function taskDetailBundle(id: string) {
  const task = await getTask(id);
  if (!task) return null;
  const [journey, thread, attachments, deps, related, tags, followups] = await Promise.all([
    taskJourney(id), taskThread(id), taskAttachments(id), taskDependencies(id), taskRelated(id), taskTags(id), taskFollowups(id),
  ]);
  return { task, journey, thread, attachments, deps, related, tags, followups: followups as FollowupRow[] };
}

/** Lightweight task search for the dependency picker. */
export const searchTasksLite = (term: string, exclude: string) =>
  q<{ id: string; number: number; title: string; status: TaskStatus }>(
    `select id, number, title, status from tasks where id <> $2 and (title ilike $1 or number::text = $3)
     order by (status in ('completed','cancelled')), updated_at desc limit 12`, [`%${term}%`, exclude, term.replace(/^co-/i, "")]);
