// Rulebook order day / cutoff per order type ("Tuesday" / "Wednesday 9 AM"): store-order placement adherence (B2B Retail, AOP Functions).
export const sql = /* sql */ `
alter table fn_rulebook add column if not exists fresh_order_day text;
alter table fn_rulebook add column if not exists fresh_order_cutoff text;
alter table fn_rulebook add column if not exists rpl_order_day text;
alter table fn_rulebook add column if not exists rpl_order_cutoff text;
`;
