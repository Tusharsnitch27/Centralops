# AOP Functions — full-year backfill and fixes (round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Functions view from Apr 2026 has real volumes, attendance, cost, norms and a working rulebook scenario; Returns is split into B2C and B2B; the number errors Malhar found are fixed; anything still missing is named for him.

**Architecture:** Same engine (`src/server/functions/`). History comes from Snowflake tables that keep it (`UNICOMMERCE_FACT_ITEMS_INTERMEDIATE`, `putaway_tracking`, `RETURN_2_INWARDING_DATA`) and from the two attendance workbooks, loaded once as a seed. One IPP set sizes the whole year.

**Tech Stack:** Next.js 16 (read `AGENTS.md`), raw SQL via `q()`, Snowflake read-only via `sfQuery`, `xlsx` (installed) for the one-off attendance parse.

**Spec:** `docs/superpowers/specs/2026-11-23-aop-functions-view-design.md` plus `Centralops_HANDOVER.md` §17 (decisions as built) and the decisions below.

## Global Constraints

- Decisions (Malhar, 23 Nov): history for Apr–Oct must be complete — fill it, or flag it to Malhar with what's needed; B2B Retail store orders for Apr–Sep are rebuilt from `UNICOMMERCE_FACT_ITEMS_INTERMEDIATE` (no suffix; `_2024` starts Sep 2026) with rulebook adherence computed; `DISTRIBUTION_ANALYTICS` is a rolling 60-day window, keep pulling and storing it; Returns becomes two functions, **B2C Returns** and **B2B Returns**; the updated IPP master (`ipp-updated-2026-11-21`) sizes **every FY month in Functions and Processing**; months with no booked salary use the average salary of the heads present.
- Controller ruling (for Malhar's review): a month whose attendance covers ≥ 90 % of its days uses attendance for Processing's actual heads, ahead of the Cost Master sheet's planned MP (the sheet stays the fallback).
- Missing is null / "—" and named in a grey line, never ₹0. Σ₹ ÷ Σunits; cost and units over the same days. No method text on pages.
- Snowflake SELECT only. Local checks on the PGlite copy only — never the `DATABASE_URL` in `.env.local`.
- After each task: `npx tsc --noEmit -p tsconfig.json` (src errors only), `node --experimental-strip-types scripts/check-wcm.mjs`, `scripts/check-processing.mjs`, `scripts/check-functions.mjs`.

## Review Focus

1. A month where attendance covers only a few days (Oct: 29–31 before the backfill) → cost and units over the same days, never a 3-day cost over a full month's units (Task 4 test).
2. Days before a feed starts or after it stops → null, never 0 (Tasks 2, 3 tests: a day outside the source's coverage is null).
3. Store names that differ between UC items and the rulebook (case, spaces, "SNITCH - COFO -" vs code) → counted as "no rulebook", reported with their units, never silently dropped (Task 2 test).
4. The rulebook scenario when November has no LR file → the manpower part of the saving still shows; only the freight part is "—" (Task 6 test).
5. Old `fn=returns` links → redirect to B2C Returns, no 500 (Task 3).

---

### Task 1: One norm for the whole year

**Files:** Create `src/server/db/migrations/091_ipp_full_year.ts` (+ register in `index.ts`, version 91, name `ipp_full_year`); Modify `scripts/check-processing.mjs`.

**Interfaces:** Produces: `activeIpps(day, site)` returns the updated set for every day from 2026-04-01 (no code change to `activeIpps`).

- [ ] **Step 1:** Read `src/server/wcm/daily.ts` (`activeIpps`), `src/server/wcm/productivity.ts` (version pick), every reader of `wcm_ipp.status`, and migrations 088–090.
- [ ] **Step 2:** Migration 091: `update wcm_ipp set effective_from = '2026-04-01' where version = 'ipp-updated-2026-11-21'`; set the `ipp-targets-2026-11-20` rows to the status the code already treats as not-in-force (check — `legacy` is used by `legacy-costmaster`; don't invent a new status). Idempotent.
- [ ] **Step 3:** Verify on the local copy: `/aop/processing?month=2026-06-01&wh=South` shows updated-master IPPs (Picker 750 B2C Shopify); `/aop/functions?fn=b2b_marketplace&site=Both&mode=month` Oct ideal ≈ 11 heads, not 30; Apr–Sep ideal no longer blank where a projection exists.
- [ ] **Step 4:** Commit `feat(ipp): updated IPP master sizes every FY month (one norm, Malhar 23 Nov)`.

### Task 2: Forward history and store orders from UC items (Apr → SLA window)

**Files:** Modify `src/server/wcm/feed.ts` (new `pullUcHistory`), `src/server/functions/feed.ts` (`pullRetailOrders` adds the UC rebuild), `src/server/functions/sources.ts`, `src/server/functions/aggregate.ts` (pure helper), `scripts/check-functions.mjs`; wire `pullUcHistory` into the 07:00 tick and Refresh (isolated, like the Functions pulls).

**Interfaces:**
- Produces `pullUcHistory(from = "2026-04-01"): Promise<{ read: number; until: string }>` → `wcm_stage_output` rows, source `uc_items`, events `packed`, `dispatched`, `shipments` (distinct SHIPPINGPACKAGECODE) and new event `ordered` (items by UC_CREATED day), streams by the existing `STREAM` mapping on `MARKETPLACE_MAPPED`, site by `WAREHOUSE_NAME`, **only for days before the first day `warehouse_sla_performance` returns** (never overwrite SLA-source days).
- Produces `placementSla(orderTs: string, rule: { orderDay: string; cutoff: string } | null): "WITHIN_SLA" | "EARLY_CREATION" | "BREACHED" | null` in `aggregate.ts` (pure): within = placed on the rulebook order day before the cutoff, or up to 3 days earlier (Malhar: "ordered before the deadline and max 3 days before"); earlier than that = EARLY_CREATION; after the cutoff = BREACHED; no rule = null.
- `fn_retail_order` gains rows for Apr–Sep rebuilt from UC items (marketplace_mapped STORE / OWN_STORE_B2B / FRANCHISE_STORE_B2B; order = ORDER_NAME, date = ORDER_DATE, qty = items, store = the UC store field that matches rulebook STORE_NAME — find it; order_type from ORDER_TYPE if it carries FRESH/RPL, else null), `placement_sla` from `placementSla` against the rulebook upload in force; DISTRIBUTION_ANALYTICS rows win where both exist (upsert order: UC first, DA after).
- `sources.ts`: B2C / B2B MP received falls back to `ordered` where `wcm_sla_cell` has no day; processed already reads `dispatched`.

- [ ] **Step 1: Failing asserts** in `check-functions.mjs`: `placementSla("2026-06-03T10:00", { orderDay: "Wednesday", cutoff: "Wednesday 12 PM" })` = "WITHIN_SLA"; Monday 31 May (3 days before) = "WITHIN_SLA"; Saturday 29 May = "EARLY_CREATION"; "2026-06-03T14:00" = "BREACHED"; rule null → null.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. Read `RULEBOOK` cutoff columns (`FRESH_ORDER_CUTOFF` / `RPL_ORDER_CUTOFF`, `*_ORDER_DAY`) into `fn_rulebook` (migration 092 adds the columns; `pullRulebook` fills them). **Step 4:** Run — PASS.
- [ ] **Step 5: Verify** (local copy, after a manual pull via the scratch route): `wcm_stage_output` B2C Shopify `dispatched` South has every day from 2026-04-01; Jun 2026 South B2C Shopify dispatched within 10 % of the S&OP workbook actual (1,83,533); `fn_retail_order` from 2026-04-01; Oct share of units WITHIN_SLA ≈ 2 % (the 23 Nov read); unmatched stores reported with units.
- [ ] **Step 6:** Commit `feat(functions): forward and store-order history from UC items, rulebook adherence computed`.

### Task 3: Returns as two functions, B2B returns history

**Files:** Modify `src/server/functions/types.ts` (`FnKey`: replace `returns` with `b2c_returns`, `b2b_returns`), `sources.ts` (`FN`), `view.ts`, `workbookHistory.ts` (split or drop the combined `returns` rows), `src/app/(app)/aop/functions/page.tsx` (picker + `fn=returns` → `b2c_returns`), `src/server/wcm/feed.ts` (putaway family read from `RETURNS_FROM` = 2026-04-01).

**Interfaces:** `FN.b2c_returns = { streams: ["B2C Returns Shopify","B2C Returns Marketplace"], received: RETURN_2 'received', processed: 'qc' }`, projection = returns plan rows `^b2c` (monthly, spread evenly), heads = department B2C Return. `FN.b2b_returns = { streams: ["B2B Returns Retail","B2B Returns Marketplace"], processed: putaway (Store Return Inward + B2B MP Returns, trading only) }`, received = the same putaway (no separate receiving source — grey line), projection `^b2b`, department B2B Return.

- [ ] **Step 1:** Failing assert: `FN` keys include both and not `returns`; a check that `toMonthPoints` for b2b_returns over a day with only B2C rows gives null processed.
- [ ] **Step 2–4:** Implement; run checks; tsc.
- [ ] **Step 5: Verify:** both functions render (both modes, all sites); North Oct B2C Returns received ≈ 71,206 (S&OP actual b2c) and B2B Returns processed ≈ 1,64,298 (± trading-only difference, named in a grey line if > 5 %); `/aop/functions?fn=returns` lands on B2C Returns.
- [ ] **Step 6:** Commit `feat(functions): B2C and B2B returns as separate functions; B2B returns putaway from April`.

### Task 4: Cost and units over the same days; salary where none is booked; attendance first

**Files:** Modify `src/server/aop/processing.ts` (attendance priority when coverage ≥ 90 %), `src/server/functions/view.ts` (`norms`), `aggregate.ts`, `scripts/check-functions.mjs`, `scripts/check-processing.mjs`.

**Interfaces:** `norms()` returns per site × month `{ cost, heads, units, share }` where `units` = Processing's volume × the same share Processing used for the cost (`actualDays.days ÷ days in month`, or 1 for sheet / full months). Month `costPerUnit = Σcost ÷ Σunits`. Salary for a month with heads but no sheet salary = the site's `wcm_mp_rate` monthly salary in force (the salary master; legacy ₹21,983 default) — name it in the grey line.

- [ ] **Step 1: Failing asserts:** month with cost ₹1,32,000 at share 3/31 and month volume 2,35,504 → costPerUnit = 1,32,000 ÷ (2,35,504 × 3/31) ≈ 5.79 (not 0.56); share 1 → cost ÷ volume. Processing: a month with attendance on 28 of 30 days and a sheet planned MP uses attendance (`actualMpSource = "attendance"`).
- [ ] **Step 2–4:** Implement; run; tsc.
- [ ] **Step 5: Verify:** North Oct Returns (now B2C + B2B) ₹/unit within 2× of ideal ₹/unit, not 10× apart; Processing Oct/Nov unchanged where only the sheet exists.
- [ ] **Step 6:** Commit `fix(functions): cost and units over the same days; salary master where no salary is booked; attendance ahead of sheet MP`.

### Task 5: Attendance backfill Apr–Oct (seed)

**Blocked until** Malhar saves `Snitch Attendance Tracker Tauru GGN.xlsx` (North) and `YLK ATTENDANCE MASTER DATA.xlsx` (South) into Downloads.

**Files:** Create `scripts/attendance-backfill.mjs` (one-off parser, not run in the app), `src/db/seed/mp-daily-backfill.json`; Modify `src/server/seed/index.ts` (step keyed `seed.mp_daily_backfill` = `v1`: insert `on conflict (day, site, func) do nothing` so API days from 29 Oct are never overwritten).

**Interfaces:** JSON rows `{ day: "YYYY-MM-DD", site: "NORTH" | "WH1" | "WH2", func: <mp_func_map.func>, heads: number }` for 2026-04-01 … 2026-10-28; present heads only (P / half-day = 0.5 if the sheet marks it; state the rule found in the file in the script header).

- [ ] **Step 1:** Open both workbooks (sheet names, header rows, codes for present / absent / weekly off / leave, department and site columns); write the parse rules into the script header. Department → `mp_func_map.func` (B2C_FORWARD → "B2C Forward", B2B_Retail → "B2B Forward", B2C_Return → "B2C Return", Retail_return → "B2B Return", Inward, Inventory, Helper / Ops → "Ops"…); South WH1 vs WH2 from the sheet's location column — if the sheet has no split, **stop and report** (Malhar decides).
- [ ] **Step 2:** Generate the JSON; print a month × site × func head-count table and compare with the API's first week (29 Oct–4 Nov) — same order of magnitude per func, else report.
- [ ] **Step 3:** Seed step; restart local copy; `select count(*), min(day), max(day) from mp_daily` → from 2026-04-01.
- [ ] **Step 4: Verify:** Functions month view: actual heads Apr–Oct present for every function; Processing Jun South uses attendance.
- [ ] **Step 5:** Commit `feat(wcm): attendance backfill Apr–Oct 2026 from the site attendance workbooks`.

### Task 6: Rulebook scenario that shows its effect

**Files:** Modify `src/server/functions/retail.ts`, `view.ts`, `types.ts`, `src/app/(app)/aop/functions/page.tsx`, `src/components/aop/functions/FunctionChart.tsx`, `scripts/check-functions.mjs`.

**Interfaces:** only orders whose `placement_sla` is not `WITHIN_SLA` move (adherent orders stay put); `scenario.deltaManpower: number | null`, `scenario.deltaFreight: number | null`, `deltaRupees` = their sum only when both exist; page shows both parts ("Staffing ₹X less · Cross-zone freight ₹Y less / not available for Nov 2026"); chart in scenario mode draws "Heads needed for orders" as placed vs on rulebook days.

- [ ] **Step 1: Failing asserts** (pure part): manpower Δ present + freight null → deltaManpower shown, deltaRupees null; an order with placement_sla WITHIN_SLA is not moved.
- [ ] **Step 2–4:** Implement; run; tsc.
- [ ] **Step 5: Verify:** B2B Retail month and day with scenario=1: staffing saving shown in ₹ (Nov included), freight part "—" for Nov; chart lines differ between As is and Rulebook followed.
- [ ] **Step 6:** Commit `feat(functions): rulebook scenario moves only late orders and shows staffing and freight savings apart`.

### Task 7: Audit every view and fix what's wrong

**Files:** as found. Output: `docs/superpowers/plans/2026-11-23-functions-audit.md` (one row per function × site × mode: projected / received / processed / heads / ₹ / ₹ per unit per month Apr–Nov, the tie with Processing and the S&OP workbook actuals, verdict, fix commit or flag for Malhar).

- [ ] **Step 1:** For each of the 7 functions × 3 sites × month mode, and day mode Both: dump the points (local copy); check: processed vs S&OP workbook actual (within 10 %), actual heads/₹ = Processing, ideal vs actual within 3× (else explain), no 0 where a source is missing, grey lines true.
- [ ] **Step 2:** Fix each wrong number at its root (one commit per cause); anything unfixable goes to the "Flag for Malhar" list with the exact source needed.
- [ ] **Step 3:** Commit the audit file with the fixes.

### Task 8: Handover

- [ ] Update `Centralops_HANDOVER.md` §17 (untracked): what changed, verified numbers, flags for Malhar, prod checks.
