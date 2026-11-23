# AOP Functions — audit of every view (23 Nov 2026)

Scope: 7 functions × Both / South / North month views, plus the Both day view (28 pages), dumped from the local copy at `3ecf9f1`
(before the fixes below). Reference actuals: the S&OP workbook monthly totals (`src/server/functions/workbookHistory.ts`, Apr–Oct,
forward functions and Inwards) and `sop_returns` (B2C / B2B returns). Actual heads and ₹ come from `processingMonth` for the same
streams, site and month, so they tie to AOP › Processing by construction (code reading: `norms()` takes `pm.streams[…].actualMp / actualExp`).

Verdict per row: processed within 10 % of the reference actual where one exists; ideal and actual heads within 3× or explained; no 0
where a source is missing; every grey line true. Numbers in the tables are the pre-fix dump; the notes say what changed.

## Findings

| # | Where | What was wrong | Root cause | Outcome |
|---|---|---|---|---|
| F1 | Inwards, all sites, Apr–Aug | ₹ per unit blank; Processing showed no Inward volume | `sopVolumes` read actuals only from `sop_review_rows`, which hold none before Sep; the Cost Master sheet has no FY26-27 inward rows | Fixed `6e30d1a`: the S&OP workbook's monthly actual is the volume where the review rows have none (Processing, so Functions too) |
| F2 | Inwards, all sites, Apr–Aug | Ideal heads, ideal ₹ and the manpower gap blank | The daily inward plan starts in Sep; Apr–Aug have only the monthly plan | Fixed `aa9c24e`: monthly plan spread evenly over the month's days (as B2B Marketplace and Returns), named in a grey line |
| F3 | Inwards Sep–Nov | Ideal 2–6× actual (Sep Both 265 vs 44) | The projection sheet's Sep week 5 is 29–30 Sep only, so its plan lands on 2 days (79,414 S / 1,02,570 N a day vs ~10–30K on other days); ideal heads staff the month's peak day. North's Inward heads (~19) also clear ~1,380 units a head a day against an IPP of ~894 | Explained; flag 1 |
| F4 | Inwards Oct | Processed (putaway feed) 18 % under the workbook (S −15 %, N −22 %) | From Oct the chart uses the putaway feed; the S&OP inward actual is not putaway throughout (Apr North equals PO received to the unit, 4,26,518) | Flag 2 |
| F5 | B2B Marketplace Jun, Jul, Oct, Nov | Actual heads 3–4× ideal | Processing's rule split gives B2B Marketplace a fixed 23–24 % of the B2B Forward department (N 7 : 23.5, S 8 : 25.5) whatever the volume; the plan in those months is 27.5K–48K a site | Business rule — flag 3 |
| F6 | B2B Marketplace South Oct / Nov | Oct −10.6 % vs workbook (37,630 vs 42,086); Nov 8,741 vs S&OP review 14,102 to date | Since UC items stop (8 Oct) dispatch comes from the SLA tracker in lumps: South 6–30 Oct 285 units, 31 Oct 36,213 | UC items 'ordered' now written to yesterday (`de96b15`), so received stays on UC creation days after 7 Oct. The dispatch lumps are real: UC items shows the same days (South 31 Oct 40,669) |
| F7 | B2B Marketplace received, Aug–Nov | Two bases mixed: UC order-creation days, and the SLA tracker's deadline days from 21 Sep (Oct read 1.2 L received) | `dailyRows` took deadline cells first, creation-day UC items otherwise; an order created before 21 Sep and due after counted twice | Fixed `6512258`: one basis, units ordered by creation day (UC items while they cover the day, then the tracker's created hours) |
| F8 | B2B Returns South Jun | Putaway 1,05,323 vs `sop_returns` 1,39,584 (−24.5 %) | Source difference; no feed day missing in Jun | Flag 5 |
| F9 | B2B Returns North Apr, South Aug | Actual 3× ideal | The plan (50K a site) is below the putaway (80K / 1.16 L); ideal follows the plan. Jul's low 57K is confirmed by `sop_returns` (N 19,836, S 37,373) | Explained |
| F10 | B2C Shopify Nov | Ideal 231 vs actual 74; ideal ₹/unit 37.60 | The daily plan has the Black Friday peak on 26 Nov (28,488 S / 23,309 N); the month is sized on it while the month to date ends 22 Nov | Business rule (peak-day sizing in the running month) — flag 6 |
| F11 | Every Both view | Both's received, projection and issues added the known site when the other was missing (B2B Returns 1 Nov: received 0 against a blank putaway) | `toPoints` summed these across sites with `sumN`; processed already needed every site | Fixed `181d501` (assert in check-functions) |
| F12 | B2C Shopify / Marketplace Apr–Aug | Within SLA blank with no grey line | The SLA tracker's data starts 22 Sep 2026 | Fixed `02bb9d3`: grey line names the start |
| F13 | B2B Retail, all months | "Ordered in rulebook window" 0.2–4.6 % | By the source's definition only cutoff-day orders count; 1–2 days early is EARLY_CREATION (40–60 % of units) | Flag 7 (definition) |
| F14 | B2B Retail and Shopify ₹ per unit | Processing's units (the ₹/unit base) differ from the processed line: May South B2B Retail 2,88,528 vs actual 2,39,884, May South Shopify 1,27,550 vs 1,38,010 (the sheet's final output equals the plan); Oct B2B Retail 5,41,296 S / 4,34,957 N vs workbook 5,06,352 / 4,10,460 | Cost Master sheet final output, source of truth by rule | Flag 8 |
| F15 | Returns Aug | No `sop_returns` row for Aug 2026 | Source gap; Processing falls back to putaway (documented) | Flag 9 |
| a | Month views with April | No mention of April's attendance source step | — | Fixed `b606ddc`: grey line |
| b | Month views | A line with neither attendance nor sheet heads dropped silently out of the month's ₹ | `rollupStream`'s `sumOrNull` | Fixed `e391906`: grey line names the department and months (no month triggers it on the local copy: every function's department has attendance every month) |
| c | Month views | A month with neither cost nor volume named twice; no norm and no projection both named | — | Fixed `f510f6b` |
| d | workbookHistory.ts | Docblock said "21 Sep start" | — | Fixed `67290ca` |

Side effect of F1, fixed in `fd5e815`: filling the forward actuals made Processing split Apr–Jul B2B returns by the forward Retail : Marketplace
mix (Jun South: 6,438 Marketplace units against 755 put away). The split now follows the month's putaway (North all Retail Apr–Aug; South Jun
1,04,568 / 755), and the forward mix only where the month has no putaway. The B2B Returns function's total, heads and ₹ do not change.

