# AOP › Functions: one plain view per cost lever (design)

Date: 23 Nov 2026 · Owner: Malhar M · Audience: Maddy (leadership), Manish (warehouse), Iqbal (logistics)

## Why

The AOP pages built so far (Overview, Warehouse, Processing, Unit costs, Logistics) are a cleaner version of the Cost Master sheet:
they show what was spent. Leadership now wants one plain view per cost lever that explains **why** the cost is what it is and what it
would be if the operation ran to plan, so that the extra cost can be attributed and acted on.

The two biggest levers are manpower and logistics. Manpower is shown per function: Inwards, B2C Shopify, B2C Marketplace, B2B Retail,
B2B Marketplace and Returns. Each function shows:

- planned volume (S&OP projection), received volume and processed volume;
- ideal manpower and cost, built bottom up, against actual manpower and cost;
- the gap between them, split into named causes;
- the grey areas (missing data, assumptions), named on the page.

## Goals

1. A new AOP tab **Functions** with a function picker. All functions share one site filter (Both / South / North) and one time toggle
   (**last 30 days, day on day** | **month on month, FY to date**).
2. Per function: one chart (volume and cost on two axes), a scenario toggle, a cost-gap split and a two to four line plain summary
   under the chart (style of the inwards example: "throughput 15k a day at South, received 20k, putaway 12k, 5 issues; without the
   issues putaway would be 15k").
3. Ideal cost is bottom up: the month's **peak day** of projected volume ÷ IPP gives the heads the month needs (heads are held all
   month to meet the peak), plus a **10 % absenteeism allowance**. Attrition is not in ideal heads; it is shown as a note.
4. The gap actual − ideal is split into named causes in ₹. Whatever the causes don't explain is shown as **other**, never hidden.
5. Grey areas are stated explicitly on every chart: which numbers are assumed, missing, proxied or provisional.
6. The AOP summary (Overview) shows actuals against both the **AOP plan** and the **budget** (Cost Master budget) where both exist.
7. All six functions are built together on one shared engine (Malhar, 23 Nov): the same volume series, ideal-heads, ₹ and
   gap-split code; each function only declares its sources, stages and scenario. B2B Retail's extra scenario (rulebook / cross-zone)
   and B2C's SLA overlay are function-specific layers on top.

## Non-goals

- No new data entry. Everything is read from existing tables and Snowflake.
- No change to the Cost Master logic, the Warehouse / Processing / Unit costs pages, or S&OP pages.
- No forecasting model. Projections come from the S&OP projection sheet as loaded today.
- No staffing recommendation that claims an SLA outcome where the SLA model's fit is weak (existing rule from the SLA headroom panel).

## Anti-goals (would make it a failure even if it works)

- A number with no stated basis, or a gap with no "other" bucket that silently absorbs error.
- Method text or jargon on the page (leadership rejected "Emiza method"-style explanations). Explanations are one plain sentence.
- Two screens showing the same measure with different values. Ideal / actual heads and ₹ must tie to Processing for the same month,
  site and function; logistics ₹ must tie to Unit costs / Logistics.

## Constraints

- Next.js 16 app, server components, raw SQL (`pg`), recharts already installed. No new dependencies.
- Local dev DB (PGlite) is fragile; heavy pages must work with `PG_POOL_MAX=1`.
- Snowflake is read only. Daily feeds land in Postgres via the 07:00 job (`src/instrumentation-node.ts`).
- Missing is shown as missing, never ₹0. Ratios are Σ cost ÷ Σ volume, never an average of ratios.

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | New AOP tab "Functions": server computes each function's series and cost split on request; one shared client chart (recharts) | Cheapest to extend to six functions; nothing existing moves; logic changes need no backfill | **Chosen** (Malhar, 23 Nov) |
| B | Fold into AOP › Processing | Reuses heads / IPP, but Processing is monthly and process-level; would re-clutter a page just cleaned | Rejected |
| C | Pre-compute a stored daily table per function in the 07:00 job | Fast reads, but every logic change needs a backfill while the logic is still being agreed | Rejected |

## Decisions taken (Malhar, 23 Nov 2026)

