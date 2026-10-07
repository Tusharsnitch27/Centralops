import "server-only";
import * as XLSX from "xlsx";
import { tx, type Tx } from "../db";
import type { User } from "../auth";
import { logActivity } from "../core/activity";
import { matchPerson } from "../core/people";
import { LABEL_PRESETS } from "./calc";
import { extractRecords, type Cell, type ImportMapping } from "./importParse";

/* Workbook parsing (server-side, SheetJS) + applying an import mapping to a cycle. */

interface Parsed { fileName: string; sheets: { name: string; rows: Cell[][] }[]; at: number }
const g = globalThis as unknown as { __aopImports?: Map<string, Parsed> };
const cache = (): Map<string, Parsed> => (g.__aopImports ??= new Map<string, Parsed>());
const MAX_ROWS = 5000, MAX_COLS = 120;

export function parseWorkbook(buf: ArrayBuffer, fileName: string) {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true }).slice(0, MAX_ROWS)
      .map((r) => (r as Cell[]).slice(0, MAX_COLS).map((c) => (typeof c === "string" ? c.trim() || null : c)));
    // fill merged ranges with their top-left value (merged month headers)
    const origin = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s : { r: 0, c: 0 };
    for (const mg of ws["!merges"] ?? []) {
      const v = rows[mg.s.r - origin.r]?.[mg.s.c - origin.c] ?? null;
      if (v == null || mg.e.r - mg.s.r > 3) continue;
      for (let r = mg.s.r; r <= mg.e.r; r++) for (let c = mg.s.c; c <= mg.e.c; c++) {
        const rr = rows[r - origin.r];
        if (rr && c - origin.c < MAX_COLS) rr[c - origin.c] = rr[c - origin.c] ?? v;
      }
    }
    let end = rows.length;
    while (end > 0 && !rows[end - 1].some((c) => c != null && c !== "")) end--;
    const trimmed = rows.slice(0, end);
    let width = 0;
    for (const r of trimmed) for (let c = r.length - 1; c >= width; c--) if (r[c] != null && r[c] !== "") { width = c + 1; break; }
    return { name, rows: trimmed.map((r) => { const x = r.slice(0, width); while (x.length < width) x.push(null); return x; }) };
  });
  const token = crypto.randomUUID();
  const c = cache();
  for (const [k, v] of c) if (Date.now() - v.at > 2 * 3600_000) c.delete(k);
  c.set(token, { fileName, sheets, at: Date.now() });
  return { token, fileName, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length, cols: s.rows[0]?.length ?? 0 })) };
}

export function getSheet(token: string, sheet: string) {
  const p = cache().get(token);
  if (!p) return null;
  const s = p.sheets.find((x) => x.name === sheet) ?? p.sheets[0];
  return s ? { fileName: p.fileName, name: s.name, rows: s.rows } : null;
}

export interface ImportTarget { cycleId?: string | null; newCycle?: { name: string; kind: "cost" | "revenue" | "mixed"; fy_start: string } | null }
export interface ImportResult { cycleId: string; lines: number; values: number; createdSections: number; createdItems: number; skipped: number }