Observation (no change): North B2C Returns costs ₹10.01 a unit against South ₹5.79 — North's B2C Return department has 35–44 heads from
Aug against South's 22–28 at similar putaway. It ties to Processing.

## Flag for Malhar

1. **Inward ideal heads (F3).** The projection sheet's Sep week 5 puts 1,58,828 South / 2,05,140 North units on 29–30 Sep; Oct's last days carry 42,240 / 54,712 a day. Ideal heads staff that peak (Sep 265 vs 44 actual). Needed: confirm that plan, or a plan spread over calendar weeks. Also: North's Inward department (~19 heads) puts away ~1,380 units a head a day against the IPP's ~894 — are unloaders booked under another department?
2. **Which inward actual (F4).** S&OP inward actual vs putaway feed: Oct South 6,89,727 vs 5,85,997, North 6,28,336 vs 4,92,786; Apr North workbook 4,26,518 = PO received to the unit, putaway 3,46,536. Needed: the definition of the S&OP inward actual (GRN or putaway) so the chart uses one basis.
3. **B2B Marketplace heads (F5).** The 22 Nov rule split gives B2B Marketplace 23–24 % of B2B Forward heads every month; in Jun (plan 27.5K a site) that is 22.9 heads against an ideal 6 (₹15.86 vs ₹4.16 per unit). Decide whether the split should follow volume.
4. **B2B Marketplace dispatch after 8 Oct (F6)**, replaced by the fix `de96b15` (received). The lumps are in UC items too, so they are real. UC items' Oct South dispatch adds up to 42,086, the workbook to the unit; the tracker gives 37,630 (31 Oct: 36,213 vs UC 40,669). The next step is to write UC's dispatched for B2B Marketplace past the window too. The controller decides.
5. **B2B Returns Jun South (F8).** Putaway feed 1,05,323 vs `sop_returns` 1,39,584. Needed: which is right.
6. **Black Friday sizing (F10).** Nov Shopify ideal is sized for 26 Nov (51,797 units across sites) while the month runs to 22 Nov — ideal ₹/unit 37.60. Keep peak-day sizing for the running month, or size on the days to date?
7. **Rulebook window (F13).** Only cutoff-day orders count: Oct 21,777 within vs 2,88,992 early vs 4,26,359 breached. Should early orders count as in window?
8. **Cost Master final output (F14).** May South: B2B Retail sheet 2,88,528 vs actual 2,39,884; B2C Shopify 1,27,550 vs 1,38,010 (both equal the plan). Oct B2B Retail sheet 5,41,296 S / 4,34,957 N vs workbook 5,06,352 / 4,10,460. Needed: corrected sheet final outputs.
9. **Returns Aug (F15).** `sop_returns` has no Aug 2026 row (Processing uses putaway). Needed: Aug B2C / B2B returns actuals.

## After fixes (controller re-dump)

Inwards Both, Apr–Aug: ideal heads 49 / 52 / 44 / 38 / 52 against actual 41.8 / 38.6 / 38.5 / 43.9 / 39.1. Ideal ₹, ₹ per unit and the manpower gap are now filled.

## Day view (Both, 24 Oct – 22 Nov)

| Function | Verdict |
|---|---|
| Inwards | ok; 1 Nov and 9 Nov South have no putaway feed and 22 Nov no attendance yet (grey lines true) |
| B2C Shopify | ideal 161 from 1 Nov is F10 (Black Friday peak); otherwise ok |
| B2C Marketplace | ok |
| B2B Retail | received on 1 Nov was one site's alone — F11 fixed |
| B2B Marketplace | dispatch in lumps (F6): ₹ per unit up to ₹1,021 on a 27-unit day; ideal 8 vs actual ~28 (F5) |
| B2C Returns | received on 1 Nov (747) was one site's alone — F11 fixed |
| B2B Returns | received 0 on 1 Nov against a blank putaway — F11 fixed |

## Month views (pre-fix numbers; reference = workbook or sop_returns)

