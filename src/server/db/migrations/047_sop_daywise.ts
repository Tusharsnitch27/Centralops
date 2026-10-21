// S&OP (40-49): every channel / function owner enters projections day by day, split North / South.
// Category inward also carries the pre-pack inward per warehouse; returns lines move to the Snowflake returns feed.
export const sql = /* sql */ `
update sop_streams set granularity = 'day' where active;
update sop_streams set dimensions = '["North","South"]'::jsonb where active and code <> 'inbound-category-wise';
update sop_streams set dimensions = '["North","South","Pre-pack North","Pre-pack South"]'::jsonb where code = 'inbound-category-wise';
update sop_lines set active = false where metric = 'returns' and stream_id in (select id from sop_streams where code in ('b2c-sf','b2c-mp'));
`;
