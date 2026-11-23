# AOP Functions View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new AOP tab "Functions": for each of six functions (Inwards, B2C Shopify, B2C Marketplace, B2B Retail, B2B Marketplace, Returns), one chart of projected / received / processed volume with ideal vs actual heads and ₹ per unit, a cost gap split into named causes plus "other", a plain summary and the grey areas; plus Processing on the updated IPP master and Budget + Provision on the Overview.

**Architecture:** Pure maths in `src/server/functions/math.ts` (no DB) shared by all six functions; per-function SQL loaders in `src/server/functions/sources.ts` return one common daily shape; `view.ts` turns daily rows into the day (30 days) or month (FY) view. New Snowflake pulls (store orders, rulebook, WAM inward / issues) land in Postgres in the 07:00 job. One client chart component (recharts) draws every function.

**Tech Stack:** Next.js 16 App Router (read `AGENTS.md`), React 19, TypeScript, raw SQL via `q()` (`src/server/db`), recharts 3, Snowflake read-only via `sfQuery` (`src/server/snowflake.ts`).

**Spec:** `docs/superpowers/specs/2026-11-23-aop-functions-view-design.md`

## Global Constraints

- No new dependencies. recharts is already installed.
- Missing is shown as missing (`null` → "—" / named grey area), never ₹0. Ratios are Σ ₹ ÷ Σ units, never an average of ratios.
- Absenteeism allowance = 10 %; attrition is a note only. Box conversion = 30 units per box. SPF pass share = 15 % (`passShare` in `src/server/aop/processingMath.ts`).
- Peak day = the literal maximum projected day of the calendar month; each day in the 30-day view uses its own month's peak.
- Cross-zone (B2B Retail): North WH → South-zone store or South WH → North-zone store. West, East, Central, North East stores are "unmapped zone", neither home nor cross.
- One productivity norm: the active updated IPP set (`activeIpps(day, site)`, `src/server/wcm/daily.ts`), also in Processing.
- No method text or jargon on the page; summaries are plain sentences with numbers.
- Same measure, same value: ideal / actual heads and ₹ for a function and month must equal Processing's for the same stream(s), site and month.
- Snowflake: SELECT only. Local verification against PGlite only, never the `DATABASE_URL` in `.env.local` (production).
- After each task: `npx tsc --noEmit -p tsconfig.json` errors under `src/` only count (a stale `.next/dev/types/validator.ts` can break tsc — delete `.next` if it does), `node --experimental-strip-types scripts/check-wcm.mjs`, `scripts/check-processing.mjs`, and from Task 1 `scripts/check-functions.mjs`.

## Review Focus

1. A function with no projection for the month (B2B Marketplace / Returns monthly only, or a month not loaded) → projected and ideal show "—" plus a grey-area line; the page must not crash or show 0 heads. Test in Task 1 (`idealHeads(null, …)`), Task 4 (view with no projection).
2. A day with almost no volume (e.g. 9 Nov B2B Retail, 15 units) → ₹ per unit for that day is "—", not ₹21,000. Test in Task 1 (`perUnit` threshold).
3. WAM tables missing in Snowflake (n8n not run yet) → inward pull skips with a logged note and Inwards falls back to PO receipts and units ÷ 30; no 500. Test in Task 3 (pull catches `does not exist`).
4. Gap causes don't explain everything → "other" absorbs the remainder and Σ causes + other = actual − ideal exactly. Test in Task 1.
5. A store missing from the rulebook or with no zone → counted as "no rulebook" / "unmapped zone", never as cross-zone. Test in Task 1 (`zoneClass`).

---

### Task 1: Shared maths