#### b2b_marketplace · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 2,08,000 | 1,46,941 | 1,33,697 | 1,33,697 | 0.0 % | 22 | 22.3 | 3.67 | 3.62 | ok |
| May ’26 | 1,46,602 | 1,76,414 | 1,35,998 | 1,35,998 | 0.0 % | 15 | 20.7 | 3.47 | 2.52 | ok |
| Jun ’26 | 55,000 | 31,523 | 32,944 | 32,944 | 0.0 % | 6 | 22.9 | 15.86 | 4.16 | ideal/actual >3× — F5 flag |
| Jul ’26 | 78,000 | 1,02,523 | 70,818 | 70,818 | 0.0 % | 9 | 26.9 | 8.69 | 2.89 | ok — F5 flag |
| Aug ’26 | 1,69,500 | 2,98,208 | 1,37,382 | 1,37,382 | 0.0 % | 18 | 24.5 | 4.11 | 2.98 | ok — received F7 fixed (6512258) |
| Sep ’26 | 3,42,000 | 4,68,371 | 2,63,749 | 2,63,749 | 0.0 % | 36 | 28.6 | 2.49 | 3.11 | ok — received F7 fixed (6512258) |
| Oct ’26 | 96,000 | 1,20,391 | 47,170 | 51,626 | -8.6 % | 11 | 36.6 | 16.24 | 4.85 | ideal/actual >3× — F5, F6 flag; received F7 fixed (6512258) |
| Nov ’26 | 75,533 | 81,284 | 34,719 | — | — | 11 | 30.4 | 12.75 | 4.79 | ok — F5, F6 flag; received F7 fixed |

#### b2b_marketplace · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,04,000 | 51,637 | 47,146 | 47,146 | 0.0 % | 12 | 9.5 | 4.45 | 5.60 | ok |
| May ’26 | 73,300 | 77,305 | 70,278 | 70,278 | 0.0 % | 8 | 8.7 | 2.74 | 2.51 | ok |
| Jun ’26 | 27,500 | 7,420 | 17,584 | 17,584 | 0.0 % | 3 | 12.7 | 15.96 | 3.77 | ideal/actual >3× — F5 flag |
| Jul ’26 | 39,000 | 38,482 | 32,873 | 32,873 | 0.0 % | 5 | 13.1 | 8.80 | 3.36 | ok — F5 flag |
| Aug ’26 | 84,750 | 1,51,248 | 44,698 | 44,698 | 0.0 % | 10 | 10.5 | 5.18 | 4.94 | ok — received F7 fixed (6512258) |
| Sep ’26 | 1,71,000 | 1,37,135 | 90,869 | 90,869 | 0.0 % | 19 | 12.1 | 2.93 | 4.62 | ok — received F7 fixed (6512258) |
| Oct ’26 | 48,000 | 26,914 | 9,540 | 9,540 | 0.0 % | 6 | 16.9 | 39.18 | 13.88 | ok — F5, F6 flag; received F7 fixed (6512258) |
| Nov ’26 | 37,767 | 38,827 | 25,978 | — | — | 6 | 12.4 | 7.89 | 4.00 | ok — F5, F6 flag; received F7 fixed |

#### b2b_marketplace · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,04,000 | 95,304 | 86,551 | 86,551 | 0.0 % | 10 | 12.7 | 3.24 | 2.54 | ok |
| May ’26 | 73,302 | 99,109 | 65,720 | 65,720 | 0.0 % | 7 | 12.0 | 4.31 | 2.52 | ok |
| Jun ’26 | 27,500 | 24,103 | 15,360 | 15,360 | 0.0 % | 3 | 10.2 | 15.74 | 4.62 | ideal/actual >3× — F5 flag |
| Jul ’26 | 39,000 | 64,041 | 37,945 | 37,945 | 0.0 % | 4 | 13.8 | 8.59 | 2.49 | ideal/actual >3× — F5 flag |
| Aug ’26 | 84,750 | 1,46,960 | 92,684 | 92,684 | 0.0 % | 8 | 14.1 | 3.58 | 2.04 | ok — received F7 fixed (6512258) |
| Sep ’26 | 1,71,000 | 3,31,236 | 1,72,880 | 1,72,880 | 0.0 % | 17 | 16.5 | 2.26 | 2.32 | ok — received F7 fixed (6512258) |
| Oct ’26 | 48,000 | 93,477 | 37,630 | 42,086 | -10.6 % | 5 | 19.7 | 11.04 | 2.81 | Δ>10 %; ideal/actual >3× — F5, F6 flag; received F7 fixed (6512258) |
| Nov ’26 | 37,767 | 42,457 | 8,741 | — | — | 5 | 18.0 | 21.11 | 6.15 | ideal/actual >3× — F5, F6 flag; received F7 fixed |

