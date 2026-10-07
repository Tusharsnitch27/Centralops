// Pure import helpers (shared by the client preview and the server import). No file structure is assumed:
// headers are detected, each column is mapped to a field, and the same mapping turns rows into plan records.
import type { Direction, Measure } from "./calc";

export type Cell = string | number | boolean | null;
export type Field = "ignore" | "function" | "group" | "line" | "owner" | "metric" | "unit" | "annual" | "period" | "month" | "value";
export interface ColumnMap { index: number; field: Field; period?: string | null; measure?: Measure | null }
export interface ImportMapping {
  headerRow: number;            // 0-based row holding column titles (e.g. Budget / Provision / Actuals)
  groupRow: number | null;      // optional row above it carrying merged labels (e.g. months) — combined as "May · Budget"
  columns: ColumnMap[];
  defaults: { function?: string | null; group?: string | null; direction?: Direction; unit?: "inr" | "num" | "pct" };
  skipTotals: boolean;          // drop "Total" / "Grand Total" / subtotal rows
  carryDown: boolean;           // rows with only a Function/Group value start a new block (Logistics-style sheets)
}
export interface ImportRecord {
  fn: string; group: string | null; line: string; owner: string | null; metric: string | null; unit: string | null; annual: number | null;
  values: { period: string; measure: Measure; value: number }[]; row: number;
}

