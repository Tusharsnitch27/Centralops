# Functions SLA and cost-reduction pointers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under each function's chart, show SLA performance, actual cost, what a team at the projected average day would cost and the SLA it would miss when volume runs above, and how heads fall as the TAT lengthens; add an SLA column to the overview; count Inwards pre-packs as pieces; show pre-pack ROI.

**Architecture:** Pure maths in a new `src/server/functions/slaMath.ts` (checked by `scripts/check-functions.mjs`); one new Snowflake pull writing `fn_sla_daily` for the functions whose SLA is not already in `wcm_sla_cell`; `functionView` gains a `pointers` field rendered under the chart; `functionsOverview` gains an SLA % per row.

**Tech Stack:** Next.js 16 App Router, TypeScript, raw SQL via `pg`, Snowflake (`sfQuery`), recharts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-functions-sla-cost-pointers-design.md`

## Global Constraints

- Do not change the ideal heads calculation (`planDay`, `idealBySiteMonth`, `windowGap`), gap causes or any existing reconciliation.
- Missing is null, never 0 (house rule across feeds and maths).
- SLA: Inwards ≤ 24 h gate entry → last putaway; B2C Shopify / Marketplace = warehouse_sla_performance TAT (wcm_sla_cell); B2B Retail = HANDOVER_DEADLINE_TS (wcm_sla_cell); B2B Marketplace no TAT, capacity 5,000 items a day; B2C Returns ≤ 48 h RECEIVING_DATE → PROCESSED_DATE; B2B Returns ≤ 2 days consideredDeliveredDate → processingEndDate from the Retail Return Tool's `shipment_tracker` (env `RETAIL_RETURN_DATABASE_URL`, read-only); unset → null with a grey note.
- Projection-sized team = month's average projected day ÷ units per head, constant through the month; ₹ at the same rate per head-day the page already uses (`n.salary` ÷ 23).
- Pre-pack pieces = quantity × N for SKUs `PP<N>-…` (S&OP `mult` in `src/server/sop/sync.ts:79`).
- Copy is plain sentences with numbers, like the existing `summary` lines; every saving line is followed by its SLA-risk line.

## Review Focus

- A month with no projection or no units-per-head norm: pointer lines for it are omitted and a grey note says why, never ₹0 or 0 heads.
- Window spanning two months with different projections: the team and capacity change at the month boundary; backlog carries across it.
- Site = Both: SLA % weights by judged units (Σ within ÷ Σ judged), the team is South + North, backlog is simulated per site then summed.
- Days with no processed/received volume (feed gap): skipped in the simulation, not treated as zero-volume days that drain backlog.
- B2B Marketplace: capacity 5,000 items/day per site replaces the projection-sized team; no TAT table.

---

### Task 1: SLA maths

**Files:**
- Create: `src/server/functions/slaMath.ts`
- Test: `scripts/check-functions.mjs` (append a block printing `functions SLA maths OK`)

**Interfaces:**
- Produces:
  - `projectionTeam(avgProjectedDay: number | null, uph: number | null): number | null` — heads on the floor.
  - `simulateBacklog(days: { day: string; volume: number | null; capacity: number | null }[], tatDays: number): { exceedDays: number; breachUnits: number; total: number }` — FIFO: each day clears up to capacity, oldest first; units still open more than `tatDays` days after arrival count once as breaches; null-volume or null-capacity days are skipped (no arrival, no clearing).
  - `tatHeads(volumes: (number | null)[], tatDays: number, uph: number | null): number | null` — max over the window of mean volume over any `tatDays + 1` consecutive known days ÷ uph (tatDays 0 = peak day).
  - `slaShare(rows: { within: number | null; judged: number | null }[]): { pct: number | null; judged: number | null }` — Σ within ÷ Σ judged over rows where both known.

- [ ] **Step 1: Write the failing checks**

```js
import { projectionTeam, simulateBacklog, tatHeads, slaShare } from "../src/server/functions/slaMath.ts";
assert.equal(projectionTeam(1000, 250), 4);
assert.equal(projectionTeam(null, 250), null); assert.equal(projectionTeam(1000, 0), null);
const d = (v, c = 100) => ({ day: "x", volume: v, capacity: c });
assert.deepEqual(simulateBacklog([d(100), d(100)], 1), { exceedDays: 0, breachUnits: 0, total: 200 });
assert.deepEqual(simulateBacklog([d(150), d(50)], 1), { exceedDays: 1, breachUnits: 0, total: 200 });   // 50 carried one day: within 24 h
assert.deepEqual(simulateBacklog([d(200), d(100), d(100)], 1), { exceedDays: 1, breachUnits: 100, total: 400 }); // 100 of day 1 still open after day 2
assert.deepEqual(simulateBacklog([d(150), d(null), d(50)], 1).total, 200);                                   // gap day skipped
assert.equal(tatHeads([100, 300, 100], 0, 100), 3);   // same day: the peak
assert.equal(tatHeads([100, 300, 100], 1, 100), 2);   // 24 h: best 2-day mean = 200
assert.equal(tatHeads([100, 300, 100], 2, 100), 5 / 3);
assert.deepEqual(slaShare([{ within: 80, judged: 100 }, { within: null, judged: 50 }, { within: 10, judged: 100 }]), { pct: 45, judged: 200 });
console.log("functions SLA maths OK");
```

- [ ] **Step 2: Run** `node scripts/check-functions.mjs` — Expected: fails on the missing module.
- [ ] **Step 3: Implement the four functions in `slaMath.ts`** (pure, no server imports; `.ts` import extensions as `aggregate.ts` uses).
- [ ] **Step 4: Run** `node scripts/check-functions.mjs` — Expected: all blocks OK including `functions SLA maths OK`.
- [ ] **Step 5: Commit** `feat(functions): SLA maths — projection team, backlog breaches, heads by TAT`

### Task 2: Pre-packs counted as pieces

**Files:**
- Modify: `src/server/wcm/feed.ts` (putaway `SUM(putaway_completed_quantity)` rows, ~line 65)
- Modify: `src/server/functions/feed.ts` (`WAM_SQL` received, `SPINE_ORDERS_SQL` / `ORDERS_SQL` quantity) — only where the source counts packs
- Test: Snowflake spot check (no unit test: SQL only)

- [ ] **Step 1: Establish which sources count packs.** Run read-only Snowflake queries (a throwaway `scripts/_sf.mjs`, deleted after) comparing, for Oct 2026: putaway `SUM(qty)` vs `SUM(qty × mult)` for `"Item Type skuCode" LIKE 'PP%'`; WAM `FI_QTY` vs `SOLID_QTY + NUM_PREPACKS × size` on pre-pack ASNs; spine `QUANTITY` vs UC items pieces for orders containing PP SKUs. Record the answer in each SQL's doc comment.
- [ ] **Step 2: Apply the multiplier** in each pack-counting SUM: `putaway_completed_quantity * CASE WHEN "Item Type skuCode" LIKE 'PP%' THEN COALESCE(TRY_TO_NUMBER(REGEXP_SUBSTR("Item Type skuCode", '^PP([0-9]+)', 1, 1, 'e', 1)), 1) ELSE 1 END`. Leave `putaway_lines` (COUNT DISTINCT) unchanged.
- [ ] **Step 3: Verify** Oct 2026 Inward putaway via the edited SQL equals S&OP category inward for Oct (same filters) within 1 %.
- [ ] **Step 4: Run** `npx tsc --noEmit` and `node scripts/check-functions.mjs` — Expected: clean / OK.
- [ ] **Step 5: Commit** `fix(functions): inward and putaway count pre-packs as pieces, as S&OP`

### Task 3: SLA feed for Inwards and returns

**Files:**
- Create: `src/server/db/migrations/0NN_fn_sla_daily.ts` (next free number; register in `migrations/index.ts`)
- Modify: `src/server/functions/feed.ts` (add `pullSla`), `src/server/wcm/dailyActions.ts:83` (add to the `Promise.allSettled` list), `src/server/functions/sources.ts` (add `slaDaily`)

**Interfaces:**
- Table `fn_sla_daily (day date, site text, fn text, judged numeric, within numeric, fetched_at timestamptz, primary key (day, site, fn))`; `fn` ∈ `inwards | b2c_returns`; day = the receiving day.
- `pullSla(from = "2026-04-01"): Promise<{ read: number; note: string }>` — replaces rows for days returned.
  - inwards: per ASN, `MIN(GATE_ENTRY_TIME)` → `MAX(LAST_PUV_AT)`, units FI_QTY; within = ≤ 1440 min; ASNs not yet put away and older than 24 h are judged and not within; younger open ASNs not judged.
  - b2c_returns: RETURN_2_INWARDING_DATA per AWB, `RECEIVING_DATE` → `PROCESSED_DATE`, ≤ 2880 min; site from TYPE as `PG_EV`.
- `slaDaily(fn: FnKey, sites: Wh[], from: string, to: string): Promise<{ day: string; site: Wh; within: number | null; judged: number | null }[]>` — `fn_sla_daily` for inwards / b2c_returns; b2b_returns from the Retail Return Tool's `shipment_tracker` (facility NORTH/SOUTH → site; day = consideredDeliveredDate; judged = dcQuantity of shipments processed or open > 2 days; within = processed ≤ 2 days) when `RETAIL_RETURN_DATABASE_URL` is set, else `[]`; `wcm_sla_cell` by deadline (`within + fut_done` ÷ `within + fut_done + breached + pend_breach`) for b2c_shopify, b2c_marketplace, b2b_retail (stream = `FN[fn].label`; confirm the B2B Retail stream name in `wcm_sla_cell`); `[]` for b2b_marketplace.

- [ ] **Step 1: Check timestamps are IST wall clock** for each source (one query each); note it in `pullSla`'s doc comment.
- [ ] **Step 2: Write migration and `pullSla`; wire into dailyActions.**
- [ ] **Step 3: Run `pullSla` once locally** against Snowflake (local PG: `npm run db:local`) and print per month × site × fn the SLA %. Expected: Inwards Sep–Nov ≈ 76–86 % (scoping figures), non-null for every month with data.
- [ ] **Step 4: Run** `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit** `feat(functions): SLA feed — inward ≤ 24 h, returns ≤ 48 h`