#### b2b_retail · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 5,91,549 | 5,82,104 | 6,02,654 | 6,02,654 | 0.0 % | 110 | 72.6 | 2.65 | 4.01 | ok — overlay F13 flag |
| May ’26 | 6,05,362 | 4,86,100 | 4,52,829 | 4,52,829 | 0.0 % | 92 | 67.4 | 3.09 | 4.20 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 7,62,681 | 6,84,450 | 6,30,220 | 6,30,220 | 0.0 % | 96 | 75.3 | 2.72 | 3.51 | ok — overlay F13 flag |
| Jul ’26 | 7,58,960 | 5,83,774 | 5,57,519 | 5,57,519 | 0.0 % | 100 | 88.0 | 3.61 | 4.13 | ok — overlay F13 flag |
| Aug ’26 | 7,06,004 | 5,45,121 | 5,57,129 | 5,57,129 | 0.0 % | 94 | 80.0 | 3.30 | 3.88 | ok — overlay F13 flag |
| Sep ’26 | 7,58,015 | 6,69,358 | 6,54,112 | 6,54,112 | 0.0 % | 95 | 93.3 | 3.27 | 3.33 | ok — overlay F13 flag |
| Oct ’26 | 7,85,949 | 8,97,628 | 9,16,824 | 9,16,812 | 0.0 % | 99 | 119.5 | 2.80 | 2.33 | ok — ₹/unit base: sheet 6–7 % above workbook (F14) |
| Nov ’26 | 6,21,085 | 3,56,577 | 3,53,864 | — | — | 99 | 98.9 | 3.92 | 4.09 | ok — overlay F13 flag |

#### b2b_retail · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 2,67,047 | 2,64,492 | 2,73,588 | 2,73,588 | 0.0 % | 44 | 32.0 | 2.57 | 3.54 | ok — overlay F13 flag |
| May ’26 | 2,86,709 | 2,27,673 | 2,12,945 | 2,12,945 | 0.0 % | 44 | 29.3 | 3.03 | 4.56 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 2,94,118 | 3,27,290 | 3,12,545 | 3,12,545 | 0.0 % | 37 | 42.7 | 3.01 | 2.61 | ok — overlay F13 flag |
| Jul ’26 | 3,14,281 | 2,66,376 | 2,54,452 | 2,54,452 | 0.0 % | 39 | 44.0 | 3.82 | 3.38 | ok — overlay F13 flag |
| Aug ’26 | 3,22,049 | 2,14,524 | 2,21,823 | 2,21,823 | 0.0 % | 39 | 35.2 | 3.50 | 3.88 | ok — overlay F13 flag |
| Sep ’26 | 3,57,847 | 2,83,294 | 2,88,084 | 2,88,084 | 0.0 % | 42 | 40.5 | 3.11 | 3.22 | ok — overlay F13 flag |
| Oct ’26 | 3,72,483 | 4,06,055 | 4,10,480 | 4,10,460 | 0.0 % | 44 | 56.8 | 2.88 | 2.23 | ok — ₹/unit base: sheet 6–7 % above workbook (F14) |
| Nov ’26 | 3,15,914 | 1,64,998 | 1,61,008 | — | — | 48 | 41.6 | 3.53 | 4.27 | ok — overlay F13 flag |

#### b2b_retail · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 3,24,502 | 3,17,612 | 3,29,066 | 3,29,066 | 0.0 % | 66 | 40.6 | 2.71 | 4.41 | ok — overlay F13 flag |
| May ’26 | 3,18,654 | 2,58,427 | 2,39,884 | 2,39,884 | 0.0 % | 48 | 38.2 | 3.13 | 3.93 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 4,68,563 | 3,57,160 | 3,17,675 | 3,17,675 | 0.0 % | 59 | 32.6 | 2.43 | 4.39 | ok — overlay F13 flag |
| Jul ’26 | 4,44,679 | 3,17,398 | 3,03,067 | 3,03,067 | 0.0 % | 61 | 43.9 | 3.43 | 4.76 | ok — overlay F13 flag |
| Aug ’26 | 3,83,955 | 3,30,597 | 3,35,306 | 3,35,306 | 0.0 % | 55 | 44.8 | 3.16 | 3.88 | ok — overlay F13 flag |
| Sep ’26 | 4,00,168 | 3,86,064 | 3,66,028 | 3,66,028 | 0.0 % | 53 | 52.7 | 3.41 | 3.42 | ok — overlay F13 flag |
| Oct ’26 | 4,13,466 | 4,91,573 | 5,06,344 | 5,06,352 | -0.0 % | 55 | 62.7 | 2.74 | 2.40 | ok — ₹/unit base: sheet 6–7 % above workbook (F14) |
| Nov ’26 | 3,05,171 | 1,91,579 | 1,92,856 | — | — | 51 | 57.3 | 4.24 | 3.95 | ok — overlay F13 flag |

#### b2b_returns · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,00,000 | 1,36,100 | 1,36,100 | 1,36,100 | 0.0 % | 15 | 38.9 | 6.28 | 2.42 | ok |
| May ’26 | 1,00,000 | 1,58,044 | 1,58,044 | 1,58,044 | 0.0 % | 15 | 35.6 | 4.96 | 2.09 | ok |
| Jun ’26 | 1,50,000 | 2,13,700 | 2,13,700 | 2,45,084 | -12.8 % | 21 | 39.3 | 3.52 | 1.88 | Δ>10 % — F8 flag |
| Jul ’26 | 2,00,000 | 57,209 | 57,209 | 57,209 | 0.0 % | 28 | 45.7 | 17.54 | 10.76 | ok — low month confirmed by sop_returns (F9) |
| Aug ’26 | 1,00,000 | 1,94,148 | 1,94,148 | — | — | 14 | 40.2 | 4.56 | 1.59 | ok — no sop_returns for Aug (F15) |
| Sep ’26 | 1,00,000 | 1,59,095 | 1,59,095 | 1,59,095 | 0.0 % | 14 | 38.1 | 5.27 | 1.93 | ok |
| Oct ’26 | 3,50,000 | 3,31,689 | 3,31,689 | 3,31,689 | 0.0 % | 45 | 52.0 | 3.45 | 2.98 | ok |
| Nov ’26 | 1,46,667 | 1,21,690 | 1,21,690 | — | — | 26 | 43.9 | 6.73 | 4.18 | ok |

