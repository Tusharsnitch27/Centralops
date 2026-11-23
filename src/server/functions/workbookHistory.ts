import type { DayRow, FnKey } from "./types";

// Full-month review totals from (Plan vs Actual) S&OP_FY'26-27 (1).xlsx.
// Columns: month, function, South plan, South actual, North plan, North actual.
type WorkbookRow = [string, FnKey, number | null, number, number | null, number];
const workbook: WorkbookRow[] = [
  // (1-30)Apr26 Plan Vs Actual-Mont
  ["2026-04", "b2c_shopify", 124984, 111629, 102260, 90158], // F9, G9, I9, J9
  ["2026-04", "b2c_marketplace", 153988, 144605, 68456, 79136], // F8, G8, I8, J8
  ["2026-04", "b2b_marketplace", 104000, 86551, 104000, 47146], // F21, G21, I21, J21
  ["2026-04", "b2b_retail", 273528, 329066, 263668, 273588], // F29, G29, I29, J29
  ["2026-04", "inwards", 696628, 610844, 373312, 426518], // F37, G37, I37, J37
  // (1-31)May26 Plan Vs Actual-Mont
  ["2026-05", "b2c_shopify", 127550, 138010, 104359, 82354], // F9, G9, I9, J9
  ["2026-05", "b2c_marketplace", 177665, 158968, 93072, 92258], // F8, G8, I8, J8
  ["2026-05", "b2b_marketplace", 73301, 65720, 73301, 70278], // F21, G21, I21, J21
  ["2026-05", "b2b_retail", 288528, 239884, 275668, 212945], // F29, G29, I29, J29
  ["2026-05", "inwards", 560503.1133, 478190, 509502.8867, 420446], // F37, G37, I37, J37
  // (1-30)Jun26 Plan Vs Actual-Mont
  ["2026-06", "b2c_shopify", 183499, 183533, 150135, 134374], // F9, G9, I9, J9
  ["2026-06", "b2c_marketplace", 144633, 165935, 118340, 100063], // F8, G8, I8, J8
  ["2026-06", "b2b_marketplace", 28000, 15360, 27000, 17584], // F21, G21, I21, J21
  ["2026-06", "b2b_retail", 202896, 317675, 186501, 312545], // F29, G29, I29, J29
  ["2026-06", "inwards", 495884, 549488, 428098, 423390], // F37, G37, I37, J37
  // (1-31)Jul26 Plan Vs Actual-Mont
  ["2026-07", "b2c_shopify", 248553, 343876, 203361, 211221], // F9, G9, I9, J9
  ["2026-07", "b2c_marketplace", 104545, 82939, 85529, 58340], // F8, G8, I8, J8
  ["2026-07", "b2b_marketplace", 39000, 37945, 39000, 32873], // F21, G21, I21, J21
  ["2026-07", "b2b_retail", 254807.7532, 303067, 235207.1568, 254452], // F30, G30, I30, J30
  ["2026-07", "inwards", 417752, 382065, 364677, 260108], // F38, G38, I38, J38
  // (1-31)Aug26 Plan Vs Actual-Mont
  ["2026-08", "b2c_shopify", 85468, 111931, 68377, 89553], // F9, G9, I9, J9
  ["2026-08", "b2c_marketplace", 87442, 110452, 69949, 71924], // F8, G8, I8, J8
  ["2026-08", "b2b_marketplace", 84750, 92684, 42375, 44698], // F21, G21, I21, J21
  ["2026-08", "b2b_retail", 257875, 335306, 238036, 221823], // F29, G29, I29, J29
  ["2026-08", "inwards", 739991, 530229, 386590, 280731], // F37, G37, I37, J37
  // (1-30)Sep26 Plan Vs Actual-Mont
  ["2026-09", "b2c_shopify", 115717, 96531, 92795, 78807], // F9, G9, I9, J9
  ["2026-09", "b2c_marketplace", 102044, 101571, 92775, 70408], // F8, G8, I8, J8
  ["2026-09", "b2b_marketplace", 171000, 172880, 171000, 90869], // F22, G22, I22, J22
  ["2026-09", "b2b_retail", 302110, 366028, 278870, 288084], // F30, G30, I30, J30
  ["2026-09", "inwards", 628908, 603475, 759907, 604085], // F38, G38, I38, J38
  // (1-31)Oct26 Plan vs Actual Mont
  ["2026-10", "b2c_shopify", 116504, 77256, 95320, 75036], // F9, G9, I9, J9
  ["2026-10", "b2c_marketplace", 158054, 171483, 129318, 119299], // F8, G8, I8, J8
  ["2026-10", "b2b_marketplace", 48000, 42086, 48000, 9540], // F22, G22, I22, J22
  ["2026-10", "b2b_retail", 308532, 506352, 308532, 410460], // F30, G30, I30, J30
  ["2026-10", "inwards", 633605, 689727, 820685, 628336], // F39, G39, I39, J39
  // Returns: none here — B2C and B2B putaway are read from April, and the plan from the S&OP returns rows.
];

function sumComplete(values: (number | null)[]) {
  if (!values.length || values.some((value) => value == null)) return null;
  return values.reduce<number>((total, value) => total + value!, 0);
}

/** Use the workbook at its original monthly grain. Keep current feed data where the
 * stage feed covers the month and use the workbook for months before its 21 Sep start. */
export function workbookMonthVolumes(fn: FnKey, month: string, sites: DayRow["site"][], rows: DayRow[]) {
  const sheet = workbook.find(([period, key]) => period === month && key === fn);
  const monthRows = rows.filter((row) => row.day.slice(0, 7) === month);
  const projected: (number | null)[] = [], processed: (number | null)[] = [];
  let usedProjection = false, usedProcessed = false;
  for (const site of sites) {
    const siteRows = monthRows.filter((row) => row.site === site);
    const dailyPlan = siteRows.flatMap((row) => row.projected == null ? [] : [row.projected]);
    const dailyOutput = siteRows.flatMap((row) => row.processed == null ? [] : [row.processed]);
    const sheetPlan = site === "South" ? sheet?.[2] : sheet?.[4];
    const sheetOutput = site === "South" ? sheet?.[3] : sheet?.[5];
    // A rulebook uploaded mid-month does not provide a full-month retail projection.
    const usePlan = sheetPlan != null && (!dailyPlan.length ||
      (fn === "b2b_retail" && month < "2026-10" && dailyPlan.length < siteRows.length));
    const useOutput = sheetOutput != null && (month < "2026-10" || !dailyOutput.length);
    usedProjection ||= usePlan;
    usedProcessed ||= useOutput;
    projected.push(usePlan ? sheetPlan : sumComplete(dailyPlan));
    processed.push(useOutput ? sheetOutput : sumComplete(dailyOutput));
  }
  return { projected: sumComplete(projected), processed: sumComplete(processed), usedProjection, usedProcessed };
}