- The cost gap is split into named causes (not just two lines, not scenarios only).
- Ideal heads include absenteeism 10 %; attrition is a note only.
- All functions start on the same build logic (B2B Retail was the first proposed; superseded 23 Nov).
- Placement: new AOP tab "Functions"; Overview stays.
- Norms: the **updated IPP master** (`activeIpps`, site-specific) is the one productivity norm everywhere. **Processing switches
  from the Cost Master sheet targets to it**, so Functions and Processing show the same heads needed (Processing's figures move).
- B2B stages with no output feed (South Bagging 100, Encoding 300, Dispatch 80; North Bagging 150): their IPPs are **boxes a day**;
  they count in ideal heads at units ÷ 30 per box.
- Overview summary: actual against **Budget and Provision** (the AOP's own two plan figures), side by side.

## Shared definitions (all functions)

- **Volume series (per day, per site):** projection (S&OP daily plan, `sop_plan_daily`; monthly-only streams spread evenly over
  working days and labelled as such), received (what arrived to be processed: orders placed / goods received / returns received),
  processed (stage output, `wcm_stage_output`).
- **IPP:** the active updated IPP set per site (`activeIpps`, version `ipp-updated-2026-11-21`), also used by Processing from this
  change. Units per head per day for a stream = 1 ÷ Σ (pass share ÷ IPP in units) over its stages with an IPP; box-based stages
  (Unloader, Bagging, Encoding, Dispatch) convert at 30 units per box; SPF pass share 15 %.
- **Peak day:** the literal maximum projected day of the calendar month (Malhar: heads are held all month for the peak). In the
  30-day view each day carries its own month's peak. The actual-volume peak is shown beside it.
- **Ideal heads (month):** on the floor = ⌈ peak projected day ÷ units per head per day ⌉; on roll = on the floor × 1.10
  (absenteeism allowance). Shown also from the actual peak day ("what we really needed").
- **Actual heads:** attendance present heads (on the floor) for the function's department, split to the stream by the existing rule
  split (`ruleSplit`, Manish's allocation %), so it ties to Processing. Compared with ideal **on the floor** (like for like);
  ₹ comparisons use on-roll ideal × ₹ per head against actual ₹.
- **₹ per head:** the same salary basis Processing uses (sheet salary per stream; ₹21,983 default), so ideal / actual ₹ tie to
  Processing.
- **Cost per unit:** (manpower ₹ + logistics ₹ for the stream) ÷ processed units. Logistics ₹ from the same sources Unit costs uses.
- **Two gaps, each with its own causes and "other":** manpower (below) and, for B2B Retail and B2C, logistics (cross-zone or courier
  rate above baseline, then other). The self-check holds per gap: causes + other = actual − ideal.
- **Manpower gap causes (₹, month or 30-day window):**
  1. volume above projection: (actual peak − projected peak) ÷ units per head × ₹ per head (can be negative);
  2. erratic load: heads held for the peak above what the average day needs, on the actual series;
  3. held-up work (issues): processing lost to issues, where an issue source exists (else grey area);
  4. productivity below IPP: actual heads − heads the processed volume needed at IPP, after 1–3;
  5. absenteeism above 10 %: not measurable today (attendance gives present heads only) — listed as a grey area, not computed;
  6. other: remainder, always shown.
- **Time toggle:** last 30 days day on day (daily lines; heads as daily present DE) | month on month (FY to date; monthly totals,
  monthly ideal from each month's peak day).

## B2B Retail forward (first build)

**Data**
- Projection: `sop_plan_daily` view `retail_fwd`, South / North per day. Malhar flagged that the daily projections need a re-check;
  the chart shows them as loaded and the summary flags days where projection and orders differ by > 30 %.
- Received (store orders): `snitch_db.maplemonk.DISTRIBUTION_ANALYTICS` (live, one row per store order): ORDER_DATE, WAREHOUSE_NAME,
  STORE, QUANTITY, PACKAGE_COUNT, ORDER_TYPE (FRESH / RPL / …), ORDER_PLACEMENT_SLA (WITHIN_SLA / EARLY_CREATION / BREACHED / null),
  HANDOVER_SLA, COURIER_PARTNER, ZONE. Needs a new daily pull into Postgres (same pattern as `pullRetailSpine`).
- Processed: B2B Retail dispatched units (`wcm_stage_output`).
- Rulebook: `snitch_db.maplemonk.DISTRIBUTION_RULEBOOK` (latest UPLOAD_DATE): per store WH, ZONE, FRESH / RPL order day, cut-off,
  handover day and quantity.
- Freight: LR file (`lg_b2b_lr`) by lane / zone, as on AOP › Logistics.

**Chart (two axes):** units per day (projection, orders by rulebook status stacked, dispatched, ideal capacity) and ₹ per unit
(actual, ideal). Merchandising SLA line: % of order units placed in their rulebook window.

**Scenario toggle:** As is | Rulebook followed. "Rulebook followed" re-times every store's order quantity to its rulebook order day
(same monthly units, rulebook days), recomputes the peak day, ideal heads and ₹ per unit; and moves cross-warehouse units back to
the rulebook warehouse, repricing their freight at the same-zone lane rate. The difference is shown as ₹ and ₹ per unit.

**Cross-zone:** units shipped from a warehouse other than the store's rulebook warehouse (rulebook `WH` column, latest upload; the
rulebook `ZONE` column is `#REF!` for most stores, so zone comes from DISTRIBUTION_ANALYTICS / the spine), × (₹ per unit on the
actual site → store-zone lane − ₹ per unit on the rulebook site → store-zone lane), lane rates from the LR file. This covers
West / East stores too (both warehouses ship there; the rulebook says which should). Stores missing from the rulebook are a grey area.

**Current read (Snowflake, 23 Nov):** in Oct only ~2 % of store-order units were placed inside the rulebook window
(22k of 820k); 50 % of North's units went to stores outside the North zone. Store zones include West and East.

## Per-function sources (shared engine)

| Function | Projection (daily) | Received | Processed | Issues / overlay |
|---|---|---|---|---|
| Inwards | `sop_plan_daily` category_inward | WAM `WAM_ASN_INWARD`: FI_QTY on gate-entry day; boxes = ACTUAL_BOXES_RECEIVED once per ASN (until synced: PO receipts, 30 / box) | putaway (`wcm_stage_output` Inward putaway) | WAM `WAM_ISSUES_DAILY`, `WAM_KPI_DAILY` (discrepancies) |
| B2C Shopify | `sop_plan_daily` b2c Shopify rows | orders created (UC) | dispatched (stage feed) | SLA snapshot `wcm_sla_cell`; courier ₹ vs baseline |
| B2C Marketplace | `sop_plan_daily` b2c marketplace rows | orders created | dispatched | SLA snapshot |
| B2B Retail | `sop_plan_daily` retail_fwd | store orders (`DISTRIBUTION_ANALYTICS`) | dispatched | rulebook, merchandising SLA, cross-zone |
| B2B Marketplace | monthly plan spread evenly (grey area) | MP orders (tracker) | dispatched | erratic-load view only |
| Returns | monthly plan spread evenly (grey area) | `RETURN_2_INWARDING_DATA` received | putaway / QC (stage feed) | channel split Shopify / marketplace |

WAM lands in Snowflake through the n8n workflow in `docs/n8n/` (Metabase questions #2177 base join, #2281 issues, #2283 KPI →
`SNITCH_DB.MAPLEMONK.WAM_*`, MERGE daily at 06:30 IST, first run = backfill).

Cross-zone rule (Malhar, 23 Nov): North WH → North-zone stores and South WH → South-zone stores are home; North WH → South zone
or South WH → North zone is cross-zone. West, East, Central and North East stores are not mapped for now (neither home nor
cross-zone; shown as "unmapped zone" units).

Zones: `Distribution 2.0 Rule Book` (Google Sheet 1pEl5C_xJCS-w2QDtNk5JT5Pmog6T7raMGWf-5Z_mvAo), tabs "Zone Classification North /
South" (city → primary zone: North, South, East, West, Central, North East). Loaded as a small seed table.

## Overview: AOP plan and budget

The Overview's function bars currently compare actual with the AOP plan only. Add the Cost Master budget beside it where the function
has one (Warehousing & Fulfilment, Packaging), so the summary reads "actual vs AOP plan vs budget". Functions with no budget show
"no budget" explicitly.

## Grey areas (shown on the page, per function)

- Inwards: until the WAM sync runs, received = PO quantity received (approximate day: PO last-update date) and boxes = units ÷ 30;
  issues unknown. After it runs, both come from WAM.
- B2B Marketplace and Returns: projections are monthly only; their daily projection is an even spread.
- Absenteeism is an assumed 10 %, not measured. Attrition is not modelled.
- Salary is the legacy ₹21,983 / head basis where no sheet salary exists.
- Projection days flagged by Malhar as needing a re-check (B2B Retail daily).
- Pick scans are 48–82 % captured; stages with no feed (loader, bagging, encoding, dispatch) are not in processed volume.
- Logistics: billed before credit notes; Recon API holds one invoice so far.

## Calls made in writing this up (Claude, for Malhar to check)

- Actual heads compared on the floor; ₹ on roll (above).
- Two gaps (manpower, logistics), each with "other".
- Peak = literal monthly max of the projection; each day in the 30-day view uses its month's peak.
- Cross-zone judged against the rulebook warehouse, lanes priced from the LR file.
- Actual B2B Retail heads keep Manish's fixed allocation % (ties to Processing); moving work between Retail and Marketplace then
  shows in "productivity below IPP" / "other" — named in the summary when large.

## Left to the builder

- Chart styling within the app's existing look (minimal, dark section bars, tables over graphs where a chart adds nothing).
- Query shapes, caching, file layout under `src/server/functions/` and `src/components/aop/functions/`.
- The exact wording of summaries, within the anti-goals above.
- The self-check: one `scripts/check-functions.mjs` covering the ideal-heads and gap-split maths (gap causes + other = actual − ideal).