#### b2b_returns · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 50,000 | 79,982 | 79,982 | 79,982 | 0.0 % | 7 | 21.7 | 5.95 | 1.92 | ideal/actual >3× — F9 explained |
| May ’26 | 50,000 | 82,535 | 82,535 | 82,535 | 0.0 % | 7 | 19.3 | 5.15 | 1.86 | ok |
| Jun ’26 | 75,000 | 1,08,377 | 1,08,377 | 1,05,500 | 2.7 % | 10 | 24.5 | 5.11 | 2.08 | ok — F8 flag |
| Jul ’26 | 1,00,000 | 19,836 | 19,836 | 19,836 | 0.0 % | 13 | 25.9 | 28.72 | 14.41 | ok — low month confirmed by sop_returns (F9) |
| Aug ’26 | 50,000 | 78,544 | 78,544 | — | — | 7 | 19.1 | 5.35 | 1.96 | ok — no sop_returns for Aug (F15) |
| Sep ’26 | 50,000 | 64,385 | 64,385 | 64,385 | 0.0 % | 7 | 19.6 | 6.70 | 2.39 | ok |
| Oct ’26 | 1,75,000 | 1,64,298 | 1,64,298 | 1,64,298 | 0.0 % | 23 | 20.7 | 2.77 | 3.08 | ok |
| Nov ’26 | 73,333 | 46,101 | 46,101 | — | — | 13 | 19.4 | 7.68 | 5.38 | ok |

#### b2b_returns · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 50,000 | 56,118 | 56,118 | 56,118 | 0.0 % | 8 | 17.2 | 6.76 | 3.13 | ok |
| May ’26 | 50,000 | 75,509 | 75,509 | 75,509 | 0.0 % | 8 | 16.3 | 4.75 | 2.33 | ok |
| Jun ’26 | 75,000 | 1,05,323 | 1,05,323 | 1,39,584 | -24.5 % | 11 | 14.7 | 2.32 | 1.73 | Δ>10 % — F8 flag |
| Jul ’26 | 1,00,000 | 37,373 | 37,373 | 37,373 | 0.0 % | 15 | 19.7 | 11.61 | 8.82 | ok — low month confirmed by sop_returns (F9) |
| Aug ’26 | 50,000 | 1,15,604 | 1,15,604 | — | — | 7 | 21.1 | 4.01 | 1.33 | ideal/actual >3× — F9 explained; no sop_returns for Aug (F15) |
| Sep ’26 | 50,000 | 94,710 | 94,710 | 94,710 | 0.0 % | 7 | 18.5 | 4.30 | 1.62 | ok |
| Oct ’26 | 1,75,000 | 1,67,391 | 1,67,391 | 1,67,391 | 0.0 % | 22 | 31.3 | 4.12 | 2.89 | ok |
| Nov ’26 | 73,333 | 75,589 | 75,589 | — | — | 13 | 24.4 | 6.12 | 3.41 | ok |

#### b2c_marketplace · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 2,22,444 | 2,37,751 | 2,23,741 | 2,23,741 | 0.0 % | 57 | 42.3 | 4.17 | 5.63 | ok — Within SLA Apr–Aug named (F12) |
| May ’26 | 2,74,493 | 2,99,563 | 2,51,226 | 2,51,226 | 0.0 % | 79 | 42.9 | 3.93 | 7.26 | ok — Within SLA Apr–Aug named (F12) |
| Jun ’26 | 2,66,579 | 2,48,733 | 2,65,998 | 2,65,998 | 0.0 % | 77 | 49.8 | 4.26 | 6.64 | ok — Within SLA Apr–Aug named (F12) |
| Jul ’26 | 1,90,074 | 1,60,285 | 1,41,279 | 1,41,279 | 0.0 % | 43 | 62.7 | 10.17 | 6.98 | ok — Within SLA Apr–Aug named (F12) |
| Aug ’26 | 1,86,734 | 1,88,786 | 1,82,376 | 1,82,376 | 0.0 % | 47 | 48.9 | 6.16 | 5.91 | ok — Within SLA Apr–Aug named (F12) |
| Sep ’26 | 2,06,168 | 1,83,122 | 1,71,979 | 1,71,979 | 0.0 % | 65 | 50.5 | 6.72 | 8.67 | ok — Within SLA Apr–Aug named (F12) |
| Oct ’26 | 2,87,372 | 3,09,199 | 2,90,934 | 2,90,782 | 0.1 % | 99 | 57.2 | 4.50 | 7.81 | ok — Within SLA Apr–Aug named (F12) |
| Nov ’26 | 1,20,539 | 1,03,974 | 1,07,406 | — | — | 40 | 50.0 | 8.48 | 7.13 | ok — Within SLA Apr–Aug named (F12) |

