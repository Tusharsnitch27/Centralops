# Functions: SLA and cost-reduction pointers, pre-pack counting and ROI

Date: 25 Nov 2026 · Owner: Malhar M · Status: approved 25 Nov 2026

## Why
Leadership review: show, per function, where manpower cost can come down. The argument is that in BAU months a team sized near the
projected average day costs less, and that the SLA is what that trade-off risks: when volume runs above the projection the
same team cannot hold the SLA, but cost does not rise (the excess becomes breaches, not extra heads). Separately: Inwards
under-counts pre-packs, and we want to know whether pre-packing pays for itself across Inwards and B2B Retail.

## Goals
1. A pointer block under each function's chart (`/functions/<fn>`), both views (day / month):
   - **SLA performance**: on-time % over the window, and units that missed it.
   - **Average cost**: actual ₹ per unit and heads (as today, restated).
   - **Team at the projected average (BAU)**: heads = the month's average projected day ÷ units per head; its ₹ and ₹ per unit;
     the saving against actual.
   - **When volume runs above the projection**: with that team, work above its daily capacity carries over; units carried past the
     function's TAT are counted as breaches (simulated day by day over the window). Shown as "on N days volume exceeded the projection;
     ~X units (Y %) would miss the SLA — cost stays the same".
   - **What a different SLA does to manpower** (so it is visible / inferrable): heads needed to clear all volume within each TAT —
     same day, 24 h, 48 h, 72 h — and their ₹. A longer TAT lets the team spread peaks, so heads fall; the current TAT is marked.
2. **Overview** (`/functions`) by-function table: an **SLA** column (on-time % in the window), "—" where the function has no SLA.
3. **Inwards counts pre-pack pieces**: putaway quantity × pack size (PP4-… = 4), the S&OP Category inward rule (`sop/sync.ts mult`).
4. **Pre-pack ROI** (pointer on Inwards and B2B Retail): extra inward time of pre-pack ASNs and its ₹, against the modelled pick/pack
   saving at Retail (one pack picked/packed instead of N pieces), and the net.

## Non-goals / anti-goals
- **Do not change the ideal heads calculation** (average day + half the peak gap), the gap causes or any reconciliation already reviewed.
- No new targets or SLA definitions beyond those below; no forecast changes.
- Anti-goal: a pointer that shows a saving without the SLA risk next to it.

## SLA per function

| Function | SLA | Source → measure | Storage |
|---|---|---|---|
| Inwards | ≤ 24 h gate entry → last putaway | WAM_ASN_INWARD per ASN (GATE_ENTRY_TIME → LAST_PUV_AT), units = FI_QTY | new pull |
| B2C Shopify / Marketplace | TAT column | warehouse_sla_performance (already in wcm_sla_cell) | existing |
| B2B Retail | handover by HANDOVER_DEADLINE_TS | retail_journey_spine (already in wcm_sla_cell) | existing |
| B2B Marketplace | none; capacity 5,000 items/day | — (capacity used in place of TAT for the "above projection" line) | — |
| B2C Returns | ≤ 48 h receiving → processed | RETURN_2_INWARDING_DATA RECEIVING_DATE → PROCESSED_DATE (the returns processed date — Malhar) | new pull |
| B2B Returns | ≤ 2 days receiving → processed | WH Retail Return Tool `shipment_tracker` (its Postgres, read-only `RETAIL_RETURN_DATABASE_URL`): consideredDeliveredDate → processingEndDate (a date), units = dcQuantity; retail stores + Myntra. Putaway is not the measure (Malhar: the time is in receiving and processing) | read at view time |

New pulls write one table: day × site × function → judged units, within units (missing = null, never 0).

## Approaches considered
- **A1 (chosen): pointers alongside the current ideal.** Nothing already reviewed moves.
- A2: make the projection-sized team the ideal. Rejected — changes every ideal / gap figure before the review.
- Sizing to clear everything within the TAT (no breaches) — kept only as the "different SLA" table, not the headline.

## Decided
- Projection-sized team = month's average projected day ÷ units per head (constant through the month), on the floor; ₹ at the site's
  rate per head-day (as the overview).
- Breach simulation: daily capacity = that team × units per head; backlog carried forward; units older than the TAT = breaches.
- TAT table heads = max over the window of (volume over TAT-days + 1) ÷ (TAT-days + 1) ÷ units per head.
- B2B Marketplace: capacity 5,000 items/day stands in for the projection cap; no TAT table.

## Left to the builder
- Whether B2B Retail store-order quantity / dispatched units are packs or pieces; apply the pack multiplier wherever packs are counted.
- Pre-pack Retail saving model: picks/packs saved = pieces − packs, at the pick and pack stages' share of a unit's work (passShare ÷ IPP).
- Pointer wording and layout (compact list under the chart, same style as the summary lines).
- Self-checks in `scripts/check-functions.mjs` for the backlog/breach simulation and the TAT table.