**Files:**
- Create: `src/server/functions/math.ts`, `src/server/functions/types.ts`
- Create: `scripts/check-functions.mjs`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type FnKey = "inwards" | "b2c_shopify" | "b2c_marketplace" | "b2b_retail" | "b2b_marketplace" | "returns";
  export type FnSite = "South" | "North" | "Both";
  export type FnMode = "day" | "month";
  export interface DayRow { day: string; site: "South" | "North"; projected: number | null; received: number | null; processed: number | null;
    issues: number | null; presentHeads: number | null; overlay: number | null } // overlay: SLA % or merchandising SLA %, function-specific
  export type Cause = "volume" | "erratic" | "held_up" | "below_ipp" | "absenteeism" | "cross_zone" | "courier_rate" | "other";
  export interface GapPart { cause: Cause; rupees: number | null; note: string }
  export interface Point { key: string; projected: number | null; received: number | null; processed: number | null; issues: number | null;
    idealHeads: number | null; actualHeads: number | null; idealCost: number | null; actualCost: number | null;
    costPerUnit: number | null; idealCostPerUnit: number | null; overlay: number | null }
  export interface FunctionView { fn: FnKey; site: FnSite; mode: FnMode; points: Point[]; manpowerGap: GapPart[]; logisticsGap: GapPart[] | null;
    summary: string[]; grey: string[]; scenario: { label: string; points: Point[]; deltaRupees: number | null; deltaPerUnit: number | null } | null }
  ```
- Produces (math.ts):
  - `unitsPerHead(stages: { ipp: number | null; unit: string; pass?: number }[]): number | null` — 1 ÷ Σ (pass ÷ (ipp × (unit === "box" ? 30 : 1))); stages with null IPP skipped; null when none.
  - `idealHeads(peak: number | null, uph: number | null): { floor: number; roll: number } | null` — floor = ⌈peak ÷ uph⌉, roll = ⌈peak ÷ uph × 1.10⌉.
  - `monthStats(values: (number | null)[]): { peak: number; avg: number; days: number } | null` — over non-null values.
  - `manpowerGap(i: { salary: number; workDays: number; uph: number; proj: { peak: number; avg: number }; act: { peak: number; avg: number }; processed: number; heldUpUnits: number | null; actualHeadDays: number; idealFloor: number }): GapPart[]`
  - `perUnit(rupees: number | null, units: number | null, medianUnits: number): number | null` — null when units < 0.1 × medianUnits or units falsy.
  - `zoneClass(site: "South" | "North", zone: string | null): "home" | "cross" | "unmapped"`.

**Gap formula (the one algorithm the signatures don't fix).** r = salary ÷ 23 (₹ per present head-day, Processing's basis). W = workDays in the window. All parts in head-days × r:
```
volume     = (act.avg − proj.avg) ÷ uph × W
erratic    = ((act.peak − act.avg) − (proj.peak − proj.avg)) ÷ uph × W
held_up    = heldUpUnits ÷ uph                         (rupees null when heldUpUnits is null)
below_ipp  = actualHeadDays − processed ÷ uph − (held_up head-days ?? 0)
absenteeism = rupees null, note "not measured — 10 % allowance assumed"
other      = (actualHeadDays − idealFloor × W) − Σ(non-null parts above)   → always present
```

- [ ] **Step 1: Write `scripts/check-functions.mjs`** (assert-based, same style as `check-processing.mjs`, importing `../src/server/functions/math.ts`):
  - `unitsPerHead([{ ipp: 1000, unit: "unit" }, { ipp: 1600, unit: "unit" }, { ipp: 100, unit: "box" }])` ≈ 1 ÷ (1/1000 + 1/1600 + 1/3000) = 512.82 (±0.01).
  - `unitsPerHead([{ ipp: 80, unit: "unit", pass: 0.15 }])` = 533.33 (±0.01); `unitsPerHead([{ ipp: null, unit: "unit" }])` === null.
  - `idealHeads(10000, 512.82)` → `{ floor: 20, roll: 22 }`; `idealHeads(null, 500)` === null.
  - `manpowerGap` with salary 21983, workDays 23, uph 500, proj {peak 12000, avg 9000}, act {peak 15000, avg 10000}, processed 200000, heldUpUnits 5000, actualHeadDays 600, idealFloor 24: volume = 1000/500×23 = 46 head-days → ₹43,966; erratic = (5000−3000)/500×23 = 92 → ₹87,932; held_up = 10 → ₹9,558; below_ipp = 600−400−10 = 190 → ₹181,599; Σ all parts incl. other = (600 − 24×23) × 21983/23 = 48 × 955.78 = ₹45,877 (±1).
  - same with heldUpUnits null → held_up.rupees === null and the sum identity still holds.
  - `perUnit(100000, 15, 18000)` === null; `perUnit(100000, 20000, 18000)` === 5.
  - `zoneClass("North","NORTH")` "home", `("North","SOUTH")` "cross", `("South","WEST")` "unmapped", `("South", null)` "unmapped".
- [ ] **Step 2: Run** `node --experimental-strip-types scripts/check-functions.mjs` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `math.ts` as above (pure, no imports from server code).
- [ ] **Step 4: Run** the check — expected `functions math OK`.
- [ ] **Step 5: Commit** `feat(functions): shared maths — units per head, ideal heads, gap split, zone class`.

### Task 2: Processing on the updated IPP master

**Files:**
- Modify: `src/server/aop/processing.ts` (`norms()` and `processingMonth`)
- Modify: `scripts/check-processing.mjs`

**Interfaces:**
- Consumes: `activeIpps(day, site)` → `IppRow[]` (`stream, stage, unit, ipp`), Task 1 nothing.
- Produces: `processingMonth(period, wh)` unchanged signature; each `ProcRow.targetPerDay` now = the updated IPP for (site, stream, stage) when matched, in units (box stages × 30), else the sheet norm. Export `matchIpp(stream: string, process: string, ipps: { stream: string; stage: string; unit: string; ipp: number | null }[]): number | null` from `src/server/aop/processingMath.ts`.

- [ ] **Step 1: Add to `check-processing.mjs`:** `matchIpp("B2C Shopify", "Picker", [{stream:"B2C Shopify",stage:"Picker",unit:"unit",ipp:750}])` === 750; `matchIpp("B2C Returns Shopify", "Processing", [{stream:"B2C Returns Shopify",stage:"Processing & QC",unit:"unit",ipp:250}])` === 250 (a process named "Processing" matches a stage starting "Processing"); `matchIpp("Inward","Unloader",[{stream:"Inward",stage:"Unloader",unit:"box",ipp:200}])` === 6000; no match → null.
- [ ] **Step 2: Run** check-processing — FAIL.
- [ ] **Step 3: Implement** `matchIpp` (exact stage match first, then stage starting with the process name; box × 30; null IPP → null) and use it in `processingMonth`: load `activeIpps` for the month's last day (or today for the running month) for the site once, and override `n.target_per_day` with the match when non-null.
- [ ] **Step 4: Run** check-processing and tsc — PASS. On local PGlite open `/aop/processing?month=2026-11-01&wh=South`: B2C Shopify Picker shows IPP 750 (was 800).
- [ ] **Step 5: Commit** `feat(processing): size heads from the updated IPP master (one norm with Functions)`.

### Task 3: New feeds — store orders, rulebook, zones, WAM inward

**Files:**
- Create: `src/server/db/migrations/090_functions.ts`; register in `src/server/db/migrations/index.ts` (version 90, name `functions`)
- Create: `src/server/functions/feed.ts`
- Create: `src/db/seed/zone-city.json` + seed step in `src/server/seed/index.ts` (key `seed.fn_zone_city` = `v1`)
- Modify: `src/instrumentation-node.ts` (07:00 tick, after `pullInventory`, own try/catch each)

**Interfaces:**
- Produces tables:
  - `fn_retail_order(order_name text pk, order_date date, site text, store text, city text, quantity numeric, packages numeric, order_type text, placement_sla text, fetched_at)`
  - `fn_rulebook(store text pk, site text, fresh_handover_day text, rpl_handover_day text, upload_date date)`
  - `fn_zone_city(city text pk, zone text)` — zone upper-case (NORTH, SOUTH, EAST, WEST, CENTRAL, NORTH EAST)
  - `fn_inward_daily(day date, site text, received numeric, boxes numeric, issues int, sku_lines int, source text, primary key (day, site))`
- Produces functions: `pullRetailOrders(from = "2026-04-01")`, `pullRulebook()`, `pullWam(from = "2026-04-01")` → `{ read: number; note: string }`.

- [ ] **Step 1: Migration 090** with the four tables (`create table if not exists`).
- [ ] **Step 2: `zone-city.json`** = `[{ "city": "Guwahati", "zone": "NORTH EAST" }, …]` from the Google Sheet "Distribution 2.0 Rule Book" (id `1pEl5C_xJCS-w2QDtNk5JT5Pmog6T7raMGWf-5Z_mvAo`), tab "Zone Classification North", columns CITY → Primary Zone (46 rows). Seed replaces the table when the key differs.
- [ ] **Step 3: `pullRetailOrders`:** `SNITCH_DB.MAPLEMONK.DISTRIBUTION_ANALYTICS` where ORDER_DATE ≥ from: ORDER_NAME, ORDER_DATE, site = `SAPL-NORTH-TAURU` → North else South, STORE, RECEIVER_CITY, QUANTITY, PACKAGE_COUNT, ORDER_TYPE, ORDER_PLACEMENT_SLA; upsert by order_name.
- [ ] **Step 4: `pullRulebook`:** `DISTRIBUTION_RULEBOOK` rows of the latest UPLOAD_DATE: STORE_NAME, WH (`North*` → North else South), FRESH_HANDOVER_DAY, RPL_HANDOVER_DAY; replace table.
- [ ] **Step 5: `pullWam`:** from `SNITCH_DB.MAPLEMONK.WAM_ASN_INWARD` (day = GATE_ENTRY_TIME::date, site from WAREHOUSE `NORTH_WH`/`SOUTH_WH`, received = Σ FI_QTY, boxes = Σ over distinct ASN_NUMBER of MAX(ACTUAL_BOXES_RECEIVED)) full-joined with `WAM_ISSUES_DAILY` (ISSUE_COUNT, SKU_LINES by ISSUE_DATE, WAREHOUSE); source `wam`. If Snowflake errors with "does not exist" / "not authorized", return `{ read: 0, note: "WAM tables not in Snowflake yet — Inwards uses PO receipts" }` without throwing.
- [ ] **Step 6: Wire** the three pulls into the 07:00 tick and into the planner's Refresh button (`src/server/wcm/dailyActions.ts`, same `Promise.all`).
- [ ] **Step 7: Verify:** restart dev (seeds run at boot), press Refresh stage output; `select count(*), min(order_date), max(order_date) from fn_retail_order` → rows from April; `fn_rulebook` ≈ 140–150 stores; `fn_zone_city` 46 rows; `fn_inward_daily` either WAM rows or the logged note. tsc + checks pass.
- [ ] **Step 8: Commit** `feat(functions): store orders, rulebook, zone seed and WAM inward feeds`.

### Task 4: Per-function daily sources and the view

**Files:**
- Create: `src/server/functions/sources.ts`, `src/server/functions/view.ts`

**Interfaces:**
- Consumes: Task 1 types and maths; Task 3 tables; `processingMonth` (salary, present heads per stream) from Task 2.
- Produces:
  - `dailyRows(fn: FnKey, from: string, to: string): Promise<DayRow[]>` (sources.ts)
  - `functionView(fn: FnKey, site: FnSite, mode: FnMode): Promise<FunctionView>` (view.ts) — day mode = last 30 days to yesterday (IST); month mode = FY months to date.

**Sources per function (sources.ts):**

| fn | projected | received | processed | issues | presentHeads (dept, split as Processing) | overlay |
|---|---|---|---|---|---|---|
| inwards | `sop_plan_daily` `category_inward` | `fn_inward_daily.received`, else `wcm_stage_output` Inward `received` | stage `Inward` `putaway` | `fn_inward_daily.issues` | Inward | — |
| b2c_shopify | `sop_plan_daily` `b2c` rows `ilike 'shopify%'` | `wcm_sla_cell` units by created day, stream B2C Shopify | stage `B2C Shopify` `dispatched` | — | B2C Forward × Shopify share | on-time % by deadline day: (within + fut_done) ÷ (within + fut_done + breached + pend_breach) |
| b2c_marketplace | `b2c` rows not Shopify | sla cell, B2C Marketplace | `B2C Marketplace` dispatched | — | B2C Forward × MP share | same |
| b2b_retail | `sop_plan_daily` `retail_fwd` | `fn_retail_order.quantity` by order_date | `B2B Retail` dispatched | — | B2B Forward × Retail share | % of order units with placement_sla = WITHIN_SLA |
| b2b_marketplace | monthly `sop_review_rows` `b2b_mp` plan ÷ days in month | sla cell B2B Marketplace units by deadline day | `B2B Marketplace` dispatched | — | B2B Forward × MP share | — |
| returns | monthly `returns` plan ÷ days | stage `received` (both B2C return streams) + B2B returns putaway | putaway of all returns streams | — | B2C Return + B2B Return | — |

Present heads per day = `mp_daily` heads for the department(s) (via `mp_site_map` / `mp_func_map`, as `attendance()` in processing.ts) × the stream share `ruleSplit` gives that month. Site mapping: sla cell WH1/WH2 → South, NORTH → North.

**view.ts:** for each month in the window, `uph` = `unitsPerHead` of the function's stages from `activeIpps`; ideal from that month's projected peak; actual cost per day = presentHeads × salary ÷ 23; ideal cost per day = ideal.roll × salary ÷ days in month; ₹ per unit via `perUnit` (median over the window). Month mode aggregates days. `manpowerGap` per window. Logistics gap: B2C Shopify — courier ₹ (as `dayCost` lg:b2c) vs baseline CPS (`monthHistory` JAS) × shipments → `courier_rate` + `other`; B2B Retail — `cross_zone` from Task 5; others null. `grey` lists every null source used (copy from the spec's Grey areas, only those that apply). `summary` = up to 4 sentences, e.g. inwards: "South handles about {avg processed}/day; received {Σ received}, put away {Σ processed}, {Σ issues} issues. Without the issues putaway would be {processed + heldUp}." held-up units per day = max(0, received − processed) on days with issues > 0, else 0 (inwards only; others null).

- [ ] **Step 1: Add to `check-functions.mjs`** a pure test of the aggregation helper `toMonthPoints(rows: DayRow[], uphByMonth: Record<string, number>, salary: number): Point[]` (export it from view.ts's pure part `src/server/functions/aggregate.ts`): two days in one month, projected [100, 300], processed [200, 200], presentHeads [2, 2], uph 100, salary 23000 → one point: projected 400, idealHeads 3 (⌈300/100⌉), actualCost 2×2×1000 = 4000, costPerUnit 10.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `aggregate.ts`, `sources.ts`, `view.ts`. **Step 4: Run** check-functions + tsc — PASS.
- [ ] **Step 5: Verify** on local PGlite with a node script calling `functionView("b2b_retail","Both","month")` is not possible outside Next (server-only); instead open the page in Task 6. Tie check now: for Oct 2026 South, `functionView("b2b_retail","South","month")` actual heads equal Processing's B2B Retail stream current heads (log both from a temporary route or the page in Task 6).
- [ ] **Step 6: Commit** `feat(functions): per-function daily sources and day / month view`.

### Task 5: B2B Retail scenario and cross-zone

**Files:**
- Create: `src/server/functions/retail.ts`
- Modify: `src/server/functions/view.ts` (attach scenario + logistics gap for b2b_retail)

**Interfaces:**
- Consumes: `fn_retail_order`, `fn_rulebook`, `fn_zone_city`, `lg_b2b_lr` (freight, qty, site, store, month), Task 1 `zoneClass`.
- Produces: `rulebookScenario(site: FnSite, from: string, to: string): Promise<{ days: DayRow[]; units: number }>` — each order's units moved to its store's rulebook handover weekday (FRESH for order_type FRESH, else RPL) in the same ISO week; stores not in the rulebook stay on their day. `crossZone(site: FnSite, months: string[]): Promise<{ crossUnits: number; unmappedUnits: number; rupees: number | null }>` — lane ₹/unit = Σ freight ÷ Σ qty per (month, site, zone) from `lg_b2b_lr` joined to store zone (store city → `fn_zone_city`); rupees = Σ cross units × (actual lane ₹/unit − home lane ₹/unit), home lane = same zone from the home site; null when the month has no LR file.

- [ ] **Step 1: Add pure test** to check-functions for `retimeToWeekday(orderDate: string, weekday: string): string` (export from `src/server/functions/aggregate.ts`): `retimeToWeekday("2026-11-04","Monday")` === "2026-11-02"; `("2026-11-04","Saturday")` === "2026-11-07"; unknown weekday → orderDate.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `retimeToWeekday`, `retail.ts`, scenario wiring: scenario points = view recomputed on scenario days (same heads, new peak → new ideal); `deltaRupees` = ideal cost(as is) − ideal cost(scenario) + cross-zone ₹; `deltaPerUnit` = that ÷ processed units. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(functions): B2B Retail rulebook scenario and cross-zone freight`.

