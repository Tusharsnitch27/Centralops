// Liquidation actuals are uploaded day-wise (gatepass totals) by Malhar; liquidation weeks use the same Wk_0N labels as every
// other weekly view. Pre-pack inward has one source: the Category stream (units), so the separate Pre-pack stream is retired.
export const sql = /* sql */ `
update sop_review_rows r set row_label = 'Wk_' || lpad(substring(r.row_label from '(\\d+)\\s*$'), 2, '0')
  where r.view_key = 'liquidation' and r.row_label ~* '^[a-z]{3}\\s*wk\\s*\\d+$'
    and not exists (select 1 from sop_review_rows x where x.view_key = 'liquidation' and x.period = r.period
                    and x.row_label = 'Wk_' || lpad(substring(r.row_label from '(\\d+)\\s*$'), 2, '0'));
insert into app_settings (key, value)
  select 'sop.liquidation_actuals_owner', to_jsonb(id::text) from users where name ilike 'malhar%' and active order by created_at limit 1
  on conflict (key) do nothing;
update sop_streams set active = false where code = 'pre-pack-category-wise';
`;