export async function applyImport(u: User, token: string, sheet: string, mapping: ImportMapping, target: ImportTarget, templateId?: string | null): Promise<ImportResult> {
  const s = getSheet(token, sheet);
  if (!s) throw new Error("The uploaded file has expired — upload it again");
  return tx(async (x: Tx): Promise<ImportResult> => {
    let cycleId = target.cycleId ?? null;
    let fyStart: string;
    if (!cycleId) {
      const nc = target.newCycle;
      if (!nc?.name?.trim() || !/^\d{4}-\d{2}/.test(nc.fy_start ?? "")) throw new Error("Name the new cycle and pick its first month");
      fyStart = `${nc.fy_start.slice(0, 7)}-01`;
      cycleId = (await x.one<{ id: string }>(
        `insert into aop_cycles (name, kind, fy_start, status, labels, source_file, owner_id) values ($1,$2,$3,'draft',$4,$5,$6) returning id`,
        [nc.name.trim(), nc.kind, fyStart, JSON.stringify(LABEL_PRESETS[nc.kind] ?? LABEL_PRESETS.cost), s.fileName, u.id]))!.id;
    } else {
      const c = await x.one<{ fy_start: string }>(`select fy_start from aop_cycles where id = $1`, [cycleId]);
      if (!c) throw new Error("Cycle not found");
      fyStart = c.fy_start;
    }
    const cyc = await x.one<{ kind: string; months: number }>(`select kind, months from aop_cycles where id = $1`, [cycleId]);
    const { records, skipped, warnings } = extractRecords(s.rows, mapping, fyStart);
    if (warnings.length && !records.length) throw new Error(warnings[0]);
    if (!records.length) throw new Error("Nothing to import with this mapping");
    const fyEnd = (() => { const d = new Date(`${fyStart}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + (cyc?.months ?? 12)); return d.toISOString().slice(0, 10); })();

    const secs = await x.q<{ id: string; name: string; parent_id: string | null }>(`select id, name, parent_id from aop_sections where cycle_id = $1`, [cycleId]);
    const secKey = (parent: string | null, name: string) => `${parent ?? ""}\u0000${name.trim().toLowerCase()}`;
    const secBy = new Map(secs.map((r) => [secKey(r.parent_id, r.name), r.id]));
    const items = await x.q<{ id: string; name: string; section_id: string }>(`select id, name, section_id from aop_items where cycle_id = $1`, [cycleId]);
    const itemBy = new Map(items.map((r) => [`${r.section_id}\u0000${r.name.trim().toLowerCase()}`, r.id]));
    let createdSections = 0, createdItems = 0, values = 0;
    const direction = mapping.defaults.direction ?? (cyc?.kind === "revenue" ? "higher_better" : "lower_better");

    const section = async (parent: string | null, name: string) => {
      const k = secKey(parent, name);
      let id = secBy.get(k);
      if (!id) {
        id = (await x.one<{ id: string }>(`insert into aop_sections (cycle_id, parent_id, name, kind, sort) values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from aop_sections where cycle_id = $1)) returning id`,
          [cycleId, parent, name.trim(), parent ? "group" : "function"]))!.id;
        secBy.set(k, id); createdSections++;
      }
      return id;
    };
    for (const r of records) {
      const fid = await section(null, r.fn);
      const sid = r.group ? await section(fid, r.group) : fid;
      const ik = `${sid}\u0000${r.line.trim().toLowerCase()}`;
      let iid = itemBy.get(ik);
      const owner = r.owner ? (await matchPerson(r.owner.split(/\s*(?:&|,|\band\b)\s*/i)[0]))?.id ?? null : null;
      const unit = r.unit && /^(inr|num|pct)$/.test(r.unit.toLowerCase()) ? r.unit.toLowerCase() : mapping.defaults.unit ?? "inr";
      if (!iid) {
        iid = (await x.one<{ id: string }>(
          `insert into aop_items (cycle_id, section_id, name, metric, unit, direction, owner_id, annual_target, sort)
           values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+1 from aop_items where section_id = $2)) returning id`,
          [cycleId, sid, r.line.trim(), r.metric ?? (direction === "higher_better" ? "Revenue" : "Cost"), unit, direction, owner, r.annual]))!.id;
        itemBy.set(ik, iid); createdItems++;
      } else {
        if (r.annual != null) await x.q(`update aop_items set annual_target = $2 where id = $1`, [iid, r.annual]);
        if (owner) await x.q(`update aop_items set owner_id = $2 where id = $1`, [iid, owner]);
        if (r.metric) await x.q(`update aop_items set metric = $2 where id = $1`, [iid, r.metric]);
      }
      if (owner) {
        await x.q(`update aop_sections set owner_id = coalesce(owner_id, $2), owner_label = coalesce(owner_label, $3) where id = $1`, [fid, owner, r.owner]);
        if (sid !== fid) await x.q(`update aop_sections set owner_id = coalesce(owner_id, $2) where id = $1`, [sid, owner]);
      }
      for (const v of r.values) {
        if (v.period < fyStart || v.period >= fyEnd) continue;
        const cur = await x.one<{ v: number | null }>(`select ${v.measure} as v from aop_period_values where item_id = $1 and period = $2`, [iid, v.period]);
        if (cur?.v != null && Math.abs(cur.v - v.value) < 0.005) continue;
        await x.q(`insert into aop_period_values (item_id, period, ${v.measure}, updated_by) values ($1,$2,$3,$4)
                   on conflict (item_id, period) do update set ${v.measure} = excluded.${v.measure}, updated_by = excluded.updated_by, updated_at = now()`, [iid, v.period, v.value, u.id]);
        if (cur) await x.q(`insert into aop_updates (item_id, period, field, old_value, new_value, author_id) values ($1,$2,$3,$4,$5,$6)`,
          [iid, v.period, v.measure, cur.v == null ? null : String(cur.v), String(v.value), u.id]);
        values++;
      }
    }
    await x.q(`insert into aop_imports (cycle_id, template_id, file_name, rows_imported, created_by) values ($1,$2,$3,$4,$5)`,
      [cycleId, templateId ?? null, `${s.fileName} › ${s.name}`, records.length, u.id]);
    await logActivity({ actorId: u.id, entityType: "aop_cycle", entityId: cycleId, action: "imported", summary: `${s.fileName} › ${s.name}: ${records.length} lines, ${values} values` }, x);
    return { cycleId: cycleId!, lines: records.length, values, createdSections, createdItems, skipped };
  });
}