### Task 6: Functions page, chart, nav

**Files:**
- Create: `src/app/(app)/aop/functions/page.tsx`, `src/components/aop/functions/FunctionChart.tsx` ("use client")
- Modify: `src/components/aop/AopNav.tsx` (add `"functions"` to `AopTab`; first tab of the "Cost detail" group, label "Functions", path `/aop/functions`)

**Interfaces:**
- Consumes: `functionView(fn, site, mode)`.
- Produces: page with search params `fn` (default `b2b_retail`), `site` (default Both), `mode` (default `day`), `scenario=1` (b2b_retail only).

Layout (top to bottom): function picker (segmented, six), site segment, mode segment (Last 30 days | Month on month); chart; scenario toggle (B2B Retail only: As is | Rulebook followed, showing Δ ₹ and Δ ₹/unit); summary (plain sentences); gap table (cause, ₹, one-line note; "other" last; manpower then logistics); grey areas (bulleted, muted). Chart = recharts `ComposedChart`: left axis units — `projected` line (dashed), `received` bars (light), `processed` line, `issues` small bars on a hidden right-left axis; right axis ₹/unit — `costPerUnit` line, `idealCostPerUnit` dashed; heads in the tooltip; overlay % as a thin line on a third 0–100 % axis when present. Null points render as gaps, not zero.

