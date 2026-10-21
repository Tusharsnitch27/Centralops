import "server-only";
import { q } from "../db";
import { visibleSql } from "../org/queries";

export interface SearchHit { type: string; id: string; title: string; subtitle: string | null; href: string }

/** Global search across work objects (ILIKE; natural-language search can layer on later). */
/** `scope`: whose tasks the searcher may see (null = all). */
export async function search(term: string, limit = 6, scope: { me: string; ids: string[] } | null = null): Promise<SearchHit[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const like = `%${t.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const num = /^(?:co-)?(\d+)$/i.exec(t)?.[1];
  return q<SearchHit>(
    `(select 'task' as type, t.id::text, t.title, concat_ws(' · ', 'CO-' || t.number, u.name, p.name) as subtitle, '/tasks/' || t.id as href
        from tasks t left join users u on u.id = t.owner_id left join projects p on p.id = t.project_id
        where (t.title ilike $1 or t.number::text = $3) and ($4::uuid[] is null or ${visibleSql("$4", "$5::uuid")}) order by (t.status in ('completed','cancelled')), t.updated_at desc limit $2)
     union all
     (select 'project', id::text, name, coalesce(code, objective), '/projects/' || id from projects where name ilike $1 or code ilike $1 or objective ilike $1 limit $2)
     union all
     (select 'program', id::text, name, description, '/programs/' || id from programs where name ilike $1 or description ilike $1 limit $2)
     union all
     (select 'meeting', id::text, title, to_char(starts_at at time zone 'Asia/Kolkata', 'Dy, DD Mon · HH12:MI am'), '/meetings/' || id from meetings where title ilike $1 or summary ilike $1 order by starts_at desc limit $2)
     union all
     (select 'decision', id::text, title, context, '/decisions?focus=' || id from decisions where title ilike $1 or context ilike $1 or reason ilike $1 limit $2)
     union all
     (select 'risk', id::text, title, mitigation, '/risks?focus=' || id from risks where title ilike $1 or description ilike $1 limit $2)
     union all
     (select 'aop_item', i.id::text, i.name, s.name, '/aop/plan?item=' || i.id from aop_items i join aop_sections s on s.id = i.section_id where i.name ilike $1 or s.name ilike $1 limit $2)
     union all
     (select 'person', id::text, name, title, '/people/' || id from users where active and (name ilike $1 or email ilike $1 or title ilike $1) limit $2)`,
    [like, limit, num ?? "-1", scope?.ids ?? null, scope?.me ?? null],
  );
}