export const FIELD_LABEL: Record<Field, string> = {
  ignore: "Ignore", function: "Function", group: "Group", line: "Line", owner: "Owner", metric: "Metric", unit: "Unit",
  annual: "Annual target", period: "Period value", month: "Month (long format)", value: "Value (long format)",
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RX = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s'’\-_/.]*(\d{2,4})?/i;
const isSerial = (v: unknown) => typeof v === "number" && v > 36000 && v < 60000 && Number.isInteger(v);

export const str = (v: Cell | undefined) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

/** Excel serial → 'YYYY-MM-01'. */
function serialToPeriod(n: number) {
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
/** Month in a label → period, using the plan year to place Jan–Mar after Apr–Dec. */
export function toPeriod(v: Cell | undefined, fyStart: string): string | null {
  if (v == null || v === "") return null;
  if (isSerial(v)) return serialToPeriod(v as number);
  const s = String(v);
  const iso = s.match(/\b(20\d{2})-(\d{2})(?:-\d{2})?\b/);
  if (iso) return `${iso[1]}-${iso[2]}-01`;
  const serialInText = s.match(/\b(4\d{4}|5\d{4})\b/);
  if (serialInText && isSerial(Number(serialInText[1]))) return serialToPeriod(Number(serialInText[1]));
  const m = s.match(MONTH_RX);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  let year: number;
  if (m[2]) year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  else {
    const fy = Number(fyStart.slice(0, 4)), fm = Number(fyStart.slice(5, 7));
    year = mon >= fm ? fy : fy + 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}-01`;
}
export function toMeasure(s: string): Measure | null {
  const t = s.toLowerCase();
  if (/provision|forecast|projection|projected|estimate|revised|outlook|\blbe\b|\bre\b/.test(t)) return "forecast";
  if (/actual|invoice|achieved|\bact\b/.test(t)) return "actual";
  if (/budget|plan|target|\baop\b|\bbud\b/.test(t)) return "plan";
  return null;
}
export function toNumber(v: Cell | undefined): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s || s === "-" || s === "—") return null;
  const m = s.match(/^(-?\d*\.?\d+)(cr|l|lakh|k)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2]?.toLowerCase();
  return u === "cr" ? n * 1e7 : u === "l" || u === "lakh" ? n * 1e5 : u === "k" ? n * 1e3 : n;
}
const TOTAL_RX = /^(grand\s*)?(sub\s*-?\s*)?total\b|^total$/i;

/** Pick the header row (most measure/month/field words) and an optional group row above it. */
export function detectHeader(rows: Cell[][], fyStart: string): { headerRow: number; groupRow: number | null } {
  let best = 0, bestScore = -1;
  const lim = Math.min(rows.length, 20);
  const score = (r: Cell[]) => r.reduce<number>((a, c) => {
    const s = str(c);
    if (!s) return a;
    if (toMeasure(s)) return a + 2;
    if (toPeriod(c, fyStart) && (isSerial(c) || MONTH_RX.test(s))) return a + 1.5;
    if (/function|department|owner|vendor|partner|particular|line|metric|category/i.test(s)) return a + 1;
    return a;
  }, 0);
  for (let i = 0; i < lim; i++) { const s = score(rows[i] ?? []); if (s > bestScore) { bestScore = s; best = i; } }
  const hasMeasures = (rows[best] ?? []).some((c) => toMeasure(str(c)));
  let groupRow: number | null = null;
  if (hasMeasures) for (let k = best - 1; k >= Math.max(0, best - 3); k--) {
    const months = (rows[k] ?? []).filter((c) => (isSerial(c) || MONTH_RX.test(str(c))) && toPeriod(c, fyStart)).length;
    if (months >= 2) { groupRow = k; break; }
  }
  return { headerRow: best, groupRow };
}

/** Column titles with the group row carried forward across merged/blank cells: "May · Budget". */
export function columnLabels(rows: Cell[][], headerRow: number, groupRow: number | null): { top: string; head: string; label: string; raw: Cell }[] {
  const width = Math.max(rows[headerRow]?.length ?? 0, groupRow != null ? rows[groupRow]?.length ?? 0 : 0);
  const out: { top: string; head: string; label: string; raw: Cell }[] = [];
  let carry: Cell = null;
  for (let c = 0; c < width; c++) {
    const g = groupRow != null ? rows[groupRow]?.[c] ?? null : null;
    if (g != null && str(g)) carry = g;
    const head = str(rows[headerRow]?.[c]);
    const topCell = groupRow != null && head ? carry : g;
    const top = topCell == null ? "" : isSerial(topCell) ? `${new Date(Date.UTC(1899, 11, 30) + Number(topCell) * 86400000).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} (${topCell})` : str(topCell);
    out.push({ top, head, label: [top, head].filter(Boolean).join(" · "), raw: topCell ?? rows[headerRow]?.[c] ?? null });
  }
  return out;
}

/** Regex suggestions per column. */
export function suggestColumns(rows: Cell[][], headerRow: number, groupRow: number | null, fyStart: string): ColumnMap[] {
  const labels = columnLabels(rows, headerRow, groupRow);
  const data = rows.slice(headerRow + 1, headerRow + 80);
  const cols: ColumnMap[] = labels.map((l, index) => {
    const head = l.head, both = l.label;
    const measure = toMeasure(head) ?? (groupRow == null ? null : toMeasure(l.top));
    const period = (groupRow != null ? toPeriod(l.raw, fyStart) : null) ?? toPeriod(rows[headerRow]?.[index] ?? null, fyStart);
    const looksMonth = period && (isSerial(l.raw) || isSerial(rows[headerRow]?.[index]) || MONTH_RX.test(both));
    if (looksMonth && !/fy|annual|full.?year|total/i.test(both)) return { index, field: "period", period, measure: measure ?? "plan" };
    const h = head.toLowerCase();
    if (/fy\s*target|annual|full.?year|fy\s*budget|total\s*budget/.test(h)) return { index, field: "annual" };
    if (/^(month|period)$/.test(h)) return { index, field: "month" };
    if (measure && groupRow == null && !looksMonth && /^(budget|plan|target|provision|forecast|actuals?|actuals?\/invoices)$/i.test(head)) return { index, field: "value", measure };
    if (/function|department|\bdept\b/.test(h)) return { index, field: "function" };
    if (/owner|\bpoc\b|responsible/.test(h)) return { index, field: "owner" };
    if (/metric|\bkpi\b/.test(h)) return { index, field: "metric" };
    if (/^unit$/.test(h)) return { index, field: "unit" };
    if (/group|category|bucket|sub.?head|channel|warehouse/.test(h)) return { index, field: "group" };
    if (/^(line|line item|particulars?|vendor|partner|partner name|item|cost head|name)$/.test(h)) return { index, field: "line" };
    return { index, field: "ignore" };
  });
  // text columns left of the numbers: rightmost becomes Line, the one before it Group (Logistics-style blocks)
  const firstValue = cols.find((c) => c.field === "period" || c.field === "value" || c.field === "annual")?.index ?? cols.length;
  const textCols = cols.filter((c) => c.index < firstValue && (c.field === "ignore" || c.field === "line" || c.field === "group")).filter((c) => {
    const vals = data.map((r) => r[c.index]).filter((v) => v != null && str(v) !== "");
    return vals.length >= 2 && vals.filter((v) => typeof v === "string" && toNumber(v) == null).length / vals.length > 0.6;
  });
  if (textCols.length) {
    for (const c of textCols) if (c.field === "line") c.field = "ignore";
    textCols[textCols.length - 1].field = "line";
    if (textCols.length >= 2 && !cols.some((c) => c.field === "group" && c.index !== textCols[textCols.length - 2].index)) textCols[textCols.length - 2].field = "group";
  }
  return cols;
}

/** Rows → records using a mapping. Pure, so the client can preview exactly what the server will import. */
export function extractRecords(rows: Cell[][], mp: ImportMapping, fyStart: string): { records: ImportRecord[]; skipped: number; warnings: string[] } {
  const col = (f: Field) => mp.columns.find((c) => c.field === f)?.index;
  const ci = { fn: col("function"), group: col("group"), line: col("line"), owner: col("owner"), metric: col("metric"), unit: col("unit"), annual: col("annual"), month: col("month") };
  const periodCols = mp.columns.filter((c) => c.field === "period" && c.period && c.measure);
  const valueCols = mp.columns.filter((c) => c.field === "value" && c.measure);
  const warnings: string[] = [];
  if (ci.line == null) warnings.push("Map a column to Line — each imported row needs a line name.");
  if (!periodCols.length && !(ci.month != null && valueCols.length) && ci.annual == null) warnings.push("Map at least one Period value column (month + measure), or Month + Value columns.");
  const start = Math.max(mp.headerRow, mp.groupRow ?? -1) + 1;
  let curFn: string | null = null, curGroup: string | null = null, skipped = 0;
  const byKey = new Map<string, ImportRecord>();
  for (let r = start; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const line = ci.line != null ? str(row[ci.line]) : "";
    const fnV = ci.fn != null ? str(row[ci.fn]) : "";
    const grV = ci.group != null ? str(row[ci.group]) : "";
    if (mp.carryDown) {
      if (fnV && !TOTAL_RX.test(fnV)) curFn = fnV;
      if (grV && !TOTAL_RX.test(grV)) curGroup = grV;
      if (fnV && !grV && !line) curGroup = null;
    }
    if (!line) { if (row.some((c) => str(c))) skipped++; continue; }
    if (mp.skipTotals && (TOTAL_RX.test(line) || TOTAL_RX.test(grV))) { skipped++; continue; }
    const fn = (mp.carryDown ? curFn : fnV) || fnV || mp.defaults.function || "Imported";
    const group = (mp.carryDown ? curGroup : grV) || grV || mp.defaults.group || null;
    const key = `${fn}\u0000${group ?? ""}\u0000${line}`.toLowerCase();
    const rec = byKey.get(key) ?? {
      fn, group, line, owner: null, metric: null, unit: null, annual: null, values: [], row: r + 1,
    };
    if (ci.owner != null && str(row[ci.owner])) rec.owner = str(row[ci.owner]);
    if (ci.metric != null && str(row[ci.metric])) rec.metric = str(row[ci.metric]);
    if (ci.unit != null && str(row[ci.unit])) rec.unit = str(row[ci.unit]);
    if (ci.annual != null) { const n = toNumber(row[ci.annual]); if (n != null) rec.annual = n; }
    for (const c of periodCols) { const n = toNumber(row[c.index]); if (n != null) rec.values.push({ period: c.period!, measure: c.measure!, value: n }); }
    if (ci.month != null && valueCols.length) {
      const p = toPeriod(row[ci.month], fyStart);
      if (p) for (const c of valueCols) { const n = toNumber(row[c.index]); if (n != null) rec.values.push({ period: p, measure: c.measure!, value: n }); }
    }
    byKey.set(key, rec);
  }
  const records = [...byKey.values()].filter((x) => x.values.length || x.annual != null);
  skipped += byKey.size - records.length;
  return { records, skipped, warnings };
}