- [ ] **Step 1: Implement** the page and chart. **Step 2: Verify** locally (PGlite, `PG_POOL_MAX=1`, `AUTH_MODE=dev`): each of the six functions renders in both modes and both sites without a 500; B2B Retail Oct month point actual heads = Processing B2B Retail current heads (same site, month); 9 Nov B2B Retail ₹/unit shows "—"; B2B Marketplace shows the "monthly projection spread evenly" grey line. **Step 3:** tsc + all three checks. **Step 4: Commit** `feat(aop): Functions tab — one chart, gap split and summary per function`.

### Task 7: Overview — Budget and Provision side by side

**Files:**
- Modify: `src/components/aop/MonthSummary.tsx` ("Where the money went" rows, ~lines 119–167)

**Interfaces:** none new; uses `Agg.forecast` / `hasForecast` already computed.

- [ ] **Step 1:** Each function row's sub-line reads `of ₹{budget} {L.plan} · ₹{provision} {L.forecast}` (missing → "no {label} set"), and the bar gets a second, lighter tick at the provision. The total headline adds "· {pct} of {L.forecast}" when both exist.
- [ ] **Step 2: Verify** `/aop` Oct: Warehousing & Fulfilment shows both figures; a function with no provision shows "no provision set". tsc passes.
- [ ] **Step 3: Commit** `feat(aop): overview shows actual against budget and provision`.

### Task 8: Handover

- [ ] Append section 17 to `Centralops_HANDOVER.md` (untracked file): what Functions shows, sources per function, the n8n WAM workflow (`docs/n8n/`), migration 090, the seed key, and open grey areas. No commit (file is untracked by choice).