### Task 4: Pointers under each function's chart

**Files:**
- Modify: `src/server/functions/types.ts` (`FunctionView.pointers`), `src/server/functions/view.ts` (compute), `src/app/(app)/functions/[fn]/page.tsx` (render below the chart card's summary)

**Interfaces:**
- Consumes: Task 1 functions; Task 3 `slaDaily`; existing `rows` (DayRow), `n.uph`, `n.salary`, `points`.
- Produces: `pointers: { sla: { pct: number | null; tat: string | null; missed: number | null }; actual: { perUnit: number | null; heads: number | null };
  team: { heads: number | null; rupees: number | null; perUnit: number | null; saving: number | null } | null;
  above: { exceedDays: number; breachUnits: number; pct: number | null } | null;
  byTat: { tat: string; heads: number | null; rupees: number | null; current: boolean }[] }`
- TAT days per function: inwards 1, b2c_shopify / b2c_marketplace 1 (the TAT column's modal value — read it, don't assume), b2b_retail 1, b2c_returns 2, b2b_returns 2, b2b_marketplace none (byTat empty; capacity 5,000 per site per day replaces team capacity).
- Volume for the simulation = received per day (orders created / received); capacity = team × uph.

- [ ] **Step 1: Add a check** in `check-functions.mjs` for a small helper exported from `view.ts`'s pure part (move to `slaMath.ts` if it needs no server imports): `teamRupees(heads 4, days 30, salary 23000)` = 4 × 30 × 23000 ÷ 23 = 120000.
- [ ] **Step 2: Compute `pointers`** per site then combine for Both (sums; SLA by Σ judged).
- [ ] **Step 3: Render** a "Where cost can come down" block: SLA line → actual line → team line (saving) → above-projection line (risk) → TAT table (heads, ₹; current marked). B2B Returns with no tool connection: SLA line "—" and a grey note naming `RETAIL_RETURN_DATABASE_URL`.
- [ ] **Step 4: Verify in the browser** (`npm run dev` + local PG) on all 7 functions × day / month × South / North / Both: block renders, no NaN / ₹0, Both = South + North for team heads and ₹.
- [ ] **Step 5: Commit** `feat(functions): SLA and cost-reduction pointers under each function's chart`

### Task 5: Overview SLA column

**Files:**
- Modify: `src/server/functions/overview.ts` (`Agg.sla: number | null`), `src/app/(app)/functions/page.tsx` (column "SLA" after Coverage; "—" for b2b_marketplace, support, total)

- [ ] **Step 1: Fill `Agg.sla`** from `slaDaily` over the window's days (Σ within ÷ Σ judged).
- [ ] **Step 2: Render** the column; table still fits at 1280 px.
- [ ] **Step 3: Verify** each function's overview SLA equals its function page's SLA line for the same site and view.
- [ ] **Step 4: Commit** `feat(functions): SLA % per function on the overview`

### Task 6: Pre-pack ROI

**Files:**
- Modify: `src/server/functions/feed.ts` (`pullPrepack` → `fn_prepack_monthly (month, site, kind, value)`; migration as Task 3), `src/server/functions/view.ts` (inwards and b2b_retail pointers), page render

**Interfaces:**
- Inwards: median gate → last putaway hours per piece for pre-pack ASNs (NUM_PREPACKS > 0) vs solid, month × site; extra ₹ = Δ hours per piece × pre-pack pieces × ₹ per head-hour (salary ÷ 23 ÷ 8).
- B2B Retail: pre-pack pieces and packs dispatched (UC items, SKU `PP%`); saving = (pieces − packs) × Σ over pick and pack stages of `passShare(stage) ÷ IPP` (from `aop/processingMath`) × ₹ per head-day.
- Pointer line on each page: extra at Inwards, saving at Retail, net (+ = pre-packs pay).

- [ ] **Step 1: Check** the saving formula with one assert in `check-functions.mjs` (pieces 400, packs 100, stage work 1/300 head-day per unit, ₹1,000 per head-day → ₹1,000).
- [ ] **Step 2: Implement pull, migration, pointer lines.**
- [ ] **Step 3: Verify** Oct 2026 South figures by hand against Snowflake.
- [ ] **Step 4: Commit** `feat(functions): pre-pack ROI — inward time against retail pick/pack saving`

### Task 7: Final checks and push

- [ ] **Step 1:** `node scripts/check-functions.mjs`, `node scripts/check-processing.mjs`, `node scripts/check-wcm.mjs` — all OK.
- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx next build` compiles (retry once if only the Next.js security-advisory notice fails it).
- [ ] **Step 3:** Push `master:main`; tell Malhar to run the daily refresh (or redeploy) so `pullSla`, `pullPrepack` and the pre-pack putaway counts load.