#### b2c_marketplace · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 68,456 | 86,088 | 79,136 | 79,136 | 0.0 % | 20 | 15.2 | 4.24 | 5.59 | ok — Within SLA Apr–Aug named (F12) |
| May ’26 | 93,672 | 1,10,016 | 92,258 | 92,258 | 0.0 % | 27 | 16.2 | 3.89 | 6.46 | ok — Within SLA Apr–Aug named (F12) |
| Jun ’26 | 1,18,916 | 94,745 | 1,00,063 | 1,00,063 | 0.0 % | 34 | 27.7 | 6.12 | 7.50 | ok — Within SLA Apr–Aug named (F12) |
| Jul ’26 | 85,529 | 65,767 | 58,340 | 58,340 | 0.0 % | 19 | 28.4 | 10.73 | 7.19 | ok — Within SLA Apr–Aug named (F12) |
| Aug ’26 | 84,030 | 69,319 | 71,924 | 71,924 | 0.0 % | 21 | 19.1 | 5.87 | 6.44 | ok — Within SLA Apr–Aug named (F12) |
| Sep ’26 | 92,775 | 74,796 | 70,408 | 70,408 | 0.0 % | 29 | 24.0 | 7.51 | 9.09 | ok — Within SLA Apr–Aug named (F12) |
| Oct ’26 | 1,29,318 | 1,27,802 | 1,19,297 | 1,19,299 | -0.0 % | 44 | 27.4 | 5.07 | 8.14 | ok — Within SLA Apr–Aug named (F12) |
| Nov ’26 | 54,249 | 44,062 | 44,595 | — | — | 18 | 24.3 | 9.50 | 7.38 | ok — Within SLA Apr–Aug named (F12) |

#### b2c_marketplace · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,53,988 | 1,51,663 | 1,44,605 | 1,44,605 | 0.0 % | 37 | 27.1 | 4.13 | 5.65 | ok — Within SLA Apr–Aug named (F12) |
| May ’26 | 1,80,821 | 1,89,547 | 1,58,968 | 1,58,968 | 0.0 % | 52 | 26.6 | 3.96 | 7.73 | ok — Within SLA Apr–Aug named (F12) |
| Jun ’26 | 1,47,663 | 1,53,988 | 1,65,935 | 1,65,935 | 0.0 % | 43 | 22.0 | 3.14 | 6.13 | ok — Within SLA Apr–Aug named (F12) |
| Jul ’26 | 1,04,545 | 94,518 | 82,939 | 82,939 | 0.0 % | 24 | 34.3 | 9.78 | 6.84 | ok — Within SLA Apr–Aug named (F12) |
| Aug ’26 | 1,02,704 | 1,19,467 | 1,10,452 | 1,10,452 | 0.0 % | 26 | 29.7 | 6.37 | 5.56 | ok — Within SLA Apr–Aug named (F12) |
| Sep ’26 | 1,13,393 | 1,08,326 | 1,01,571 | 1,01,571 | 0.0 % | 36 | 26.5 | 6.16 | 8.38 | ok — Within SLA Apr–Aug named (F12) |
| Oct ’26 | 1,58,054 | 1,81,397 | 1,71,637 | 1,71,483 | 0.1 % | 55 | 29.7 | 4.10 | 7.58 | ok — Within SLA Apr–Aug named (F12) |
| Nov ’26 | 66,290 | 59,912 | 62,811 | — | — | 22 | 25.7 | 7.75 | 6.94 | ok — Within SLA Apr–Aug named (F12) |

#### b2c_returns · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 76,778 | 1,58,083 | 1,71,842 | 1,71,834 | 0.0 % | 34 | 54.9 | 7.05 | 4.35 | ok |
| May ’26 | 1,08,295 | 1,50,874 | 1,64,780 | 1,64,780 | 0.0 % | 48 | 52.2 | 7.01 | 6.40 | ok |
| Jun ’26 | 1,10,500 | 1,70,351 | 1,94,116 | 1,94,120 | -0.0 % | 48 | 53.1 | 6.01 | 5.44 | ok |
| Jul ’26 | 79,731 | 2,23,614 | 2,58,324 | 2,58,594 | -0.1 % | 35 | 65.2 | 5.54 | 2.98 | ok |
| Aug ’26 | 78,306 | 1,30,098 | 1,66,501 | — | — | 35 | 64.0 | 8.46 | 4.62 | ok — no sop_returns for Aug (F15) |
| Sep ’26 | 86,588 | 1,10,483 | 1,66,964 | 1,66,964 | 0.0 % | 38 | 70.4 | 9.27 | 5.00 | ok |
| Oct ’26 | 1,23,266 | 1,39,709 | 1,57,384 | 1,57,384 | 0.0 % | 54 | 71.9 | 10.04 | 7.54 | ok |
| Nov ’26 | 51,938 | 88,693 | 1,13,662 | — | — | 31 | 61.0 | 9.42 | 5.02 | ok |

