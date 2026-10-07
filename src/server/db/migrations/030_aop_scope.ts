// AOP: configurable input fields per cycle; opex/capex tagging on functions; scope = opex only (no Staffing, no capex).
export const sql = /* sql */ `
alter table aop_cycles add column if not exists input_config jsonb not null default
  '{"fields":["plan","forecast","actual","commentary","variance_reason","corrective_action","confidence"],"ownerCanEditPlan":false,"requireReasonOverThreshold":true}';
alter table aop_sections add column if not exists expense_type text not null default 'opex' check (expense_type in ('opex','capex'));

-- Current scope: operating expenses only. Staffing is out of scope; one-time / fixed-asset (capex) buckets are removed.
delete from aop_sections where kind = 'function' and name in ('Staffing', 'Fixed Assets & One-time', 'RFID');
`;
