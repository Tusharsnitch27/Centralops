// Warehouse service levels (additive). warehouse_sla_performance keeps ~60 days, so its per-cohort SLA figures are snapshotted
// here daily: days the source still returns are replaced, older days stay frozen as last read (same rule as wcm_stage_output).
export const sql = /* sql */ `
create table if not exists wcm_sla_daily (
  day date not null,                        -- cohort: IST calendar day the order line was created in Unicommerce
  site text not null check (site in ('South','North')),
  stream text not null,
  lines int not null,                       -- distinct order lines created
  cancelled int not null,
  no_sla int not null,                      -- not cancelled but no SLA deadline in the source (TAT blank / 1899)
  eligible int not null,                    -- not cancelled, with an SLA deadline
  dispatched int not null,                  -- eligible and dispatched
  on_time int not null,                     -- eligible and dispatched by the SLA deadline
  open int not null,                        -- eligible, not dispatched when read
  overdue int not null,                     -- open and past the SLA deadline when read
  p50_h numeric, p90_h numeric,             -- created → dispatched hours, eligible dispatched lines
  fetched_at timestamptz not null default now(),
  primary key (day, site, stream)
);
`;