#### b2c_returns · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 19,376 | 61,392 | 61,695 | 61,695 | 0.0 % | 9 | 25.3 | 9.01 | 3.21 | ok |
| May ’26 | 37,229 | 62,363 | 67,118 | 67,118 | 0.0 % | 17 | 26.5 | 8.68 | 5.57 | ok |
| Jun ’26 | 49,726 | 62,849 | 74,795 | 74,800 | -0.0 % | 22 | 28.1 | 8.27 | 6.47 | ok |
| Jul ’26 | 35,877 | 93,711 | 99,633 | 99,633 | 0.0 % | 16 | 32.4 | 7.16 | 3.53 | ok |
| Aug ’26 | 35,236 | 59,233 | 82,130 | — | — | 16 | 35.5 | 9.51 | 4.28 | ok — no sop_returns for Aug (F15) |
| Sep ’26 | 38,964 | 46,360 | 82,826 | 82,826 | 0.0 % | 17 | 43.0 | 11.42 | 4.51 | ok |
| Oct ’26 | 55,470 | 57,826 | 71,206 | 71,206 | 0.0 % | 25 | 44.3 | 13.68 | 7.72 | ok |
| Nov ’26 | 23,375 | 39,061 | 41,925 | — | — | 14 | 39.0 | 16.13 | 6.07 | ok |

#### b2c_returns · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 57,402 | 96,691 | 1,10,147 | 1,10,139 | 0.0 % | 25 | 29.6 | 5.91 | 4.99 | ok |
| May ’26 | 71,066 | 88,511 | 97,662 | 97,662 | 0.0 % | 31 | 25.7 | 5.78 | 6.98 | ok |
| Jun ’26 | 60,774 | 1,07,502 | 1,19,321 | 1,19,320 | 0.0 % | 26 | 24.9 | 4.59 | 4.79 | ok |
| Jul ’26 | 43,854 | 1,29,903 | 1,58,691 | 1,58,961 | -0.2 % | 19 | 32.7 | 4.53 | 2.63 | ok |
| Aug ’26 | 43,070 | 70,865 | 84,371 | — | — | 19 | 28.4 | 7.41 | 4.95 | ok — no sop_returns for Aug (F15) |
| Sep ’26 | 47,624 | 64,123 | 84,138 | 84,138 | 0.0 % | 21 | 27.3 | 7.15 | 5.49 | ok |
| Oct ’26 | 67,796 | 81,883 | 86,178 | 86,178 | 0.0 % | 29 | 27.6 | 7.03 | 7.40 | ok |
| Nov ’26 | 28,563 | 49,632 | 71,737 | — | — | 17 | 22.0 | 5.42 | 4.39 | ok |

#### b2c_shopify · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 2,27,244 | 2,08,957 | 2,01,787 | 2,01,787 | 0.0 % | 39 | 62.2 | 6.82 | 4.29 | ok |
| May ’26 | 2,31,909 | 2,30,938 | 2,20,364 | 2,20,364 | 0.0 % | 43 | 63.1 | 6.92 | 4.68 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 1,86,109 | 3,41,997 | 3,17,907 | 3,17,907 | 0.0 % | 33 | 73.6 | 5.27 | 2.37 | ok |
| Jul ’26 | 4,51,914 | 5,79,612 | 5,55,097 | 5,55,097 | 0.0 % | 194 | 92.5 | 3.82 | 7.98 | ok |
| Aug ’26 | 2,15,380 | 2,16,761 | 2,01,484 | 2,01,484 | 0.0 % | 38 | 71.9 | 8.20 | 4.31 | ok |
| Sep ’26 | 2,08,512 | 1,82,664 | 1,75,338 | 1,75,338 | 0.0 % | 37 | 74.5 | 9.72 | 4.82 | ok |
| Oct ’26 | 2,11,824 | 1,56,946 | 1,52,296 | 1,52,292 | 0.0 % | 41 | 84.4 | 12.68 | 6.15 | ok |
| Nov ’26 | 99,990 | 1,11,101 | 1,13,825 | — | — | 231 | 73.8 | 11.48 | 37.60 | ideal/actual >3× — F10 flag |

#### b2c_shopify · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,02,260 | 93,215 | 90,158 | 90,158 | 0.0 % | 20 | 22.8 | 5.58 | 4.91 | ok |
| May ’26 | 1,04,359 | 85,819 | 82,354 | 82,354 | 0.0 % | 22 | 24.4 | 6.53 | 5.90 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 83,749 | 1,41,902 | 1,34,374 | 1,34,374 | 0.0 % | 17 | 41.6 | 6.83 | 2.79 | ok |
| Jul ’26 | 2,03,361 | 2,18,008 | 2,11,221 | 2,11,221 | 0.0 % | 100 | 42.5 | 4.45 | 10.45 | ok |
| Aug ’26 | 95,724 | 94,560 | 89,553 | 89,553 | 0.0 % | 19 | 28.7 | 7.07 | 4.68 | ok |
| Sep ’26 | 92,795 | 81,353 | 78,807 | 78,807 | 0.0 % | 19 | 35.9 | 10.07 | 5.32 | ok |
| Oct ’26 | 95,320 | 77,030 | 75,008 | 75,036 | -0.0 % | 21 | 41.1 | 12.11 | 6.18 | ok |
| Nov ’26 | 44,995 | 53,454 | 54,736 | — | — | 119 | 36.4 | 11.33 | 38.80 | ideal/actual >3× — F10 flag |

