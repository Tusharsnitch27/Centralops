// Function owners (user decision 2026-10-07): Logistics – Iqbal · SaaS – Faisal · Packaging – Tushar · Warehousing – Manish.
// Lines inherit the function owner; contributors are cleared.
export const sql = /* sql */ `
with o(fn, uname) as (values ('Logistics','iqbal'), ('SaaS','faisal'), ('Packaging','tushar'), ('Warehousing & Fulfilment','manish')),
     owner as (
       select o.fn, coalesce(
         (select id from users where lower(username) = o.uname limit 1),
         (select id from users where lower(email) like o.uname || '@%' limit 1),
         case when o.uname = 'tushar' then (select id from users where role = 'admin' order by created_at limit 1) end) as uid,
         initcap(o.uname) as label
       from o)
update aop_sections s set owner_id = owner.uid, owner_label = owner.label from owner where s.kind = 'function' and s.name = owner.fn;
delete from aop_owners where section_id in (select id from aop_sections where kind = 'function' and name in ('Logistics','SaaS','Packaging','Warehousing & Fulfilment'));
update aop_sections g set owner_id = f.owner_id from aop_sections f where g.parent_id = f.id and f.kind = 'function';
update aop_items i set owner_id = coalesce(f.owner_id, g.owner_id)
  from aop_sections g left join aop_sections f on f.id = g.parent_id where i.section_id = g.id;
update aop_submissions s set owner_id = sec.owner_id from aop_sections sec where sec.id = s.section_id;
`;
