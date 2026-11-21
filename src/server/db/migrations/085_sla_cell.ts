// Service levels on the upstream SLA definitions (additive). One snapshot of SLA cells, read by S&OP › Service levels and the
// AOP › Analysis SLA headroom check. A cell = deadline × created hour × warehouse × stream × wave, with counts by SLA status.
//   B2C (Shopify / Marketplace)  warehouse_sla_performance: SLA_STATUS as computed upstream; delay_flag lines counted apart and
//                                excluded from every other count. Units = order lines. Wave = TAT_TYPE. ~60-day source → snapshot.
//   B2B Retail                   retail_journey_spine: HANDOVER_SLA vs HANDOVER_DEADLINE_TS. Units = quantity; orders counted too.
//   B2B Marketplace              Marketplace<>Warehouse tracker (gs_marketplace_wh_tracker): deadline = planned Dispatch_date (18:00
//                                taken), done = RTS_DATE. No UC TAT exists for this channel. Units = QTY.
// wcm_sla_daily (080) is no longer written; it stays for history.
export const sql = /* sql */ `
create table if not exists wcm_sla_cell (
  deadline timestamp not null,              -- IST wall clock; for rows with no deadline, the created hour (wave = 'No SLA')
  created_hr timestamp not null,            -- IST hour the line / order was created
  wh text not null check (wh in ('WH1','WH2','NORTH')),
  stream text not null,
  wave text not null,
  source text not null,
  units numeric not null,                   -- all units in the cell (lines for B2C, quantity for B2B)
  within numeric not null default 0,        -- done by the deadline
  fut_done numeric not null default 0,      -- done, deadline still ahead (B2C FUTURE DATE-COMPLETED) — on time by definition
  breached numeric not null default 0,      -- done after the deadline
  pend_breach numeric not null default 0,   -- not done, deadline passed
  fut_open numeric not null default 0,      -- not done, deadline ahead
  cancelled numeric not null default 0,
  unfulfillable numeric not null default 0,
  no_sla numeric not null default 0,        -- no deadline (B2B NSO / QCOM, tracker rows without dates)
  delay_flagged numeric not null default 0, -- B2C delay_flag (exchange / warehouse switch / error order): excluded from the above
  orders int, orders_late int,              -- B2B only
  o2m_h numeric not null default 0, o2m_n int not null default 0, -- B2C: Σ created → dispatched hours and lines, judged lines only
  fetched_at timestamptz not null default now(),
  primary key (deadline, created_hr, wh, stream, wave)
);
create index if not exists wcm_sla_cell_day on wcm_sla_cell ((deadline::date), stream);
`;