#### b2c_shopify · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 1,24,984 | 1,15,742 | 1,11,629 | 1,11,629 | 0.0 % | 19 | 39.4 | 7.85 | 3.79 | ok |
| May ’26 | 1,27,550 | 1,45,119 | 1,38,010 | 1,38,010 | 0.0 % | 21 | 38.8 | 7.18 | 3.89 | ok — ₹/unit base: sheet = plan (F14) |
| Jun ’26 | 1,02,360 | 2,00,095 | 1,83,533 | 1,83,533 | 0.0 % | 16 | 32.0 | 4.12 | 2.06 | ok |
| Jul ’26 | 2,48,553 | 3,61,604 | 3,43,876 | 3,43,876 | 0.0 % | 94 | 49.9 | 3.43 | 6.46 | ok |
| Aug ’26 | 1,19,656 | 1,22,201 | 1,11,931 | 1,11,931 | 0.0 % | 19 | 43.3 | 9.14 | 4.01 | ok |
| Sep ’26 | 1,15,717 | 1,01,311 | 96,531 | 96,531 | 0.0 % | 18 | 38.5 | 9.43 | 4.41 | ok |
| Oct ’26 | 1,16,504 | 79,916 | 77,288 | 77,256 | 0.0 % | 20 | 43.3 | 13.24 | 6.12 | ok |
| Nov ’26 | 54,995 | 57,647 | 59,089 | — | — | 112 | 37.4 | 11.63 | 36.48 | ok — F10 flag |

#### inwards · Both · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 10,69,940 | 10,91,471 | 10,37,362 | 10,37,362 | 0.0 % | — | 41.8 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| May ’26 | 10,70,006 | 10,56,394 | 8,98,636 | 8,98,636 | 0.0 % | — | 38.6 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jun ’26 | 9,23,982 | 11,86,842 | 9,72,878 | 9,72,878 | 0.0 % | — | 38.5 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jul ’26 | 7,82,429 | 8,30,922 | 6,42,173 | 6,42,173 | 0.0 % | — | 43.9 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Aug ’26 | 11,26,581 | 9,09,469 | 8,10,960 | 8,10,960 | 0.0 % | — | 39.1 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Sep ’26 | 13,88,815 | 11,79,877 | 12,07,560 | 12,07,560 | 0.0 % | 265 | 44.0 | 0.73 | 4.38 | ideal/actual >3× — F3 explained + flag |
| Oct ’26 | 14,54,289 | 12,66,565 | 10,78,783 | 13,18,063 | -18.2 % | 146 | 48.1 | 0.80 | 2.43 | Δ>10 %; ideal/actual >3× — F3, F4 flag |
| Nov ’26 | 7,62,059 | 5,80,526 | 4,46,405 | — | — | 55 | 45.8 | 1.27 | 1.60 | ok — F3 |

#### inwards · North · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 3,73,312 | 4,26,518 | 4,26,518 | 4,26,518 | 0.0 % | — | 14.8 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| May ’26 | 5,09,503 | 5,02,981 | 4,20,446 | 4,20,446 | 0.0 % | — | 14.8 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jun ’26 | 4,28,098 | 5,41,076 | 4,23,390 | 4,23,390 | 0.0 % | — | 18.1 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jul ’26 | 3,64,677 | 3,41,165 | 2,60,108 | 2,60,108 | 0.0 % | — | 18.1 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Aug ’26 | 3,86,590 | 3,25,944 | 2,80,731 | 2,80,731 | 0.0 % | — | 14.5 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Sep ’26 | 7,59,907 | 6,78,319 | 6,04,085 | 6,04,085 | 0.0 % | 165 | 19.0 | 0.59 | 5.13 | ideal/actual >3× — F3 explained + flag |
| Oct ’26 | 8,20,684 | 6,73,355 | 4,92,786 | 6,28,336 | -21.6 % | 91 | 20.4 | 0.71 | 3.18 | Δ>10 %; ideal/actual >3× — F3, F4 flag |
| Nov ’26 | 3,58,504 | 2,46,712 | 1,96,641 | — | — | 29 | 19.8 | 1.19 | 1.83 | ok — F3 |

#### inwards · South · month

| Month | Projected | Received | Processed | Reference actual | Δ | Ideal heads | Actual heads | ₹/unit | Ideal ₹/unit | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr ’26 | 6,96,628 | 6,64,953 | 6,10,844 | 6,10,844 | 0.0 % | — | 26.9 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| May ’26 | 5,60,503 | 5,53,413 | 4,78,190 | 4,78,190 | 0.0 % | — | 23.8 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jun ’26 | 4,95,884 | 6,45,766 | 5,49,488 | 5,49,488 | 0.0 % | — | 20.4 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Jul ’26 | 4,17,752 | 4,89,757 | 3,82,065 | 3,82,065 | 0.0 % | — | 25.7 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Aug ’26 | 7,39,991 | 5,83,525 | 5,30,229 | 5,30,229 | 0.0 % | — | 24.7 | — | — | blank — F1, F2 fixed (6e30d1a, aa9c24e) |
| Sep ’26 | 6,28,908 | 5,01,558 | 6,03,475 | 6,03,475 | 0.0 % | 100 | 25.0 | 0.88 | 3.53 | ideal/actual >3× — F3 explained + flag |
| Oct ’26 | 6,33,605 | 5,93,210 | 5,85,997 | 6,89,727 | -15.0 % | 55 | 27.6 | 0.88 | 1.75 | Δ>10 % — F3, F4 flag |
| Nov ’26 | 4,03,555 | 3,33,814 | 2,49,764 | — | — | 26 | 26.0 | 1.34 | 1.40 | ok — F3 |
