import type { RunQ } from "../db";

/**
 * Ad-hoc work out of BAU and event notes for AOP › Functions, from Malhar's filled justification workbook (24 Nov 2026), source sheets:
 * "North / South WH AD Hoc Task and Deployment Update". Charged to the function the work served (fn = FnKey); `rfid` and `liquidation` are
 * their own buckets, not functions (site overhead) — kept for the record, not in any function's gap.
 * Decisions: Birthday Sale = event note, not ad-hoc; Myntra tagging / re-sticker = B2B Marketplace; RFID Sep = 30 days (450); washing and
 * Berrylush (acquired company) left out; QC-reject putaway = returns (B2C Returns, the South returns team — to confirm); South Sep–Oct
 * liquidation split by the 19 Sep batch's days (checked against IPP 300).
 */
type A = [site: "South" | "North", month: string, fn: string, task: string, dates: string, days: number, qty: number, heads: number, manDays: number, dept: string, note: string];
const ADHOC: A[] = [
  ["North", "2026-08-01", "b2b_marketplace", "Myntra tagging (tag segregation, stock movement, polybag replacement, tagging)", "19–31 Aug", 13, 5577, 10, 130, "B2B Forward", ""],
  ["North", "2026-09-01", "b2b_marketplace", "Myntra tagging", "01–18 Sep", 18, 7722, 10, 180, "B2B Forward", ""],
  ["South", "2026-09-01", "b2b_marketplace", "Myntra re-sticker", "02–15 Sep", 16, 35495, 15, 240, "B2B Forward", "sheet days (16) exceed the dates (14); 35,495 at the re-sticker IPP (400) needs ~89 man-days"],
  ["North", "2026-08-01", "inwards", "Threadfusion tagging (China goods: sorting, feeding, tagging, box data entry)", "19–31 Aug", 13, 78169, 22, 286, "Inward", ""],
  ["North", "2026-09-01", "inwards", "Threadfusion tagging", "01–02 Sep", 2, 12026, 22, 44, "Inward", ""],
  ["North", "2026-10-01", "inwards", "Threadfusion tagging", "02–05 Oct", 4, 18000, 15, 60, "Inward", ""],
  ["South", "2026-10-01", "b2c_returns", "QC-reject putaway", "01–31 Oct", 6, 13617, 2, 12, "Inward", "accounted in returns"],
  ["South", "2026-11-01", "b2c_returns", "QC-reject putaway", "02–13 Nov", 3, 9309, 2, 6, "Inward", "accounted in returns"],
  ["North", "2026-08-01", "rfid", "RFID encoding (store + operational efficiency across inward, outward, inventory)", "20–31 Aug", 14, 23814, 15, 210, "B2B Forward", ""],
  ["North", "2026-09-01", "rfid", "RFID encoding", "01–30 Sep", 30, 52731, 15, 450, "B2B Forward", ""],
  ["North", "2026-10-01", "rfid", "RFID encoding", "01–30 Oct", 30, 51030, 15, 450, "B2B Forward", ""],
  ["North", "2026-11-01", "rfid", "RFID encoding", "01–14 Nov", 14, 23814, 15, 210, "B2B Forward", ""],
  ["South", "2026-07-01", "liquidation", "Liquidation", "from 02 Jul", 23, 50000, 7, 161, "B2C & B2B Forward", ""],
  ["South", "2026-09-01", "liquidation", "Liquidation", "07–19 Sep", 13, 40242, 10, 130, "B2C & B2B Forward", ""],
  ["South", "2026-09-01", "liquidation", "Liquidation (19 Sep batch, Sep share)", "19–30 Sep", 12, 33119, 9, 108, "B2C & B2B Forward", ""],
  ["South", "2026-10-01", "liquidation", "Liquidation (19 Sep batch, Oct share)", "01–08 Oct", 8, 22080, 9, 72, "B2C & B2B Forward", ""],
  ["South", "2026-10-01", "liquidation", "Liquidation", "from 14 Oct", 4, 10014, 8, 32, "B2C & B2B Forward", ""],
];
const NOTES: [site: "South" | "North", month: string, fn: string, note: string][] = [
  ["North", "2026-07-01", "b2c_shopify", "Birthday Sale (01–19 Jul): 98 heads a day, 1,862 man-days on 2,46,978 units — manpower ramped up the month before the sale."],
  ["North", "2026-08-01", "b2c_shopify", "After the Birthday Sale the projection dropped sharply, but the heads hired for it did not leave as fast: natural attrition is slower than the drop in volume."],
];
const SOURCE = "justification workbook 24 Nov 2026";

export async function seedFnAdhoc(q: RunQ) {
  await q(`delete from fn_adhoc where source = $1`, [SOURCE]);
  await q(`delete from fn_note where source = $1`, [SOURCE]);
  for (const [site, month, fn, task, dates, days, qty, heads, manDays, dept, note] of ADHOC)
    await q(`insert into fn_adhoc (site, month, fn, task, dates, days, qty, heads, man_days, source_dept, note, source) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [site, month, fn, task, dates, days, qty, heads, manDays, dept, note || null, SOURCE]);
  for (const [site, month, fn, note] of NOTES)
    await q(`insert into fn_note (site, month, fn, note, source) values ($1, $2, $3, $4, $5)`, [site, month, fn, note, SOURCE]);
  return ADHOC.length;
}
